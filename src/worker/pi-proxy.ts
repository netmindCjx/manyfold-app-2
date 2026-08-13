/**
 * Bridges a browser WebSocket to the pi RPC gateway running on the sprite.
 *
 * The sprite's HTTP proxy requires its own Bearer token (SPRITE_API_TOKEN) and the
 * gateway process requires a second, independent token (PI_GATEWAY_TOKEN) before it
 * will spawn a `pi` process. Both live only as Worker secrets — the browser never
 * sees either one, only this Worker's own /api/pi-ws endpoint.
 */

import { ConfigError } from './crypto';
import type { Env } from './types';

export async function proxyPiWebSocket(env: Env): Promise<Response> {
  const gatewayUrl = (env.PI_GATEWAY_URL ?? '').trim();
  const gatewayToken = (env.PI_GATEWAY_TOKEN ?? '').trim();
  if (!gatewayUrl || !gatewayToken) {
    throw new ConfigError('PI_GATEWAY_URL and PI_GATEWAY_TOKEN must be configured.');
  }

  const upstream = new URL(gatewayUrl);
  upstream.searchParams.set('token', gatewayToken);

  const headers: Record<string, string> = { Upgrade: 'websocket' };
  const spriteToken = (env.SPRITE_API_TOKEN ?? '').trim();
  if (spriteToken) headers.Authorization = `Bearer ${spriteToken}`;

  const upstreamResponse = await fetch(upstream.toString(), { headers });
  const upstreamSocket = upstreamResponse.webSocket;
  if (!upstreamSocket) {
    return new Response('pi gateway did not accept the WebSocket upgrade', { status: 502 });
  }
  upstreamSocket.accept();

  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  server.accept();

  server.addEventListener('message', (event) => {
    upstreamSocket.send(event.data);
  });
  server.addEventListener('close', (event) => {
    upstreamSocket.close(event.code, event.reason);
  });

  upstreamSocket.addEventListener('message', (event) => {
    server.send(event.data);
  });
  upstreamSocket.addEventListener('close', (event) => {
    server.close(event.code, event.reason);
  });
  upstreamSocket.addEventListener('error', () => {
    server.close(1011, 'gateway connection error');
  });

  return new Response(null, { status: 101, webSocket: client });
}
