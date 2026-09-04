import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import T1ArcGlucoseDisplay, {
  WearCompanionStatus,
} from '../../modules/t1arc-glucose-display';
import {
  formatGlucose,
  formatGlucoseAccessible,
  glucoseUnitLabel,
} from '@/domain/regionalFormat';
import { useRegionalProfile } from '@/providers/RegionalProfileProvider';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';

export function WearCompanionCard() {
  const { colors, radius } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const [status, setStatus] = useState<WearCompanionStatus>();
  const [checking, setChecking] = useState(true);
  const refreshGeneration = useRef(0);

  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    setChecking(true);
    try {
      const next = await T1ArcGlucoseDisplay.getWearStatusAsync();
      if (refreshGeneration.current === generation) setStatus(next);
    } catch {
      if (refreshGeneration.current === generation) {
        setStatus({
          supported: false,
          querySucceeded: false,
          pairedWatchCount: 0,
          companionWatchCount: 0,
          companionAvailable: false,
          watchNames: [],
          latestReadingAvailable: false,
          republishAttempted: false,
          republishSucceeded: false,
        });
      }
    } finally {
      if (refreshGeneration.current === generation) setChecking(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void refresh();
    });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      active = false;
      refreshGeneration.current += 1;
      subscription.remove();
    };
  }, [refresh]);

  const presentation = useMemo(() => {
    if (Platform.OS !== 'android' || !status?.supported) {
      return {
        label: 'ANDROID ONLY',
        title: 'Wear OS is unavailable here',
        detail: 'The companion connects from an Android phone.',
        tone: colors.textTertiary,
        icon: 'remove-circle-outline' as const,
      };
    }
    if (!status.querySucceeded) {
      return {
        label: 'CHECK NEEDED',
        title: 'Wear OS status unavailable',
        detail: 'Keep the watch nearby and try this check again.',
        tone: colors.warning,
        icon: 'alert-circle-outline' as const,
      };
    }
    if (status.companionAvailable) {
      const watch =
        status.watchNames.length === 1
          ? status.watchNames[0]
          : `${status.companionWatchCount} watches`;
      if (status.republishAttempted && !status.republishSucceeded) {
        return {
          label: 'SYNC CHECK',
          title: `${watch} connected`,
          detail:
            status.error ??
            'The watch was found, but the latest glucose could not be queued.',
          tone: colors.warning,
          icon: 'alert-circle-outline' as const,
        };
      }
      return {
        label: 'READY',
        title: `${watch} connected`,
        detail: status.republishSucceeded
          ? 'The latest glucose was queued securely for the watch.'
          : status.latestReadingAvailable === false
            ? 'The watch is ready; T1 Arc is waiting for a glucose reading.'
            : 'Current glucose can sync securely from this phone.',
        tone: colors.accent,
        icon: 'checkmark-circle-outline' as const,
      };
    }
    if (status.pairedWatchCount > 0) {
      return {
        label: 'INSTALL NEEDED',
        title: 'Wear OS watch found',
        detail: 'Install the T1 Arc companion on the watch to finish setup.',
        tone: colors.warning,
        icon: 'watch-outline' as const,
      };
    }
    return {
      label: 'NOT DETECTED',
      title: 'No reachable Wear OS watch',
      detail: 'Bring a paired watch nearby, then check again.',
      tone: colors.textTertiary,
      icon: 'watch-outline' as const,
    };
  }, [colors, status]);

  return (
    <SectionCard accessibilityLabel="T1 Arc Wear OS companion">
      <View style={styles.hero}>
        <View style={styles.copy}>
          <View style={styles.eyebrowRow}>
            <Text style={[styles.eyebrow, { color: colors.glucose }]}>
              T1 ARC WEAR
            </Text>
            <View
              style={[
                styles.badge,
                {
                  backgroundColor: `${presentation.tone}18`,
                  borderColor: `${presentation.tone}55`,
                  borderRadius: radius.pill,
                },
              ]}
            >
              <Text style={[styles.badgeText, { color: presentation.tone }]}>
                {presentation.label}
              </Text>
            </View>
          </View>
          <Text style={[styles.heading, { color: colors.text }]}>
            Glucose at a glance
          </Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            A quiet, high-contrast face, complication and tile built for active
            and ambient viewing.
          </Text>
        </View>

        <View
          accessible
          accessibilityLabel={`Meridian watch face preview, ${formatGlucoseAccessible(6.8, regional)}, steady and current`}
          style={styles.face}
        >
          <View style={styles.faceArc} />
          <Text style={styles.faceTime}>10:08</Text>
          <Text style={styles.faceValue}>
            {formatGlucose(6.8, regional, { withUnit: false })} →
          </Text>
          <Text style={styles.faceUnit}>
            {glucoseUnitLabel(regional.glucoseUnit).toLocaleUpperCase(
              regional.locale,
            )}{' '}
            · CURRENT
          </Text>
        </View>
      </View>

      <View
        style={[
          styles.status,
          {
            backgroundColor: `${presentation.tone}0E`,
            borderColor: `${presentation.tone}45`,
            borderRadius: radius.md,
          },
        ]}
      >
        {checking ? (
          <ActivityIndicator color={colors.glucose} size="small" />
        ) : (
          <Ionicons color={presentation.tone} name={presentation.icon} size={21} />
        )}
        <View style={styles.statusCopy}>
          <Text style={[styles.statusTitle, { color: colors.text }]}>
            {checking ? 'Checking the watch…' : presentation.title}
          </Text>
          <Text style={[styles.statusDetail, { color: colors.textSecondary }]}>
            {checking
              ? 'Looking for the signed T1 Arc companion.'
              : presentation.detail}
          </Text>
        </View>
      </View>

      <View style={styles.features}>
        <Feature
          detail="Only the current reading, trend, source label and timestamp cross to the watch."
          icon="lock-closed-outline"
          title="Private transport"
        />
        <Feature
          detail="The watch independently changes from current to delayed at 6 minutes and stale at 12."
          icon="time-outline"
          title="Honest freshness"
        />
        <Feature
          detail="Meridian has a restrained active face and a separate low-power ambient presentation."
          icon="contrast-outline"
          title="Ambient by design"
        />
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={checking}
        onPress={() => void refresh()}
        style={({ pressed }) => [
          styles.refresh,
          {
            borderColor: colors.border,
            borderRadius: radius.md,
            opacity: checking ? 0.55 : pressed ? 0.72 : 1,
          },
        ]}
      >
        <Ionicons color={colors.glucose} name="refresh-outline" size={18} />
        <Text style={[styles.refreshText, { color: colors.glucose }]}>
          Check watch connection
        </Text>
      </Pressable>

      <Text style={[styles.footnote, { color: colors.textTertiary }]}>
        The watch never recommends insulin doses. If the phone or source stops
        updating, the face clearly ages and marks the reading stale.
      </Text>
    </SectionCard>
  );
}

