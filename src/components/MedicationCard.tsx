import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  MedicationPreset,
  medicationPresets,
} from '@/domain/medications';
import { MedicationEvent, TimeRange } from '@/domain/models';
import { formatTime, relativeAge } from '@/domain/time';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';

function amountLabel(item: {
  amount?: number;
  unit?: string;
}) {
  if (item.amount === undefined) return undefined;
  return `${item.amount.toLocaleString('en-GB')}${item.unit ? ` ${item.unit}` : ''}`;
}

export function MedicationCard({
  events,
  onLogAgain,
  range,
}: {
  events: MedicationEvent[];
  onLogAgain(preset: MedicationPreset): Promise<void>;
  range: TimeRange;
}) {
  const { colors, radius } = useAppTheme();
  const [busyKey, setBusyKey] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const today = events
    .filter((event) => event.start >= range.start && event.start < range.end)
    .sort((left, right) => right.start - left.start);
  const presets = useMemo(() => medicationPresets(events), [events]);

  async function logAgain(preset: MedicationPreset) {
    if (busyKey) return;
    setBusyKey(preset.key);
    setMessage(undefined);
    setError(undefined);
    try {
      await onLogAgain(preset);
      setMessage(`${preset.title} recorded just now.`);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The medication could not be recorded.',
      );
    } finally {
      setBusyKey(undefined);
    }
  }

  return (
    <SectionCard>
      <View style={styles.header}>
        <View>
          <Text style={[styles.eyebrow, { color: colors.accent }]}>
            MEDICATION
          </Text>
          <Text style={[styles.title, { color: colors.text }]}>
            Medication record
          </Text>
        </View>
        <View
          style={[
            styles.count,
            {
              backgroundColor: `${colors.accent}16`,
              borderRadius: radius.pill,
            },
          ]}
        >
          <Text style={[styles.countText, { color: colors.accent }]}>
            {today.length} TODAY
          </Text>
        </View>
      </View>

      {today.length ? (
        <View style={styles.todayRows}>
          {today.slice(0, 5).map((event, index) => (
            <View
              key={event.id}
              style={[
                styles.todayRow,
                index < Math.min(today.length, 5) - 1 && {
                  borderBottomColor: colors.divider,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                },
              ]}
            >
              <View
                style={[
                  styles.medicationIcon,
                  {
                    backgroundColor: `${colors.primary}12`,
                    borderRadius: radius.sm,
                  },
                ]}
              >
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.primary}
                  name="medical-outline"
                  size={17}
                />
              </View>
              <View style={styles.todayCopy}>
                <Text style={[styles.medicationName, { color: colors.text }]}>
                  {event.title}
                </Text>
                <Text style={[styles.medicationMeta, { color: colors.textSecondary }]}>
                  {formatTime(event.start)}
                  {amountLabel(event) ? ` · ${amountLabel(event)}` : ''}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : (
        <Text style={[styles.empty, { color: colors.textSecondary }]}>
          Nothing has been recorded for this day. Absence here means “not
          recorded”, never “not taken”.
        </Text>
      )}

      {presets.length ? (
        <>
          <Text style={[styles.quickTitle, { color: colors.text }]}>
            Log a recent medication
          </Text>
          <View style={styles.quickList}>
            {presets.map((preset) => (
              <Pressable
                key={preset.key}
                accessibilityLabel={`Log ${preset.title} now`}
                accessibilityRole="button"
                disabled={Boolean(busyKey)}
                onPress={() => void logAgain(preset)}
                style={({ pressed }) => [
                  styles.quickRow,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderColor: colors.border,
                    borderRadius: radius.md,
                    opacity: pressed || busyKey ? 0.68 : 1,
                  },
                ]}
              >
                <View style={styles.quickCopy}>
                  <Text style={[styles.quickName, { color: colors.text }]}>
                    {preset.title}
                  </Text>
                  <Text style={[styles.quickMeta, { color: colors.textTertiary }]}>
                    {amountLabel(preset) ?? 'No amount saved'} · last{' '}
                    {relativeAge(preset.lastLoggedAt)}
                  </Text>
                </View>
                {busyKey === preset.key ? (
                  <ActivityIndicator color={colors.primary} size="small" />
                ) : (
                  <View
                    style={[
                      styles.logButton,
                      {
                        backgroundColor: colors.primary,
                        borderRadius: radius.pill,
                      },
                    ]}
                  >
                    <Ionicons
                      accessibilityElementsHidden
                      color={colors.onPrimary}
                      name="add"
                      size={16}
                    />
                    <Text style={[styles.logText, { color: colors.onPrimary }]}>
                      Log now
                    </Text>
                  </View>
                )}
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      {message ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.feedback, { color: colors.accent }]}
        >
          {message}
        </Text>
      ) : null}
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.feedback, { color: colors.danger }]}
        >
          {error}
        </Text>
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  eyebrow: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '900',
    letterSpacing: 1,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
    marginTop: 2,
  },
  count: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  countText: {
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  todayRows: {
    marginTop: 15,
  },
  todayRow: {
    minHeight: 57,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  medicationIcon: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayCopy: {
    flex: 1,
  },
  medicationName: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  medicationMeta: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 1,
  },
  empty: {
    fontSize: 11,
    lineHeight: 17,
    marginTop: 14,
  },
  quickTitle: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
    marginTop: 16,
  },
  quickList: {
    gap: 7,
    marginTop: 8,
  },
  quickRow: {
    minHeight: 58,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 11,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  quickCopy: {
    flex: 1,
  },
  quickName: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  quickMeta: {
    fontSize: 9,
    lineHeight: 14,
    marginTop: 1,
  },
  logButton: {
    minHeight: 32,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  logText: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
  },
  feedback: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 10,
  },
});
