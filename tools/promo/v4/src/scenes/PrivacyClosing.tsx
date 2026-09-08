import { AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { PhoneStage } from '../PhoneStage';
import { footage } from '../assets';
import { fontFamily } from '../fonts';

// This ten-second replacement does not alter any earlier film or app footage.
export function PrivacyClosing() {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const portrait = height > width;
  return <AbsoluteFill style={{ background: '#080a10', fontFamily }}>
    <PhoneStage clip={footage.today} mode="close" approachFrames={540} phoneScale={portrait ? .86 : 1} phoneOffsetY={portrait ? -.6 : 0} />
    <Interactive.Div name="T1 Arc privacy wordmark" style={{
      position: 'absolute', left: portrait ? 160 : 240, top: portrait ? 220 : 350,
      width: portrait ? 1840 : 1660, textAlign: portrait ? 'center' : 'left',
      color: '#f2f3f7', fontSize: portrait ? 220 : 260, fontWeight: 600,
      letterSpacing: '-.065em', lineHeight: 1.08,
      opacity: interpolate(frame, [0, 36], [0, 1], { extrapolateRight: 'clamp', easing: Easing.bezier(.22, 1, .36, 1) }),
    }}>T1 Arc</Interactive.Div>
    <Interactive.Div name="Open source and local health history" style={{
      position: 'absolute', left: portrait ? 160 : 240, top: portrait ? 525 : 730,
      width: portrait ? 1840 : 1700, textAlign: portrait ? 'center' : 'left',
      color: '#f2f3f7', fontSize: portrait ? 88 : 100, fontWeight: 500,
      letterSpacing: '-.025em', lineHeight: 1.45,
    }}>Open source.<br />Health history stored on your phone.<br />We don’t collect your health data.</Interactive.Div>
    <Interactive.Div name="Direct OpenAI qualifier, visible throughout" style={{
      position: 'absolute', left: portrait ? 200 : 240, top: portrait ? 980 : 1250,
      width: portrait ? 1760 : 1600, textAlign: portrait ? 'center' : 'left',
      color: '#c4c9dc', fontSize: portrait ? 78 : 80, fontWeight: 400,
      letterSpacing: '-.01em', lineHeight: 1.3,
    }}>Optional AI sends relevant data<br />directly to OpenAI.</Interactive.Div>
    <Interactive.Div name="AI narration credit" style={{
      position: 'absolute', left: portrait ? 160 : 240, top: portrait ? 1240 : 1880,
      width: portrait ? 1840 : 1660, textAlign: portrait ? 'center' : 'left',
      color: '#a9adbd', fontSize: portrait ? 44 : 40, fontWeight: 400,
      opacity: interpolate(frame, [330, 375], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
    }}>AI narration: George / elevenlabs.io</Interactive.Div>
  </AbsoluteFill>;
}