function Feature({
  detail,
  icon,
  title,
}: {
  detail: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.feature}>
      <Ionicons color={colors.textTertiary} name={icon} size={18} />
      <View style={styles.featureCopy}>
        <Text style={[styles.featureTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.featureDetail, { color: colors.textSecondary }]}>
          {detail}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  copy: {
    flex: 1,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 7,
  },
  eyebrow: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '900',
    letterSpacing: 1.15,
  },
  badge: {
    minHeight: 22,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 8,
    lineHeight: 11,
    fontWeight: '900',
    letterSpacing: 0.55,
  },
  heading: {
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '800',
    marginTop: 7,
  },
  body: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 5,
  },
  face: {
    width: 108,
    height: 108,
    borderRadius: 54,
    backgroundColor: '#020708',
    borderWidth: 1,
    borderColor: '#29454C',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  faceArc: {
    position: 'absolute',
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 2,
    borderColor: '#65D2E7',
    borderBottomColor: '#173239',
    transform: [{ rotate: '-28deg' }],
  },
  faceTime: {
    color: '#B9C5C8',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
  },
  faceValue: {
    color: '#65D2E7',
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  faceUnit: {
    color: '#78949A',
    fontSize: 6,
    lineHeight: 9,
    fontWeight: '800',
    letterSpacing: 0.65,
  },
  status: {
    minHeight: 70,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 18,
    paddingHorizontal: 13,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statusCopy: {
    flex: 1,
  },
  statusTitle: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '800',
  },
  statusDetail: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  features: {
    marginTop: 17,
    gap: 13,
  },
  feature: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
  },
  featureCopy: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  featureDetail: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 1,
  },
  refresh: {
    minHeight: 48,
    borderWidth: 1,
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  refreshText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  footnote: {
    fontSize: 10,
    lineHeight: 16,
    marginTop: 12,
  },
});
