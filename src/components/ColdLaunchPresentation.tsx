import { PropsWithChildren, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, BackHandler, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';

import { LAUNCH_ANIMATION_MS, launchFrame } from '@/domain/launchAnimation';
import { LaunchArtwork } from './LaunchArtwork';

// Configure before React's first content automatically dismisses the native image.
SplashScreen.setOptions({ duration: 0, fade: false });

/** Children initialise concurrently. This is presentation, never a data/privacy gate. */
export function ColdLaunchPresentation({ children }: PropsWithChildren) {
  // The glucose service can keep JS alive after the Android window is closed.
  // Scope presentation to this mounted window, not the background process.
  const [visible, setVisible] = useState(true);
  const [progress, setProgress] = useState(0);
  const hasLaidOut = useRef(false);

  useEffect(() => {
    if (!visible) return;
    let disposed = false;
    let finished = false;
    let frame = 0;
    let revealed = false;
    let revealFrames = 0;
    let start: number | undefined;
    let lastPaint = 0;
    const finish = () => {
      if (disposed || finished) return;
      finished = true;
      cancelAnimationFrame(frame);
      setVisible(false);
    };
    // Fail open if layout never arrives. Give the visible sequence its own clock.
    let deadline = setTimeout(finish, 5000);
    void AccessibilityInfo.isReduceMotionEnabled().then(reduced => { if (reduced) finish(); }).catch(finish);
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', reduced => { if (reduced) finish(); });
    const appState = AppState.addEventListener('change', state => { if (revealed && state !== 'active') finish(); });
    const back = BackHandler.addEventListener('hardwareBackPress', () => { finish(); return true; });
    const tick = (now: number) => {
      if (disposed || finished) return;
      if (hasLaidOut.current && AppState.currentState === 'active') {
        if (!revealed) {
          // Expo's default native fade otherwise covers the start of our orbit.
          SplashScreen.setOptions({ duration: 0, fade: false });
          SplashScreen.hide();
          revealed = true;
          clearTimeout(deadline);
          deadline = setTimeout(finish, LAUNCH_ANIMATION_MS + 1000);
        }
        // Allow the native splash removal and artwork to reach the display.
        if (revealFrames++ < 2) { frame = requestAnimationFrame(tick); return; }
        start ??= now;
        const next = Math.min(1, (now - start) / LAUNCH_ANIMATION_MS);
        if (next >= 1) { finish(); return; }
        // 30 frames/sec bounds SVG work while source/database startup proceeds.
        if (now - lastPaint >= 32) { lastPaint = now; setProgress(next); }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      clearTimeout(deadline);
      motion.remove(); appState.remove(); back.remove();
    };
  }, [visible]);

  return (
    <View style={styles.fill}>
      <View style={styles.fill} accessibilityElementsHidden={visible} importantForAccessibility={visible ? 'no-hide-descendants' : 'auto'}>{children}</View>
      {visible ? <View testID="cold-launch-presentation" onLayout={() => { hasLaidOut.current = true; }} style={[styles.overlay, { opacity: launchFrame(progress).opacity }]}><StatusBar style="light" /><LaunchArtwork progress={progress} /></View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100 },
});
