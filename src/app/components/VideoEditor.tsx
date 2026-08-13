/**
 * Client-only video cut tool. The video never leaves the browser: preview and
 * trim markers are rendered with Remotion's <Player>, and the actual cut is
 * produced by ffmpeg.wasm (loaded from a CDN on first export) — so this page
 * needs no server-side rendering and works on a static Workers deployment.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { AbsoluteFill, Video, useCurrentFrame } from 'remotion';

const FPS = 30;

type Cut = { id: string; from: number; to: number };

const nextId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const formatTime = (frame: number) => {
  const totalSeconds = frame / FPS;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toFixed(2).padStart(5, '0');
  return `${minutes}:${seconds}`;
};

function PreviewComposition(props: {
  src: string;
  mode: 'full' | 'clip';
  inFrame: number;
  outFrame: number;
  totalFrames: number;
}) {
  const frame = useCurrentFrame();
  if (props.mode === 'clip') {
    return (
      <AbsoluteFill style={{ backgroundColor: '#000' }}>
        <Video src={props.src} trimBefore={props.inFrame} trimAfter={props.totalFrames - props.outFrame} />
      </AbsoluteFill>
    );
  }
  const outside = frame < props.inFrame || frame > props.outFrame;
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <Video src={props.src} />
      {outside && <AbsoluteFill style={{ backgroundColor: 'rgba(0,0,0,0.55)' }} />}
    </AbsoluteFill>
  );
}

export default function VideoEditor() {
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [dims, setDims] = useState({ width: 1280, height: 720 });
  const [totalFrames, setTotalFrames] = useState(0);
  const [inFrame, setInFrame] = useState(0);
  const [outFrame, setOutFrame] = useState(0);
  const [cuts, setCuts] = useState<Cut[]>([]);
  const [previewCutId, setPreviewCutId] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [ffmpegLoading, setFfmpegLoading] = useState(false);
  const [error, setError] = useState('');

  const playerRef = useRef<PlayerRef>(null);
  const ffmpegRef = useRef<{ writeFile: Function; readFile: Function; exec: Function; load: Function } | null>(
    null,
  );
  const probeRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  const onFileChange = (nextFile: File | null) => {
    setError('');
    setCuts([]);
    setPreviewCutId(null);
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setFile(nextFile);
    setTotalFrames(0);
    setInFrame(0);
    setOutFrame(0);
    setVideoUrl(nextFile ? URL.createObjectURL(nextFile) : '');
  };

  const onProbeLoaded = () => {
    const probe = probeRef.current;
    if (!probe) return;
    const frames = Math.max(1, Math.round(probe.duration * FPS));
    setDims({ width: probe.videoWidth || 1280, height: probe.videoHeight || 720 });
    setTotalFrames(frames);
    setInFrame(0);
    setOutFrame(frames);
  };

  const currentFrame = useCallback(() => playerRef.current?.getCurrentFrame() ?? 0, []);

  const markIn = () => setInFrame(Math.min(currentFrame(), outFrame - 1));
  const markOut = () => setOutFrame(Math.max(currentFrame(), inFrame + 1));

  const addCut = () => {
    if (outFrame <= inFrame) return;
    setCuts((prev) => [...prev, { id: nextId(), from: inFrame, to: outFrame }]);
  };

  const removeCut = (id: string) => {
    setCuts((prev) => prev.filter((cut) => cut.id !== id));
    if (previewCutId === id) setPreviewCutId(null);
  };

  const ensureFfmpeg = async () => {
    if (ffmpegRef.current) return ffmpegRef.current;
    setFfmpegLoading(true);
    try {
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      const { toBlobURL } = await import('@ffmpeg/util');
      const ffmpeg = new FFmpeg();
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm';
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      ffmpegRef.current = ffmpeg;
      return ffmpeg;
    } finally {
      setFfmpegLoading(false);
    }
  };

  const exportCut = async (cut: Cut) => {
    if (!file) return;
    setError('');
    setExportingId(cut.id);
    try {
      const { fetchFile } = await import('@ffmpeg/util');
      const ffmpeg = await ensureFfmpeg();
      const extMatch = /\.[^./]+$/.exec(file.name);
      const inputName = `input${extMatch ? extMatch[0] : '.mp4'}`;
      const outputName = `cut-${cut.from}-${cut.to}.mp4`;
      await ffmpeg.writeFile(inputName, await fetchFile(file));
      const start = (cut.from / FPS).toFixed(3);
      const duration = ((cut.to - cut.from) / FPS).toFixed(3);
      await ffmpeg.exec(['-i', inputName, '-ss', start, '-t', duration, '-c', 'copy', outputName]);
      const data = await ffmpeg.readFile(outputName);
      const blob = new Blob([new Uint8Array(data as Uint8Array).slice().buffer], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = outputName;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setExportingId(null);
    }
  };

  const activeCut = previewCutId ? cuts.find((cut) => cut.id === previewCutId) : null;
  const mode: 'full' | 'clip' = activeCut ? 'clip' : 'full';
  const playerIn = activeCut ? activeCut.from : inFrame;
  const playerOut = activeCut ? activeCut.to : outFrame;
  const playerDuration = activeCut ? Math.max(1, activeCut.to - activeCut.from) : Math.max(1, totalFrames);

  return (
    <div className="editor">
      {!videoUrl ? (
        <div className="panel editor-drop">
          <h2>Video cutter</h2>
          <p className="muted">
            Load a video, mark an in and out point on the timeline, and export the clip. Everything runs in your
            browser — nothing is uploaded.
          </p>
          <input
            type="file"
            accept="video/*"
            onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
          />
        </div>
      ) : (
        <div className="panel">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>{file?.name}</h2>
            <button className="button subtle" onClick={() => onFileChange(null)}>
              Load a different video
            </button>
          </div>

          {/* Hidden probe element just to read duration/dimensions once. */}
          <video ref={probeRef} src={videoUrl} onLoadedMetadata={onProbeLoaded} style={{ display: 'none' }} />

          {totalFrames > 0 && (
            <>
              <div className="editor-player-wrap">
                {activeCut && (
                  <div className="notice">
                    Previewing cut {formatTime(activeCut.from)}–{formatTime(activeCut.to)}.{' '}
                    <button className="link" onClick={() => setPreviewCutId(null)}>
                      Back to full preview
                    </button>
                  </div>
                )}
                <Player
                  ref={playerRef}
                  component={PreviewComposition}
                  inputProps={{ src: videoUrl, mode, inFrame: playerIn, outFrame: playerOut, totalFrames }}
                  durationInFrames={playerDuration}
                  fps={FPS}
                  compositionWidth={dims.width}
                  compositionHeight={dims.height}
                  style={{ width: '100%', aspectRatio: `${dims.width} / ${dims.height}` }}
                  controls
                  loop
                />
              </div>

              {!activeCut && (
                <div className="timeline">
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="small muted">In {formatTime(inFrame)}</span>
                    <span className="small muted">Out {formatTime(outFrame)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={totalFrames}
                    value={inFrame}
                    onChange={(event) => setInFrame(Math.min(Number(event.target.value), outFrame - 1))}
                  />
                  <input
                    type="range"
                    min={0}
                    max={totalFrames}
                    value={outFrame}
                    onChange={(event) => setOutFrame(Math.max(Number(event.target.value), inFrame + 1))}
                  />
                  <div className="row">
                    <button className="button" onClick={markIn}>
                      Mark in at playhead
                    </button>
                    <button className="button" onClick={markOut}>
                      Mark out at playhead
                    </button>
                    <button className="button primary" onClick={addCut} disabled={outFrame <= inFrame}>
                      Add cut ({formatTime(outFrame - inFrame)})
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {error && <p className="notice error">{error}</p>}

          {cuts.length > 0 && (
            <div className="cut-list">
              <h3>Cuts</h3>
              {cuts.map((cut) => (
                <div className="cut-card" key={cut.id}>
                  <div>
                    <strong>
                      {formatTime(cut.from)} – {formatTime(cut.to)}
                    </strong>
                    <p className="muted small">Duration {formatTime(cut.to - cut.from)}</p>
                  </div>
                  <div className="row">
                    <button
                      className="button subtle"
                      onClick={() => setPreviewCutId(previewCutId === cut.id ? null : cut.id)}
                    >
                      {previewCutId === cut.id ? 'Stop preview' : 'Preview'}
                    </button>
                    <button
                      className="button primary"
                      disabled={exportingId === cut.id}
                      onClick={() => void exportCut(cut)}
                    >
                      {exportingId === cut.id ? (ffmpegLoading ? 'Loading ffmpeg…' : 'Exporting…') : 'Export .mp4'}
                    </button>
                    <button className="button danger-outline" onClick={() => removeCut(cut.id)}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
