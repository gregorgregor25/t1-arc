import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, G, LinearGradient as SvgGradient, Path, RadialGradient, Stop } from 'react-native-svg';

import { LAUNCH_BACKGROUND, launchFrame } from '@/domain/launchAnimation';

/** Decorative only: never renders personal data or a fabricated glucose value. */
export function LaunchArtwork({ progress = .84 }: { progress?: number }) {
  const frame = launchFrame(progress);
  const dots = (front: boolean) => frame.particles.map((dot, index) => dot.front === front
    ? <Circle key={index} cx={dot.x} cy={dot.y} r={dot.radius} fill={dot.color} opacity={dot.opacity} /> : null);
  return (
    <LinearGradient colors={['#121629', LAUNCH_BACKGROUND]} style={styles.fill}>
      <View accessible accessibilityLabel="Opening T1 Arc" style={styles.artwork}>
        <Svg width={280} height={280} viewBox="0 0 280 280" accessible={false}>
          <Defs>
            <RadialGradient id="launchDisc" cx="27%" cy="18%" r="90%">
              <Stop offset="0" stopColor="#484e65" /><Stop offset=".43" stopColor="#2c3040" /><Stop offset="1" stopColor="#171b27" />
            </RadialGradient>
            <SvgGradient id="launchRim" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#858fae" /><Stop offset=".55" stopColor="#404658" /><Stop offset="1" stopColor="#222634" />
            </SvgGradient>
          </Defs>
          {dots(false)}
          <Circle cx="143" cy="146" r="71" fill="#05060b" opacity={.35} />
          <G transform="translate(38 38) scale(0.3984375)">
            <Circle cx="256" cy="256" r="176" fill="url(#launchDisc)" stroke="url(#launchRim)" strokeWidth="4" />
            <Path d="M116 281 C154 281 166 216 207 216 C245 216 250 316 291 316 C329 316 337 246 396 246" fill="none" stroke="#F8F5EE" strokeWidth="22" strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M357 155 V241" stroke="#8EA7FF" strokeWidth="17" strokeLinecap="round" />
            <Circle cx="357" cy="155" r="15" fill="#8EA7FF" stroke="#F8F5EE" strokeWidth="5" />
            <Path d="M403 189 V246" stroke="#F0A06A" strokeWidth="13" strokeLinecap="round" />
            <Circle cx="403" cy="189" r="12" fill="#F0A06A" stroke="#F8F5EE" strokeWidth="4" />
          </G>
          {dots(true)}
        </Svg>
        <Text maxFontSizeMultiplier={1.5} style={[styles.name, { opacity: frame.nameOpacity }]}>T1 Arc<Text style={styles.dot}>.</Text></Text>
        <Text maxFontSizeMultiplier={1.5} style={[styles.caption, { opacity: frame.captionOpacity }]}>YOUR HEALTH, CONNECTED</Text>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: LAUNCH_BACKGROUND, alignItems: 'center', justifyContent: 'center' },
  artwork: { alignItems: 'center', paddingHorizontal: 16, paddingVertical: 24 },
  name: { color: '#f8f5ee', fontSize: 34, fontWeight: '700', letterSpacing: -1.4, marginTop: 0 },
  dot: { color: '#9aaeff' },
  caption: { color: '#aeb7cb', fontSize: 11, letterSpacing: 2.1, marginTop: 34, textAlign: 'center' },
});
