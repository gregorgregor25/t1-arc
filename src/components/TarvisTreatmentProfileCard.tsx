import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { SectionCard } from '@/components/SectionCard';
import {
  clearTarvisTreatmentProfile,
  observeTarvisTreatmentProfile,
  saveTarvisTreatmentProfile,
  type CarbRatioScheduleSegment,
} from '@/data/tarvis/treatmentProfile';
import {
  formatRegionalNumberInput,
  normalizeRegionalNumberInput,
} from '@/domain/regionalNumberInput';
import { formatRegionalNumber } from '@/domain/regionalFormat';
import {
  formatRegionalWallClock,
  formatRegionalWallClockMinute,
  parseRegionalWallClock,
} from '@/domain/regionalWallClock';
import { useRegionalProfile } from '@/providers/RegionalProfileProvider';
import { useAppTheme } from '@/theme/theme';

interface EditableSegment {
  id: string;
  ratio: string;
  time: string;
}

export function TarvisTreatmentProfileCard() {
  const { colors, radius } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const [segments, setSegments] = useState<EditableSegment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string>();

  useEffect(
    () =>
      observeTarvisTreatmentProfile((profile) => {
        setSegments(
          (profile?.carbRatioSchedule ?? []).map((segment) => ({
            id: segment.id,
            ratio: formatRegionalNumberInput(
              segment.gramsPerUnit,
              regional.locale,
            ),
            time: formatRegionalWallClockMinute(
              segment.startMinute,
              regional.locale,
            ),
          })),
        );
        setDirty(false);
        setLoaded(true);
      }),
    [regional.locale],
  );

  function update(id: string, patch: Partial<EditableSegment>) {
    setSegments((current) =>
      current.map((segment) =>
        segment.id === id ? { ...segment, ...patch } : segment,
      ),
    );
    setDirty(true);
    setMessage(undefined);
  }

  function addPeriod() {
    const startMinute = nextStartMinute(segments, regional.locale);
    setSegments((current) => [
      ...current,
      {
        id: `manual-ratio-${Date.now()}`,
        ratio: '',
        time: formatRegionalWallClockMinute(startMinute, regional.locale),
      },
    ]);
    setDirty(true);
    setMessage(undefined);
  }

  async function save() {
    if (working) return;
    setWorking(true);
    setMessage(undefined);
    try {
      const schedule = segments.map<CarbRatioScheduleSegment>((segment) => ({
        id: segment.id,
        startMinute: parseTime(segment.time, regional.locale),
        gramsPerUnit: parseRatio(segment.ratio, regional.locale),
      }));
      await saveTarvisTreatmentProfile(schedule);
      setMessage('Saved on this phone. Tarv1s can now use this as confirmed context.');
      setDirty(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The profile could not be saved.');
    } finally {
      setWorking(false);
    }
  }

  function confirmClear() {
    Alert.alert(
      'Remove saved ratios?',
      'This removes only the ratios entered in T1 Arc. It does not alter pump settings or imported records.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            setWorking(true);
            void clearTarvisTreatmentProfile()
              .then(() => setMessage('The manual ratio profile was removed.'))
              .catch(() => setMessage('The profile could not be removed.'))
              .finally(() => setWorking(false));
          },
        },
      ],
    );
  }

  return (
    <SectionCard style={styles.card}>
      <View style={styles.headingRow}>
        <View
          style={[
            styles.icon,
            { backgroundColor: colors.surfaceMuted, borderRadius: radius.md },
          ]}
        >
          <Ionicons color={colors.primary} name="options-outline" size={20} />
        </View>
        <View style={styles.headingCopy}>
          <Text style={[styles.eyebrow, { color: colors.accent }]}>DIABETES PROFILE</Text>
          <Text style={[styles.title, { color: colors.text }]}>Insulin-to-carb ratios</Text>
        </View>
      </View>

      <Text
        style={[styles.description, { color: colors.textSecondary }]}
      >
        Add the ratios already agreed in your care plan. Use one all-day value
        or add different time periods. Tarv1s may use them as context, but will
        never calculate or recommend a dose.
      </Text>

      {!loaded ? (
        <ActivityIndicator color={colors.primary} style={styles.loading} />
      ) : (
        <View style={styles.periods}>
          {segments.map((segment, index) => (
            <View
              key={segment.id}
              style={[
                styles.period,
                {
                  backgroundColor: colors.surfaceMuted,
                  borderColor: colors.border,
                  borderRadius: radius.md,
                },
              ]}
            >
              <View style={styles.field}>
                <Text style={[styles.label, { color: colors.textTertiary }]}>FROM</Text>
                <TextInput
                  accessibilityLabel={`Ratio period ${formatRegionalNumber(index + 1, regional.locale, { maximumFractionDigits: 0 })} start time`}
                  autoCapitalize="none"
                  maxLength={20}
                  onChangeText={(time) => update(segment.id, { time })}
                  placeholder={formatRegionalWallClock('00:00', regional.locale)}
                  placeholderTextColor={colors.textTertiary}
                  selectTextOnFocus
                  style={[
                    styles.input,
                    { borderColor: colors.border, color: colors.text },
                  ]}
                  value={segment.time}
                />
              </View>
              <View style={[styles.field, styles.ratioField]}>
                <Text style={[styles.label, { color: colors.textTertiary }]}>1 UNIT COVERS</Text>
                <View style={styles.ratioRow}>
                  <TextInput
                    accessibilityLabel={`Ratio period ${formatRegionalNumber(index + 1, regional.locale, { maximumFractionDigits: 0 })} grams per unit`}
                    keyboardType="decimal-pad"
                    maxLength={5}
                    onChangeText={(ratio) => update(segment.id, { ratio })}
                    placeholder="10"
                    placeholderTextColor={colors.textTertiary}
                    selectTextOnFocus
                    style={[
                      styles.input,
                      styles.ratioInput,
                      { borderColor: colors.border, color: colors.text },
                    ]}
                    value={segment.ratio}
                  />
                  <Text style={[styles.ratioSuffix, { color: colors.textSecondary }]}>g carbohydrate</Text>
                </View>
              </View>
              <Pressable
                accessibilityLabel={`Remove ratio period ${formatRegionalNumber(index + 1, regional.locale, { maximumFractionDigits: 0 })}`}
                accessibilityRole="button"
                disabled={working}
                hitSlop={8}
                onPress={() => {
                  setSegments((current) => current.filter(({ id }) => id !== segment.id));
                  setDirty(true);
                  setMessage(undefined);
                }}
                style={({ pressed }) => [styles.remove, { opacity: pressed ? 0.55 : 1 }]}
              >
                <Ionicons color={colors.textTertiary} name="close-circle-outline" size={22} />
              </Pressable>
            </View>
          ))}

          <Pressable
            accessibilityRole="button"
            disabled={working || segments.length >= 12}
            onPress={addPeriod}
            style={({ pressed }) => [
              styles.add,
              {
                borderColor: colors.border,
                borderRadius: radius.md,
                opacity: working || segments.length >= 12 ? 0.45 : pressed ? 0.68 : 1,
              },
            ]}
          >
            <Ionicons color={colors.primary} name="add" size={18} />
            <Text style={[styles.addText, { color: colors.primary }]}>Add time period</Text>
          </Pressable>
        </View>
      )}

      {message ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.message, { color: colors.textSecondary }]}
        >
          {message}
        </Text>
      ) : null}

      <View style={styles.actions}>
        {segments.length ? (
          <Pressable
            accessibilityRole="button"
            disabled={working}
            onPress={confirmClear}
            style={({ pressed }) => [styles.clear, { opacity: working ? 0.45 : pressed ? 0.65 : 1 }]}
          >
            <Text style={[styles.clearText, { color: colors.textSecondary }]}>Remove profile</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={!dirty || working || !segments.length}
          onPress={() => void save()}
          style={({ pressed }) => [
            styles.save,
            {
              backgroundColor: colors.primary,
              borderRadius: radius.md,
              opacity: !dirty || working || !segments.length ? 0.42 : pressed ? 0.72 : 1,
            },
          ]}
        >
          {working ? <ActivityIndicator color={colors.onPrimary} size="small" /> : null}
          <Text style={[styles.saveText, { color: colors.onPrimary }]}>Save profile</Text>
        </Pressable>
      </View>
    </SectionCard>
  );
}

