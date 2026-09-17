import { Easing, Interactive, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { PhoneStage } from '../PhoneStage';
import { footage } from '../assets';
export function QuestionScene() {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const portrait = height > width;
  return <>
    <PhoneStage clip={footage.question} approachFrames={0} />
    <Interactive.Div name="Editorial quotation of the real question" style={{
      position: 'absolute', left: portrait ? 150 : 240, top: portrait ? 260 : 445,
      width: portrait ? 1860 : 1570, color: '#f2f3f7',
      opacity: interpolate(frame, [0, 34], [0, 1], { extrapolateRight: 'clamp' }),
      translate: interpolate(frame, [0, 75], ['0px 38px', '0px 0px'], { extrapolateRight: 'clamp', easing: Easing.bezier(.22, 1, .36, 1) }),
    }}>
      <Interactive.Div name="Question introduction" style={{ fontSize: portrait ? 60 : 66, color: '#adaff1', fontWeight: 700, marginBottom: portrait ? 52 : 70 }}>Ask Tarv1s</Interactive.Div>
      <Interactive.Div name="Actual question" style={{ fontSize: portrait ? 150 : 180, lineHeight: 1.18, letterSpacing: '-.05em', fontWeight: 600, whiteSpace: 'pre-line' }}>{'What was my\naverage glucose\nyesterday?'}</Interactive.Div>
    </Interactive.Div>
  </>;
}
