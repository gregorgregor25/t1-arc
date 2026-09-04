import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  DEFAULT_GLUCOSE_APPEARANCE,
  GLUCOSE_COLOR_PALETTE,
  GLUCOSE_RANGE_LABELS,
  GlucoseAppearanceSettings,
  GlucoseColorToken,
  GlucoseRange,
  validateGlucoseAppearance,
} from '@/domain/glucoseAppearance';
import { useGlucoseAppearance } from '@/providers/GlucoseAppearanceProvider';
import { useRegionalProfile } from '@/providers/RegionalProfileProvider';
import {
  formatGlucose,
  glucoseToMmolL,
  glucoseUnitLabel,
  glucoseUnitSpokenLabel,
} from '@/domain/regionalFormat';
import type { T1ArcRegionalDefaults } from '@/domain/regionalProfile';
import { normalizeRegionalNumberInput } from '@/domain/regionalNumberInput';
import { useAppTheme } from '@/theme/theme';

const RANGE_ORDER: GlucoseRange[] = [
  'veryLow',
  'low',
  'target',
  'high',
  'veryHigh',
  'stale',
];

const PALETTE_ORDER = Object.keys(
  GLUCOSE_COLOR_PALETTE,
) as GlucoseColorToken[];

interface ThresholdDraft {
  veryLowMax: string;
  targetMin: string;
  targetMax: string;
  veryHighMin: string;
}

function thresholdDraft(
  settings: GlucoseAppearanceSettings,
  regional: T1ArcRegionalDefaults,
): ThresholdDraft {
  return {
    veryLowMax: formatGlucose(settings.veryLowMax, regional, { withUnit: false }),
    targetMin: formatGlucose(settings.targetMin, regional, { withUnit: false }),
    targetMax: formatGlucose(settings.targetMax, regional, { withUnit: false }),
    veryHighMin: formatGlucose(settings.veryHighMin, regional, { withUnit: false }),
  };
}

function parseDraft(
  thresholds: ThresholdDraft,
  colors: GlucoseAppearanceSettings['colors'],
  regional: T1ArcRegionalDefaults,
): GlucoseAppearanceSettings {
  const parse = (value: string) =>
    glucoseToMmolL(
      normalizeRegionalNumberInput(value, regional.locale)?.value ?? Number.NaN,
      regional.glucoseUnit,
    );
  return {
    veryLowMax: parse(thresholds.veryLowMax),
    targetMin: parse(thresholds.targetMin),
    targetMax: parse(thresholds.targetMax),
    veryHighMin: parse(thresholds.veryHighMin),
    colors,
  };
}

