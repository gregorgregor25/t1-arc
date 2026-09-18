import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, LinearGradient as SvgGradient, Path, Stop } from 'react-native-svg';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import T1ArcGlucoseDisplay, {
  HomeWidgetStatus,
} from '../../modules/t1arc-glucose-display';
import { useAppTheme } from '@/theme/theme';
import { formatGlucose, formatGlucoseAccessible, glucoseUnitLabel } from '@/domain/regionalFormat';
import { useRegionalProfile } from '@/providers/RegionalProfileProvider';

import { SectionCard } from './SectionCard';

export function HomeGlucoseWidgetCard() {
  const { colors, radius } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const [status, setStatus] = useState<HomeWidgetStatus>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const reloadGeneration = useRef(0);

  const reload = useCallback(async () => {
    const generation = ++reloadGeneration.current;
    try {
      const next = await T1ArcGlucoseDisplay.getHomeWidgetStatusAsync();
      if (reloadGeneration.current === generation) setStatus(next);
    } catch {
      if (reloadGeneration.current === generation) {
        setStatus({
          supported: false,
          pinningSupported: false,
          installedCount: 0,
        });
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void reload();
    });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void reload();
    });
    return () => {
      active = false;
      reloadGeneration.current += 1;
      subscription.remove();
    };
  }, [reload]);

  async function addWidget() {
    if (busy) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const opened = await T1ArcGlucoseDisplay.requestPinHomeWidgetAsync();
      setMessage(
        opened
          ? 'Confirm the placement in your launcher. You can resize the widget afterwards.'
          : 'Your launcher does not support adding a widget from inside the app. Long-press the home screen, choose Widgets, then T1 Arc.',
      );
    } catch {
      setMessage(
        'The launcher could not open the widget picker. Long-press the home screen and choose Widgets.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard>
      <View style={styles.header}>
        <View
          style={[
            styles.icon,
            {
              backgroundColor: `${colors.glucose}18`,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.glucose}
            name="grid-outline"
            size={22}
          />
        </View>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: colors.text }]}>
            Home-screen glucose
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Your Today glucose card, on your home screen
          </Text>
        </View>
        {status?.installedCount ? (
          <View
            style={[
              styles.activeBadge,
              {
                backgroundColor: `${colors.accent}18`,
                borderColor: `${colors.accent}55`,
                borderRadius: radius.pill,
              },
            ]}
          >
            <Text style={[styles.activeText, { color: colors.accent }]}>
              {status.installedCount} ACTIVE
            </Text>
          </View>
        ) : null}
      </View>

      <LinearGradient
        accessibilityLabel={`Example widget with invented glucose readings, ${formatGlucoseAccessible(6.8, regional)}, steady and in range`}
        colors={['#173239', '#10262B', '#0C1D21']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={[styles.preview, { borderRadius: radius.lg }]}
      >
        <View style={styles.previewTop}>
          <Text style={styles.previewBrand}>Now</Text>
          <Text style={styles.previewAge}>JUST NOW</Text>
        </View>
        <View style={styles.previewValueRow}>
          <Text style={styles.previewValue}>
            {formatGlucose(6.8, regional, { withUnit: false })}
          </Text>
          <View style={styles.previewUnitBlock}>
            <Text style={styles.previewArrow}>→</Text>
            <Text style={styles.previewUnit}>
              {glucoseUnitLabel(regional.glucoseUnit)}
            </Text>
          </View>
        </View>
        <Text style={styles.previewStatus}>Steady</Text>
        <Text style={styles.previewRange}>●  In range</Text>
        <Svg accessibilityElementsHidden height={64} width="100%" viewBox="0 0 300 64" preserveAspectRatio="none">
          <Defs>
            <SvgGradient id="widgetPreviewArea" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#69D5AC" stopOpacity={0.3} />
              <Stop offset="1" stopColor="#69D5AC" stopOpacity={0} />
            </SvgGradient>
          </Defs>
          <Path d="M 0 38 C 20 38 20 20 40 20 S 65 44 85 44 S 115 12 140 12 S 180 34 210 34 S 250 24 270 24 S 290 28 300 28 L 300 64 L 0 64 Z" fill="url(#widgetPreviewArea)" />
          <Path d="M 0 38 C 20 38 20 20 40 20 S 65 44 85 44 S 115 12 140 12 S 180 34 210 34 S 250 24 270 24 S 290 28 300 28" fill="none" stroke="#69D5AC" strokeWidth={1.5} />
        </Svg>
        <Text style={styles.previewLabel}>EXAMPLE · INVENTED READINGS</Text>
      </LinearGradient>

      <Text style={[styles.detail, { color: colors.textSecondary }]}>
        Resize to show your recent glucose history alongside the reading,
        direction and range. Smaller widgets keep the reading easy to see.
        Tap the widget to open T1 Arc. It refreshes with new readings and, when
        glucose at a glance is active, updates its age every minute.
      </Text>

      <Pressable
        accessibilityRole="button"
        disabled={busy || status?.supported === false}
        onPress={() => void addWidget()}
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor:
              status?.supported === false
                ? colors.surfaceMuted
                : colors.primary,
            borderRadius: radius.md,
            opacity: pressed ? 0.72 : 1,
          },
        ]}
      >
        {busy ? (
          <ActivityIndicator color={colors.onPrimary} size="small" />
        ) : (
          <Ionicons
            accessibilityElementsHidden
            color={
              status?.supported === false
                ? colors.textTertiary
                : colors.onPrimary
            }
            name="add-circle-outline"
            size={19}
          />
        )}
        <Text
          style={[
            styles.buttonText,
            {
              color:
                status?.supported === false
                  ? colors.textTertiary
                  : colors.onPrimary,
            },
          ]}
        >
          {status?.installedCount ? 'Add another widget' : 'Add to home screen'}
        </Text>
      </Pressable>

      {status && !status.pinningSupported ? (
        <Text style={[styles.fallback, { color: colors.textTertiary }]}>
          Long-press your home screen, choose Widgets, then T1 Arc.
        </Text>
      ) : null}
      {message ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.message, { color: colors.textSecondary }]}
        >
          {message}
        </Text>
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  icon: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 1,
  },
  activeBadge: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  activeText: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '800',
    letterSpacing: 0.55,
  },
  preview: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#29454C',
    marginTop: 16,
    padding: 18,
  },
  previewTop: { flexDirection: 'row', justifyContent: 'space-between' },
  previewBrand: { color: '#B7CDD2', fontSize: 16, fontWeight: '600' },
  previewAge: { color: '#B7CDD2', fontSize: 10, fontWeight: '600' },
  previewValueRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  previewValue: {
    color: '#69D5AC', fontSize: 64, lineHeight: 72, fontWeight: '700',
    letterSpacing: -2, fontVariant: ['tabular-nums'],
  },
  previewUnitBlock: { marginLeft: 12 },
  previewArrow: { color: '#69D5AC', fontSize: 30, lineHeight: 34, fontWeight: '700' },
  previewUnit: { color: '#B7CDD2', fontSize: 12, fontWeight: '600' },
  previewStatus: { color: '#E6F1F3', fontSize: 13, fontWeight: '600', marginTop: 6 },
  previewRange: {
    alignSelf: 'flex-start', color: '#69D5AC', backgroundColor: '#183F47',
    borderColor: '#365961', borderWidth: 1, borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 5, fontSize: 11, marginTop: 8,
  },
  previewLabel: { color: '#8FABB2', fontSize: 9, textAlign: 'right', marginTop: 4 },
  detail: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 14,
  },
  button: {
    minHeight: 48,
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
  },
  buttonText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  fallback: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 9,
    textAlign: 'center',
  },
  message: {
    fontSize: 11,
    lineHeight: 17,
    marginTop: 10,
  },
});
