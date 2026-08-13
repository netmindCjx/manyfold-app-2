/**
 * The composition used by both `npm run remotion` (Remotion Studio, for local
 * editing) and the deployed cut editor (src/app/components/VideoEditor.tsx).
 * `calculateMetadata` reads the video's real duration/dimensions so any src
 * URL — including one you paste into the Studio props panel — just works.
 */

import { z } from 'zod';
import { AbsoluteFill, Video, useCurrentFrame, type CalculateMetadataFunction } from 'remotion';

export const FPS = 30;

export const trimCutSchema = z.object({
  src: z.string().describe('URL of the source video (paste any http(s) link, or a staticFile() path)'),
  inFrame: z.number().int().min(0).describe('First frame to keep'),
  outFrame: z.number().int().min(1).describe('Last frame to keep'),
});

export type TrimCutProps = z.infer<typeof trimCutSchema>;

export const calculateTrimCutMetadata: CalculateMetadataFunction<TrimCutProps> = async ({ props }) => {
  const { getVideoMetadata } = await import('@remotion/media-utils');
  const meta = await getVideoMetadata(props.src);
  const durationInFrames = Math.max(1, Math.round(meta.durationInSeconds * FPS));
  return {
    durationInFrames,
    fps: FPS,
    width: meta.width,
    height: meta.height,
    props: {
      ...props,
      outFrame: Math.min(props.outFrame, durationInFrames),
    },
  };
};

export function TrimCut({ src, inFrame, outFrame }: TrimCutProps) {
  const frame = useCurrentFrame();
  const outside = frame < inFrame || frame > outFrame;
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <Video src={src} />
      {outside && <AbsoluteFill style={{ backgroundColor: 'rgba(0,0,0,0.55)' }} />}
    </AbsoluteFill>
  );
}
