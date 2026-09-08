import { Interactive, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { PhoneStage } from '../PhoneStage';
import { footage } from '../assets';
export function AnswerScene({ sample = false }: { sample?: boolean }) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const portrait = height > width;
  return <>
    <PhoneStage clip={footage.answer} mode="read" approachFrames={sample ? 90 : 120} focusY={.70} />
    {!sample ? <Interactive.Div name="Elapsed processing disclosure" style={{
      position: 'absolute', left: portrait ? 150 : 240, top: portrait ? 110 : 180,
      color: '#b7bccb', fontSize: portrait ? 54 : 60, letterSpacing: '-.025em',
      opacity: interpolate(frame, [0, 20, 165, 195], [0, 1, 1, 0], { extrapolateRight: 'clamp' }),
    }}>After processing</Interactive.Div> : null}
  </>;
}
