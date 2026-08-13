import { Composition, staticFile } from 'remotion';
import { calculateTrimCutMetadata, trimCutSchema, TrimCut, FPS } from './TrimCut';

export function RemotionRoot() {
  return (
    <Composition
      id="TrimCut"
      component={TrimCut}
      schema={trimCutSchema}
      calculateMetadata={calculateTrimCutMetadata}
      durationInFrames={150}
      fps={FPS}
      width={1280}
      height={720}
      defaultProps={{
        src: staticFile('sample.mp4'),
        inFrame: 0,
        outFrame: 150,
      }}
    />
  );
}
