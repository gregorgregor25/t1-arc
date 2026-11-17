import { Modal, Pressable, StatusBar, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import type { GlucoseReading, TrendDirection } from '@/domain/models';
import { useRegionalProfile } from '@/providers/RegionalProfileProvider';

import { bedsideGlucosePresentation } from './bedsideGlucosePresentation';

// Fixed night colours: dim on black whatever the app theme, so the screen
// stays easy on the eyes in a dark room.
const NIGHT = {
  background: '#000000',
  value: '#9DA3AD',
  secondary: '#6B717B',
  delayed: '#A08A55',
  stale: '#A06B6B',
};

/**
 * A full-screen bedside view of the latest glucose: large value, arrow and
 * age on black with dimmed text. Tap anywhere to close. It does not keep the
 * screen awake; the phone's own screen timeout still applies.
 */
export function BedsideGlucoseView({
  visible,
  onClose,
  reading,
  trend,
  now,
}: {
  visible: boolean;
  onClose(): void;
  reading?: GlucoseReading;
  trend: TrendDirection;
  now: number;
}) {
  const { defaults: regional } = useRegionalProfile();
  const { width, height } = useWindowDimensions();
  const shown = bedsideGlucosePresentation(reading, trend, now, regional);
  const valueSize = Math.min(width * 0.32, height * 0.3, 180);
  const statusTone = shown.kind === 'reading'
    ? shown.stale ? NIGHT.stale : shown.freshness === 'delayed' ? NIGHT.delayed : NIGHT.secondary
    : NIGHT.secondary;
  const struck = shown.kind === 'reading' && shown.stale
    ? { textDecorationLine: 'line-through' as const, textDecorationColor: NIGHT.value }
    : undefined;
  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      statusBarTranslucent
      visible={visible}
    >
      <StatusBar barStyle="light-content" backgroundColor={NIGHT.background} hidden={visible} />
      <Pressable
        accessibilityHint="Closes the bedside view"
        accessibilityLabel={shown.accessibilityLabel}
        accessibilityRole="button"
        onPress={onClose}
        style={styles.screen}
      >
        {shown.kind === 'reading' ? (
          <View style={styles.centre}>
            <View style={styles.readingRow}>
              <Text
                adjustsFontSizeToFit
                maxFontSizeMultiplier={1}
                numberOfLines={1}
                style={[styles.value, { fontSize: valueSize, lineHeight: valueSize * 1.12 }, struck]}
              >
                {shown.value}
              </Text>
              <Text
                maxFontSizeMultiplier={1}
                style={[styles.arrow, { fontSize: valueSize * 0.5 }, struck]}
              >
                {shown.arrow}
              </Text>
            </View>
            <Text maxFontSizeMultiplier={1.3} style={[styles.unit]}>{shown.unit}</Text>
            <Text maxFontSizeMultiplier={1.3} style={[styles.status, { color: statusTone }]}>
              {shown.status}
            </Text>
          </View>
        ) : (
          <View style={styles.centre}>
            <Text maxFontSizeMultiplier={1.3} style={styles.message}>{shown.message}</Text>
            <Text maxFontSizeMultiplier={1.3} style={[styles.status, { color: NIGHT.secondary }]}>
              {shown.detail}
            </Text>
          </View>
        )}
        <Text maxFontSizeMultiplier={1.3} style={styles.hint}>Tap to close</Text>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: NIGHT.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  centre: { alignItems: 'center', gap: 6 },
  readingRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  value: {
    color: NIGHT.value,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    letterSpacing: -2,
  },
  arrow: { color: NIGHT.value, fontWeight: '600' },
  unit: { color: NIGHT.secondary, fontSize: 18, lineHeight: 24 },
  status: { fontSize: 22, lineHeight: 30, marginTop: 8 },
  message: { color: NIGHT.value, fontSize: 34, lineHeight: 42, fontWeight: '600', textAlign: 'center' },
  hint: {
    position: 'absolute',
    bottom: 36,
    color: NIGHT.secondary,
    fontSize: 14,
    opacity: 0.7,
  },
});
