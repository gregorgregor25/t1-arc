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
import { formatGlucose, glucoseUnitLabel } from '@/domain/regionalFormat';
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
            Value, direction, age and source at a glance
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

      <View
        accessibilityLabel="Preview of the T1 Arc home-screen glucose widget"
        style={[
          styles.preview,
          {
            backgroundColor: '#102328',
            borderColor: '#29454C',
            borderRadius: radius.lg,
          },
        ]}
      >
        <View style={styles.previewTop}>
          <Text style={styles.previewBrand}>T1 ARC</Text>
          <Text style={styles.previewAge}>JUST NOW</Text>
        </View>
        <View style={styles.previewValueRow}>
          <Text style={styles.previewValue}>
            {formatGlucose(6.8, regional, { withUnit: false })}
          </Text>
          <Text style={styles.previewArrow}>→</Text>
          <Text style={styles.previewUnit}>
            {glucoseUnitLabel(regional.glucoseUnit)}
          </Text>
        </View>
        <Text style={styles.previewStatus}>
          Steady · Current · personal glucose
        </Text>
        <Text style={styles.previewLabel}>PREVIEW</Text>
      </View>

      <Text style={[styles.detail, { color: colors.textSecondary }]}>
        The widget reads only T1 Arc’s encrypted display snapshot. It updates
        with the app and, when glucose at a glance is active, refreshes its age
        every minute.
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
    minHeight: 138,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 16,
    paddingHorizontal: 17,
    paddingVertical: 14,
  },
  previewTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  previewBrand: {
    color: '#8FABB2',
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  previewAge: {
    color: '#8FABB2',
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '700',
  },
  previewValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: 7,
  },
  previewValue: {
    color: '#65D2E7',
    fontSize: 37,
    lineHeight: 43,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  previewArrow: {
    color: '#65D2E7',
    fontSize: 25,
    lineHeight: 31,
    fontWeight: '800',
    marginLeft: 9,
  },
  previewUnit: {
    color: '#B7CDD2',
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
    marginLeft: 7,
  },
  previewStatus: {
    color: '#B7CDD2',
    fontSize: 10,
    lineHeight: 14,
    marginTop: 2,
  },
  previewLabel: {
    position: 'absolute',
    right: 14,
    bottom: 11,
    color: '#607E86',
    fontSize: 7,
    lineHeight: 10,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
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
