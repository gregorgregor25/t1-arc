import Ionicons from '@expo/vector-icons/Ionicons';
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
import { formatGlucoseAccessible } from '@/domain/regionalFormat';
import { useRegionalProfile } from '@/providers/RegionalProfileProvider';

import { SectionCard } from './SectionCard';
import { CurrentGlucoseCard } from './CurrentGlucoseCard';

const PREVIEW_END = 1_800_000_000_000;
const PREVIEW_HISTORY = Array.from({ length: 48 }, (_, index) => ({
  id: `widget-example-${index}`,
  sourceId: 'illustration',
  timestamp: PREVIEW_END - (47 - index) * 5 * 60_000,
  receivedAt: PREVIEW_END,
  mmolL: index === 47 ? 6.7 : 6.7 + 3.5 * Math.exp(-index / 15),
  trend: 'flat' as const,
  quality: 'measured' as const,
}));

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

      <View style={styles.preview}>
        <View accessible accessibilityLabel={`Example widget with invented glucose readings, ${formatGlucoseAccessible(6.7, regional)}, steady and in range`}>
          <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            <CurrentGlucoseCard
              reading={PREVIEW_HISTORY.at(-1)}
              history={PREVIEW_HISTORY}
              now={PREVIEW_END + 2 * 60_000}
            />
          </View>
        </View>
        <Text style={[styles.previewLabel, { color: colors.textTertiary }]}>EXAMPLE · INVENTED READINGS</Text>
      </View>

      <Text style={[styles.detail, { color: colors.textSecondary }]}>
        Your glucose reading, direction, range and recent history use the same
        presentation as Today. Tap the card to open Today, or the calculated-trend
        button to inspect its supporting readings. New readings update the card;
        the background collector also refreshes its age while a widget is added.
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
  preview: { marginTop: 16 },
  previewLabel: { fontSize: 9, textAlign: 'right', marginTop: 8 },
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