function parseTime(value: string, locale: string) {
  const minute = parseRegionalWallClock(value, locale);
  if (minute === undefined) {
    throw new Error(
      `Use a valid start time, such as ${formatRegionalWallClock('07:30', locale)}.`,
    );
  }
  return minute;
}

function parseRatio(value: string, locale: string) {
  const ratio = normalizeRegionalNumberInput(value, locale)?.value;
  if (ratio === undefined || ratio < 1 || ratio > 100) {
    throw new Error('Enter a ratio between 1 and 100 grams per unit.');
  }
  return ratio;
}

function nextStartMinute(segments: EditableSegment[], locale: string) {
  if (!segments.length) return 0;
  const latest = segments
    .map(({ time }) => {
      try {
        return parseTime(time, locale);
      } catch {
        return 0;
      }
    })
    .sort((left, right) => left - right)
    .at(-1) ?? 0;
  return Math.min(1_380, latest + 360);
}

const styles = StyleSheet.create({
  actions: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'flex-end', marginTop: 18 },
  add: { alignItems: 'center', borderWidth: 1, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 46 },
  addText: { fontSize: 15, fontWeight: '700' },
  card: { gap: 0 },
  clear: { paddingHorizontal: 4, paddingVertical: 12 },
  clearText: { fontSize: 14, fontWeight: '600' },
  description: { fontSize: 15, lineHeight: 22, marginTop: 14 },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  field: { gap: 6, width: 88 },
  headingCopy: { flex: 1, gap: 2 },
  headingRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  icon: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 },
  input: { borderWidth: 1, fontSize: 16, fontWeight: '700', minHeight: 42, paddingHorizontal: 10, paddingVertical: 8 },
  label: { fontSize: 10, fontWeight: '800', letterSpacing: 0.7 },
  loading: { marginVertical: 24 },
  message: { fontSize: 13, lineHeight: 19, marginTop: 12 },
  period: { alignItems: 'flex-end', borderWidth: 1, flexDirection: 'row', gap: 12, padding: 12 },
  periods: { gap: 10, marginTop: 18 },
  ratioField: { flex: 1, width: undefined },
  ratioInput: { flex: 1 },
  ratioRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  ratioSuffix: { fontSize: 12, fontWeight: '700', lineHeight: 17, maxWidth: 88 },
  remove: { alignItems: 'center', height: 42, justifyContent: 'center', width: 30 },
  save: { alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 46, paddingHorizontal: 18 },
  saveText: { fontSize: 15, fontWeight: '800' },
  title: { fontSize: 19, fontWeight: '800' },
});