export function GlucoseAppearanceSettingsScreen({
  onClose,
  visible,
}: {
  onClose(): void;
  visible: boolean;
}) {
  const { colors: themeColors, dark, radius } = useAppTheme();
  const { save, settings } = useGlucoseAppearance();
  const { defaults: regional } = useRegionalProfile();
  const [thresholds, setThresholds] = useState(() =>
    thresholdDraft(settings, regional),
  );
  const [rangeColors, setRangeColors] = useState(settings.colors);
  const [activeRange, setActiveRange] = useState<GlucoseRange>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!visible) return;
    // Opening this modal intentionally snapshots persisted settings into an
    // isolated editable draft; cancelling must discard any previous draft.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThresholds(thresholdDraft(settings, regional));
    setRangeColors(settings.colors);
    setActiveRange(undefined);
    setError(undefined);
  }, [regional, settings, visible]);

  const draft = useMemo(
    () => parseDraft(thresholds, rangeColors, regional),
    [rangeColors, regional, thresholds],
  );

  const descriptions = useMemo<Record<GlucoseRange, string>>(() => {
    const low = thresholds.veryLowMax || '—';
    const targetMin = thresholds.targetMin || '—';
    const targetMax = thresholds.targetMax || '—';
    const high = thresholds.veryHighMin || '—';
    return {
      veryLow: `At or below ${low} ${glucoseUnitLabel(regional.glucoseUnit)}`,
      low: `Above ${low}, below ${targetMin}`,
      target: `${targetMin} to ${targetMax} ${glucoseUnitLabel(regional.glucoseUnit)}`,
      high: `Above ${targetMax}, below ${high}`,
      veryHigh: `At or above ${high} ${glucoseUnitLabel(regional.glucoseUnit)}`,
      stale: 'Old or unavailable reading',
    };
  }, [regional.glucoseUnit, thresholds]);

  async function persist() {
    const validation = validateGlucoseAppearance(draft);
    if (validation) {
      setError(validation);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await save(draft);
      onClose();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Display settings could not be saved.',
      );
    } finally {
      setBusy(false);
    }
  }

  function confirmReset() {
    Alert.alert(
      'Restore T1 Arc defaults?',
      'This resets the four glucose boundaries and all display colours.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          onPress: () => {
            setThresholds(thresholdDraft(DEFAULT_GLUCOSE_APPEARANCE, regional));
            setRangeColors(DEFAULT_GLUCOSE_APPEARANCE.colors);
            setActiveRange(undefined);
            setError(undefined);
          },
        },
      ],
    );
  }

  return (
    <Modal
      animationType="slide"
      onRequestClose={() => {
        if (Keyboard.isVisible()) {
          Keyboard.dismiss();
          return;
        }
        onClose();
      }}
      presentationStyle="fullScreen"
      visible={visible}
    >
      <SafeAreaView
        edges={['top', 'bottom']}
        style={[styles.safeArea, { backgroundColor: themeColors.background }]}
      >
        <View
          style={[
            styles.header,
            {
              backgroundColor: themeColors.surface,
              borderBottomColor: themeColors.border,
            },
          ]}
        >
          <Pressable
            accessibilityLabel="Close glucose display settings"
            accessibilityRole="button"
            hitSlop={6}
            onPress={onClose}
            style={({ pressed }) => [
              styles.headerButton,
              pressed && { opacity: 0.55 },
            ]}
          >
            <Ionicons
              accessibilityElementsHidden
              color={themeColors.text}
              name="close"
              size={25}
            />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={[styles.eyebrow, { color: themeColors.primary }]}>
              GLUCOSE DISPLAY
            </Text>
            <Text style={[styles.title, { color: themeColors.text }]}>
              Ranges and colours
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void persist()}
            style={({ pressed }) => [
              styles.saveButton,
              {
                backgroundColor: themeColors.primary,
                borderRadius: radius.md,
              },
              pressed && !busy && { opacity: 0.72 },
            ]}
          >
            {busy ? (
              <ActivityIndicator color={themeColors.onPrimary} size="small" />
            ) : (
              <Text
                style={[styles.saveText, { color: themeColors.onPrimary }]}
              >
                Save
              </Text>
            )}
          </Pressable>
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.flex}
        >
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            <View
              style={[
                styles.intro,
                {
                  backgroundColor: themeColors.surfaceElevated,
                  borderColor: themeColors.border,
                  borderRadius: radius.lg,
                },
              ]}
            >
              <Ionicons
                accessibilityElementsHidden
                color={themeColors.primary}
                name="color-palette-outline"
                size={24}
              />
              <View style={styles.introCopy}>
                <Text
                  style={[styles.sectionTitle, { color: themeColors.text }]}
                >
                  One colour system everywhere
                </Text>
                <Text
                  style={[
                    styles.body,
                    { color: themeColors.textSecondary },
                  ]}
                >
                  These ranges control the current-value accent, persistent
                  notification and always-on display. Labels and reading age
                  remain visible, so colour is never the only signal.
                </Text>
              </View>
            </View>

            <Text style={[styles.sectionTitle, { color: themeColors.text }]}>
              Glucose boundaries
            </Text>
            <Text style={[styles.helper, { color: themeColors.textSecondary }]}>
              {glucoseUnitLabel(regional.glucoseUnit)} · values must increase from very low to very high
            </Text>
            <View
              style={[
                styles.thresholdGrid,
                {
                  backgroundColor: themeColors.surface,
                  borderColor: themeColors.border,
                  borderRadius: radius.lg,
                },
              ]}
            >
              <BoundaryField
                label="Very low at or below"
                onChangeText={(value) =>
                  setThresholds((current) => ({
                    ...current,
                    veryLowMax: value,
                  }))
                }
                value={thresholds.veryLowMax}
                unit={glucoseUnitLabel(regional.glucoseUnit)}
                spokenUnit={glucoseUnitSpokenLabel(regional.glucoseUnit)}
              />
              <BoundaryField
                label="Target starts"
                onChangeText={(value) =>
                  setThresholds((current) => ({
                    ...current,
                    targetMin: value,
                  }))
                }
                value={thresholds.targetMin}
                unit={glucoseUnitLabel(regional.glucoseUnit)}
                spokenUnit={glucoseUnitSpokenLabel(regional.glucoseUnit)}
              />
              <BoundaryField
                label="Target ends"
                onChangeText={(value) =>
                  setThresholds((current) => ({
                    ...current,
                    targetMax: value,
                  }))
                }
                value={thresholds.targetMax}
                unit={glucoseUnitLabel(regional.glucoseUnit)}
                spokenUnit={glucoseUnitSpokenLabel(regional.glucoseUnit)}
              />
              <BoundaryField
                label="Very high at or above"
                onChangeText={(value) =>
                  setThresholds((current) => ({
                    ...current,
                    veryHighMin: value,
                  }))
                }
                value={thresholds.veryHighMin}
                unit={glucoseUnitLabel(regional.glucoseUnit)}
                spokenUnit={glucoseUnitSpokenLabel(regional.glucoseUnit)}
              />
            </View>

            <Text style={[styles.sectionTitle, { color: themeColors.text }]}>
              Range colours
            </Text>
            <Text style={[styles.helper, { color: themeColors.textSecondary }]}>
              Tap a row, then choose a colour. T1 Arc adapts it for light,
              dark and low-power displays.
            </Text>
            <View
              style={[
                styles.rangeList,
                {
                  backgroundColor: themeColors.surface,
                  borderColor: themeColors.border,
                  borderRadius: radius.lg,
                },
              ]}
            >
              {RANGE_ORDER.map((range, index) => {
                const token = rangeColors[range];
                const palette = GLUCOSE_COLOR_PALETTE[token];
                const selected = activeRange === range;
                return (
                  <View key={range}>
                    <Pressable
                      accessibilityLabel={`${GLUCOSE_RANGE_LABELS[range]}, ${descriptions[range]}, colour ${palette.label}`}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: selected }}
                      onPress={() =>
                        setActiveRange(selected ? undefined : range)
                      }
                      style={({ pressed }) => [
                        styles.rangeRow,
                        index > 0 && {
                          borderTopColor: themeColors.divider,
                          borderTopWidth: StyleSheet.hairlineWidth,
                        },
                        pressed && {
                          backgroundColor: themeColors.surfaceMuted,
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.rangeDot,
                          {
                            backgroundColor: dark
                              ? palette.dark
                              : palette.light,
                          },
                        ]}
                      />
                      <View style={styles.rangeCopy}>
                        <Text
                          style={[
                            styles.rangeLabel,
                            { color: themeColors.text },
                          ]}
                        >
                          {GLUCOSE_RANGE_LABELS[range]}
                        </Text>
                        <Text
                          style={[
                            styles.rangeDetail,
                            { color: themeColors.textSecondary },
                          ]}
                        >
                          {descriptions[range]}
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.colourName,
                          { color: themeColors.textSecondary },
                        ]}
                      >
                        {palette.label}
                      </Text>
                      <Ionicons
                        accessibilityElementsHidden
                        color={themeColors.textTertiary}
                        name={selected ? 'chevron-up' : 'chevron-down'}
                        size={18}
                      />
                    </Pressable>
                    {selected ? (
                      <View
                        accessibilityLabel={`Choose ${GLUCOSE_RANGE_LABELS[range]} colour`}
                        accessibilityRole="radiogroup"
                        style={[
                          styles.palette,
                          {
                            backgroundColor: themeColors.surfaceMuted,
                            borderTopColor: themeColors.divider,
                          },
                        ]}
                      >
                        {PALETTE_ORDER.map((choice) => {
                          const choicePalette =
                            GLUCOSE_COLOR_PALETTE[choice];
                          const checked = token === choice;
                          return (
                            <Pressable
                              accessibilityLabel={choicePalette.label}
                              accessibilityRole="radio"
                              accessibilityState={{ checked }}
                              key={choice}
                              onPress={() => {
                                setRangeColors((current) => ({
                                  ...current,
                                  [range]: choice,
                                }));
                                setError(undefined);
                              }}
                              style={({ pressed }) => [
                                styles.swatchButton,
                                {
                                  borderColor: checked
                                    ? themeColors.text
                                    : 'transparent',
                                  borderRadius: radius.md,
                                },
                                pressed && { opacity: 0.65 },
                              ]}
                            >
                              <View
                                style={[
                                  styles.swatch,
                                  {
                                    backgroundColor: choicePalette.aod,
                                  },
                                ]}
                              >
                                {checked ? (
                                  <Ionicons
                                    accessibilityElementsHidden
                                    color="#071519"
                                    name="checkmark"
                                    size={19}
                                  />
                                ) : null}
                              </View>
                              <Text
                                numberOfLines={1}
                                style={[
                                  styles.swatchLabel,
                                  { color: themeColors.textSecondary },
                                ]}
                              >
                                {choicePalette.label}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>

            <View
              style={[
                styles.preview,
                {
                  backgroundColor: '#05090A',
                  borderColor: themeColors.border,
                  borderRadius: radius.lg,
                },
              ]}
            >
              <Text style={styles.previewEyebrow}>ALWAYS-ON PREVIEW</Text>
              <View style={styles.previewValues}>
                {(
                  [
                    ['2.9', 'veryLow'],
                    ['3.5', 'low'],
                    ['6.2', 'target'],
                    ['11.4', 'high'],
                    ['14.2', 'veryHigh'],
                  ] as const
                ).map(([value, range]) => (
                  <View key={range} style={styles.previewItem}>
                    <Text
                      style={[
                        styles.previewValue,
                        {
                          color:
                            GLUCOSE_COLOR_PALETTE[rangeColors[range]].aod,
                        },
                      ]}
                    >
                      {value}
                    </Text>
                    <Text style={styles.previewLabel}>
                      {GLUCOSE_RANGE_LABELS[range]}
                    </Text>
                  </View>
                ))}
              </View>
            </View>

            {error ? (
              <View
                accessibilityLiveRegion="assertive"
                style={[
                  styles.error,
                  {
                    backgroundColor: `${themeColors.danger}12`,
                    borderColor: `${themeColors.danger}66`,
                    borderRadius: radius.md,
                  },
                ]}
              >
                <Ionicons
                  accessibilityElementsHidden
                  color={themeColors.danger}
                  name="alert-circle-outline"
                  size={21}
                />
                <Text style={[styles.errorText, { color: themeColors.danger }]}>
                  {error}
                </Text>
              </View>
            ) : null}

            <Pressable
              accessibilityRole="button"
              onPress={confirmReset}
              style={({ pressed }) => [
                styles.resetButton,
                { borderColor: themeColors.border, borderRadius: radius.md },
                pressed && { backgroundColor: themeColors.surfaceMuted },
              ]}
            >
              <Ionicons
                accessibilityElementsHidden
                color={themeColors.textSecondary}
                name="refresh-outline"
                size={19}
              />
              <Text
                style={[
                  styles.resetText,
                  { color: themeColors.textSecondary },
                ]}
              >
                Restore T1 Arc defaults
              </Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function BoundaryField({
  label,
  onChangeText,
  spokenUnit,
  unit,
  value,
}: {
  label: string;
  onChangeText(value: string): void;
  spokenUnit: string;
  unit: string;
  value: string;
}) {
  const { colors, radius } = useAppTheme();
  return (
    <View style={styles.boundaryField}>
      <Text style={[styles.boundaryLabel, { color: colors.textSecondary }]}>
        {label}
      </Text>
      <View
        style={[
          styles.boundaryInputRow,
          {
            backgroundColor: colors.surfaceMuted,
            borderColor: colors.border,
            borderRadius: radius.md,
          },
        ]}
      >
        <TextInput
          accessibilityLabel={`${label} in ${spokenUnit}`}
          keyboardType="decimal-pad"
          maxLength={5}
          onChangeText={onChangeText}
          selectTextOnFocus
          style={[styles.boundaryInput, { color: colors.text }]}
          value={value}
        />
        <Text style={[styles.boundaryUnit, { color: colors.textTertiary }]}>
          {unit}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  header: {
    minHeight: 76,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: { flex: 1 },
  eyebrow: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '800',
    letterSpacing: 1.05,
  },
  title: { fontSize: 19, lineHeight: 25, fontWeight: '800', marginTop: 1 },
  saveButton: {
    minWidth: 70,
    minHeight: 44,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveText: { fontSize: 14, lineHeight: 19, fontWeight: '800' },
  content: { padding: 20, paddingBottom: 48, gap: 12 },
  intro: {
    padding: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 10,
  },
  introCopy: { flex: 1 },
  sectionTitle: { fontSize: 17, lineHeight: 23, fontWeight: '800' },
  body: { fontSize: 13, lineHeight: 20, marginTop: 4 },
  helper: { fontSize: 12, lineHeight: 18, marginTop: -7, marginBottom: 2 },
  thresholdGrid: {
    borderWidth: 1,
    padding: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 12,
  },
  boundaryField: { width: '47%', flexGrow: 1, minWidth: 132 },
  boundaryLabel: { fontSize: 11, lineHeight: 16, fontWeight: '700' },
  boundaryInputRow: {
    minHeight: 52,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  boundaryInput: {
    flex: 1,
    minHeight: 50,
    paddingLeft: 12,
    fontSize: 18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  boundaryUnit: {
    paddingRight: 10,
    fontSize: 9,
    lineHeight: 14,
    fontWeight: '700',
  },
  rangeList: { borderWidth: 1, overflow: 'hidden', marginBottom: 12 },
  rangeRow: {
    minHeight: 70,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  rangeDot: { width: 16, height: 16, borderRadius: 999 },
  rangeCopy: { flex: 1 },
  rangeLabel: { fontSize: 14, lineHeight: 19, fontWeight: '800' },
  rangeDetail: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  colourName: { fontSize: 11, lineHeight: 16, fontWeight: '700' },
  palette: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 4,
  },
  swatchButton: {
    width: '24%',
    minHeight: 68,
    padding: 5,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatch: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchLabel: {
    width: '100%',
    fontSize: 9,
    lineHeight: 13,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 4,
  },
  preview: { borderWidth: 1, padding: 16, marginBottom: 4 },
  previewEyebrow: {
    color: '#A9BDC2',
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  previewValues: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 13,
  },
  previewItem: { minWidth: 54, alignItems: 'center' },
  previewValue: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  previewLabel: {
    color: '#A9BDC2',
    fontSize: 8,
    lineHeight: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  error: {
    minHeight: 50,
    padding: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  errorText: { flex: 1, fontSize: 12, lineHeight: 18, fontWeight: '700' },
  resetButton: {
    minHeight: 50,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
  },
  resetText: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
});
