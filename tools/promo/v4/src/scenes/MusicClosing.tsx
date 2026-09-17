import { AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { PhoneStage } from '../PhoneStage';
import { footage } from '../assets';
import { fontFamily } from '../fonts';

// Separate ending for the approved music edition. Earlier films stay unchanged.
export function MusicClosing() {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const portrait = height > width;
  return <AbsoluteFill style={{ background: '#080a10', fontFamily }}>
    <PhoneStage clip={footage.today} mode="close" approachFrames={540} />
    <Interactive.Div name="T1 Arc closing wordmark" style={{
      position: 'absolute', left: portrait ? 160 : 240, top: portrait ? 440 : 790,
      width: portrait ? 1840 : 1500, textAlign: portrait ? 'center' : 'left',
      color: '#f2f3f7', fontSize: portrait ? 250 : 280, fontWeight: 600,
      letterSpacing: '-.065em', lineHeight: 1.08,
      opacity: interpolate(frame, [0, 48], [0, 1], { extrapolateRight: 'clamp', easing: Easing.bezier(.22, 1, .36, 1) }),
    }}>T1 Arc</Interactive.Div>
    <Interactive.Div name="AI narration credit" style={{
      position: 'absolute', left: portrait ? 160 : 240, top: portrait ? 835 : 1880,
      width: portrait ? 1840 : 1550, textAlign: portrait ? 'center' : 'left',
      color: '#a9adbd', fontSize: 40, fontWeight: 400,
      opacity: interpolate(frame, [330, 375], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
    }}>AI narration: George / elevenlabs.io</Interactive.Div>
  </AbsoluteFill>;
}
