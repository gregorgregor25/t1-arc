import { Easing, Interactive, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

export function Editorial({ title, line, fadeAfter = 10000, eyebrow = 'T1 Arc' }: {
  title: string; line?: string; fadeAfter?: number; eyebrow?: string;
}) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const portrait = height > width;
  return <Interactive.Div name={title.replace('\n', ' ')} style={{
    position: 'absolute', left: portrait ? 150 : 240, top: portrait ? 260 : 445,
    width: portrait ? 1860 : 1600, color: '#f2f3f7',
    opacity: interpolate(frame, [0, 34, fadeAfter, fadeAfter + 28], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
    translate: interpolate(frame, [0, 75], ['0px 38px', '0px 0px'], { extrapolateRight: 'clamp', easing: Easing.bezier(.22, 1, .36, 1) }),
  }}>
    <Interactive.Div name="Brand" style={{ fontSize: portrait ? 60 : 66, fontWeight: 700, letterSpacing: '-.03em', color: '#adaff1', marginBottom: portrait ? 52 : 70 }}>{eyebrow}</Interactive.Div>
    <Interactive.Div name="Headline" style={{ fontSize: portrait ? 185 : 270, lineHeight: 1.07, fontWeight: 600, letterSpacing: '-.065em', whiteSpace: 'pre-line' }}>{title}</Interactive.Div>
    {line ? <Interactive.Div name="Supporting line" style={{ fontSize: portrait ? 65 : 82, lineHeight: 1.35, letterSpacing: '-.025em', fontWeight: 400, color: '#a9adbd', maxWidth: portrait ? 1570 : 1350, marginTop: portrait ? 50 : 76 }}>{line}</Interactive.Div> : null}
  </Interactive.Div>;
}
