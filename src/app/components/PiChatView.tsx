/**
 * Chat with the pi coding agent running on the sprite, over a WebSocket the Worker
 * proxies at /api/pi-ws (see src/worker/pi-proxy.ts). Each socket message is one line
 * of pi's RPC protocol (docs: earendil-works/pi packages/coding-agent/docs/rpc.md).
 * Assistant text streams via message_update/text_delta events keyed by contentIndex;
 * message_end.message is authoritative and replaces the live buffer once it arrives.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getStoredPassword } from '../api';

interface ChatEntry {
  role: 'user' | 'assistant';
  text: string;
}

type ConnState = 'connecting' | 'open' | 'closed';

function extractText(message: unknown): string {
  const content = (message as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block): block is { type: string; text: string } => (block as { type?: string })?.type === 'text')
    .map((block) => block.text)
    .join('');
}

export default function PiChatView() {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [draft, setDraft] = useState('');
  const [live, setLive] = useState('');
  const [busy, setBusy] = useState(false);
  const [connState, setConnState] = useState<ConnState>('connecting');
  const [error, setError] = useState('');
  const socketRef = useRef<WebSocket | null>(null);
  const liveTextRef = useRef<Map<number, string>>(new Map());
  const scroller = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [entries, live]);

  const connect = useCallback(() => {
    setConnState('connecting');
    setError('');
    const url = new URL('/api/pi-ws', location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const password = getStoredPassword();
    if (password) url.searchParams.set('admin_password', password);
    const socket = new WebSocket(url);
    socketRef.current = socket;

    socket.onopen = () => setConnState('open');
    socket.onclose = (event) => {
      setConnState('closed');
      setError(`Lost connection to the pi gateway. (code ${event.code}${event.reason ? `: ${event.reason}` : ''})`);
    };
    socket.onerror = () => setError('Lost connection to the pi gateway. (WebSocket error event)');

    socket.onmessage = (event) => {
      let parsed: { type?: string } & Record<string, unknown>;
      try {
        parsed = JSON.parse(event.data as string);
      } catch {
        return;
      }

      if (parsed.type === 'message_start') {
        liveTextRef.current = new Map();
        setLive('');
        setBusy(true);
      } else if (parsed.type === 'message_update') {
        const delta = (parsed as { assistantMessageEvent?: { type?: string; contentIndex?: number; delta?: string } })
          .assistantMessageEvent;
        if (delta?.type === 'text_delta' && typeof delta.contentIndex === 'number') {
          const current = liveTextRef.current.get(delta.contentIndex) ?? '';
          liveTextRef.current.set(delta.contentIndex, current + (delta.delta ?? ''));
          setLive(Array.from(liveTextRef.current.values()).join(''));
        }
      } else if (parsed.type === 'message_end') {
        const text = extractText((parsed as { message?: unknown }).message);
        if (text) setEntries((current) => [...current, { role: 'assistant', text }]);
        liveTextRef.current = new Map();
        setLive('');
      } else if (parsed.type === 'agent_settled') {
        setBusy(false);
      } else if (parsed.type === 'gateway_child_exit') {
        setError('The pi process exited unexpectedly.');
        setBusy(false);
      } else if (parsed.type === 'response' && parsed.success === false) {
        setError(typeof parsed.error === 'string' ? parsed.error : 'The gateway rejected that command.');
      }
    };

    return socket;
  }, []);

  useEffect(() => {
    const socket = connect();
    return () => socket.close();
  }, [connect]);

  const send = () => {
    const text = draft.trim();
    const socket = socketRef.current;
    if (!text || !socket || socket.readyState !== WebSocket.OPEN) return;
    setEntries((current) => [...current, { role: 'user', text }]);
    setDraft('');
    setError('');
    socket.send(JSON.stringify({ type: 'prompt', message: text }));
  };

  return (
    <section className="panel chat">
      <div className="chat-toolbar">
        <span className="muted">
          Gateway: {connState === 'open' ? 'connected' : connState === 'connecting' ? 'connecting…' : 'disconnected'}
        </span>
        {connState === 'closed' && (
          <button className="button subtle" onClick={() => connect()}>
            Reconnect
          </button>
        )}
      </div>

      <div className="chat-log" ref={scroller}>
        {entries.length === 0 && !live && (
          <p className="muted center">Say hello to pi — it runs on the sprite, right here.</p>
        )}
        {entries.map((entry, index) => (
          <div key={index} className={`bubble ${entry.role}`}>
            <div className="bubble-text">{entry.text}</div>
          </div>
        ))}
        {live && (
          <div className="bubble assistant">
            <div className="bubble-text">{live}</div>
          </div>
        )}
      </div>

      {error && <div className="notice error">{error}</div>}

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          placeholder={connState === 'open' ? 'Message pi (Enter to send)' : 'Waiting for connection…'}
          rows={3}
          disabled={connState !== 'open'}
        />
        <button className="button primary" type="submit" disabled={!draft.trim() || connState !== 'open'}>
          {busy ? 'Working…' : 'Send'}
        </button>
      </form>
    </section>
  );
}
