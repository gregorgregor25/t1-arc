import Ionicons from '@expo/vector-icons/Ionicons';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
  MANUAL_CONTEXT_SOURCE_ID,
  manualContextDraftFromEvent,
  ManualContextDraft,
} from '@/data/manualContext';
import {
  formatDate,
  formatTime,
  toDateKey,
  zonedDateTimeToTimestamp,
} from '@/domain/time';
import { suggestedMealType } from '@/domain/mealTiming';
import { HealthContextEvent } from '@/domain/models';
import { useDataContext } from '@/providers/DataProvider';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';

type ContextKind = ManualContextDraft['kind'];
type MealType = Extract<ManualContextDraft, { kind: 'meal' }>['mealType'];
type ActivityType = Extract<
  ManualContextDraft,
  { kind: 'activity' }
>['activityType'];
type Intensity = Extract<
  ManualContextDraft,
  { kind: 'activity' }
>['intensity'];
type NoteCategory = Extract<
  ManualContextDraft,
  { kind: 'note' }
>['category'];

const kindOptions: {
  value: ContextKind;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { value: 'meal', label: 'Meal', icon: 'restaurant-outline' },
  { value: 'activity', label: 'Activity', icon: 'walk-outline' },
  { value: 'sleep', label: 'Sleep', icon: 'moon-outline' },
  { value: 'weight', label: 'Weight', icon: 'scale-outline' },
  { value: 'medication', label: 'Medication', icon: 'medical-outline' },
  { value: 'note', label: 'Note', icon: 'document-text-outline' },
];

function numberFromInput(value: string, label: string) {
  const normalised = value.trim().replace(',', '.');
  if (!normalised) throw new Error(`Enter ${label}.`);
  const number = Number(normalised);
  if (!Number.isFinite(number)) throw new Error(`Enter a valid ${label}.`);
  return number;
}

function optionalNumberFromInput(value: string, label: string) {
  if (!value.trim()) return undefined;
  return numberFromInput(value, label);
}

function clockParts(timestamp: number) {
  const [hour, minute] = formatTime(timestamp).split(':').map(Number);
  return { hour: hour ?? 0, minute: minute ?? 0 };
}

function kindLabel(kind: ContextKind) {
  return kindOptions.find((option) => option.value === kind)?.label ?? 'Context';
}

function FieldLabel({
  children,
  optional,
}: {
  children: string;
  optional?: boolean;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.labelRow}>
      <Text style={[styles.label, { color: colors.text }]}>{children}</Text>
      {optional ? (
        <Text style={[styles.optional, { color: colors.textTertiary }]}>
          Optional
        </Text>
      ) : null}
    </View>
  );
}

function ChoiceChips<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange(value: T): void;
}) {
  const { colors, radius } = useAppTheme();
  return (
    <View accessibilityLabel={label} accessibilityRole="radiogroup">
      <FieldLabel>{label}</FieldLabel>
      <View style={styles.chipWrap}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              key={option.value}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [
                styles.choiceChip,
                {
                  backgroundColor: selected
                    ? `${colors.primary}1B`
                    : colors.surfaceMuted,
                  borderColor: selected ? colors.primary : colors.border,
                  borderRadius: radius.pill,
                  opacity: pressed ? 0.68 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.choiceText,
                  {
                    color: selected ? colors.primaryStrong : colors.textSecondary,
                  },
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function FormInput({
  accessibilityLabel,
  keyboardType = 'default',
  onChangeText,
  placeholder,
  suffix,
  value,
  multiline = false,
}: {
  accessibilityLabel: string;
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad';
  onChangeText(value: string): void;
  placeholder: string;
  suffix?: string;
  value: string;
  multiline?: boolean;
}) {
  const { colors, radius } = useAppTheme();
  return (
    <View
      style={[
        styles.inputShell,
        {
          backgroundColor: colors.surfaceMuted,
          borderColor: colors.border,
          borderRadius: radius.md,
        },
      ]}
    >
      <TextInput
        accessibilityLabel={accessibilityLabel}
        keyboardType={keyboardType}
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        selectionColor={colors.primary}
        style={[
          styles.input,
          multiline && styles.multilineInput,
          { color: colors.text },
        ]}
        textAlignVertical={multiline ? 'top' : 'center'}
        value={value}
      />
      {suffix ? (
        <Text style={[styles.suffix, { color: colors.textSecondary }]}>
          {suffix}
        </Text>
      ) : null}
    </View>
  );
}

export function ManualContextCard({
  compact = false,
  editingEvent,
  initialTimestamp,
  launchRequest,
  onEditEnd,
  showLauncher = true,
}: {
  compact?: boolean;
  editingEvent?: HealthContextEvent;
  initialTimestamp: number;
  launchRequest?: number;
  onEditEnd?(): void;
  showLauncher?: boolean;
}) {
  const { colors, radius } = useAppTheme();
  const { saveManualContext } = useDataContext();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [savedMessage, setSavedMessage] = useState<string>();
  const [kind, setKind] = useState<ContextKind>('meal');
  const [timestamp, setTimestamp] = useState(initialTimestamp);
  const [title, setTitle] = useState('');
  const [carbs, setCarbs] = useState('');
  const [mealType, setMealType] = useState<MealType>(
    suggestedMealType(initialTimestamp),
  );
  const [activityType, setActivityType] = useState<ActivityType>('walk');
  const [duration, setDuration] = useState('');
  const [intensity, setIntensity] = useState<Intensity>('moderate');
  const [sleepQuality, setSleepQuality] = useState('');
  const [weight, setWeight] = useState('');
  const [medicationAmount, setMedicationAmount] = useState('');
  const [medicationUnit, setMedicationUnit] = useState('');
  const [noteCategory, setNoteCategory] =
    useState<NoteCategory>('illness');
  const [noteDetail, setNoteDetail] = useState('');
  const handledLaunchRequest = useRef(0);

  const selectedKind = useMemo(
    () => kindOptions.find((option) => option.value === kind)!,
    [kind],
  );

  function resetForm(nextTimestamp: number) {
    setKind('meal');
    setTimestamp(nextTimestamp);
    setTitle('');
    setCarbs('');
    setMealType(suggestedMealType(nextTimestamp));
    setActivityType('walk');
    setDuration('');
    setIntensity('moderate');
    setSleepQuality('');
    setWeight('');
    setMedicationAmount('');
    setMedicationUnit('');
    setNoteCategory('illness');
    setNoteDetail('');
    setError(undefined);
  }

  function populateForm(event: HealthContextEvent) {
    const draft = manualContextDraftFromEvent(event);
    resetForm(draft.timestamp);
    setKind(draft.kind);
    setTitle(draft.title ?? '');
    switch (draft.kind) {
      case 'meal':
        setMealType(draft.mealType);
        setCarbs(String(draft.carbsGrams));
        break;
      case 'activity':
        setActivityType(draft.activityType);
        setDuration(String(draft.durationMinutes));
        setIntensity(draft.intensity);
        break;
      case 'sleep':
        setDuration(String(draft.durationMinutes));
        setSleepQuality(
          draft.qualityPercent === undefined
            ? ''
            : String(draft.qualityPercent),
        );
        break;
      case 'weight':
        setWeight(String(draft.kilograms));
        break;
      case 'medication':
        setMedicationAmount(
          draft.amount === undefined ? '' : String(draft.amount),
        );
        setMedicationUnit(draft.unit ?? '');
        break;
      case 'note':
        setNoteCategory(draft.category);
        setNoteDetail(draft.detail ?? '');
        break;
    }
  }

  function begin() {
    resetForm(initialTimestamp);
    setOpen(true);
  }

  useEffect(() => {
    if (
      launchRequest === undefined ||
      launchRequest <= handledLaunchRequest.current
    ) {
      return;
    }
    handledLaunchRequest.current = launchRequest;
    begin();
  }, [launchRequest]);

  useEffect(() => {
    if (!editingEvent) return;
    if (
      editingEvent.origin !== 'manual' ||
      editingEvent.sourceId !== MANUAL_CONTEXT_SOURCE_ID
    ) {
      onEditEnd?.();
      return;
    }
    populateForm(editingEvent);
    setOpen(true);
  }, [editingEvent]);

  function close() {
    if (saving) return;
    setOpen(false);
    if (editingEvent) onEditEnd?.();
  }

  function chooseDate() {
    DateTimePickerAndroid.open({
      value: new Date(timestamp),
      mode: 'date',
      maximumDate: new Date(),
      onChange: (event, selected) => {
        if (event.type !== 'set' || !selected) return;
        const selectedDate = [
          selected.getFullYear(),
          String(selected.getMonth() + 1).padStart(2, '0'),
          String(selected.getDate()).padStart(2, '0'),
        ].join('-') as `${number}-${number}-${number}`;
        const { hour, minute } = clockParts(timestamp);
        setTimestamp(zonedDateTimeToTimestamp(selectedDate, hour, minute));
      },
    });
  }

  function chooseTime() {
    DateTimePickerAndroid.open({
      value: new Date(timestamp),
      mode: 'time',
      is24Hour: true,
      onChange: (event, selected) => {
        if (event.type !== 'set' || !selected) return;
        setTimestamp(
          zonedDateTimeToTimestamp(
            toDateKey(timestamp),
            selected.getHours(),
            selected.getMinutes(),
          ),
        );
      },
    });
  }

  function buildDraft(): ManualContextDraft {
    const customTitle = title.trim() || undefined;
    switch (kind) {
      case 'meal':
        return {
          kind,
          timestamp,
          title: customTitle,
          mealType,
          carbsGrams: numberFromInput(carbs, 'carbohydrate amount'),
        };
      case 'activity':
        return {
          kind,
          timestamp,
          title: customTitle,
          activityType,
          durationMinutes: numberFromInput(duration, 'duration'),
          intensity,
        };
      case 'sleep':
        return {
          kind,
          timestamp,
          title: customTitle,
          durationMinutes: numberFromInput(duration, 'sleep duration'),
          qualityPercent: optionalNumberFromInput(
            sleepQuality,
            'sleep quality',
          ),
        };
      case 'weight':
        return {
          kind,
          timestamp,
          title: customTitle,
          kilograms: numberFromInput(weight, 'weight'),
        };
      case 'medication':
        if (!customTitle) throw new Error('Enter the medication name.');
        return {
          kind,
          timestamp,
          title: customTitle,
          amount: optionalNumberFromInput(
            medicationAmount,
            'medication amount',
          ),
          unit: medicationUnit.trim() || undefined,
        };
      case 'note':
        return {
          kind,
          timestamp,
          title: customTitle,
          category: noteCategory,
          detail: noteDetail.trim() || undefined,
        };
    }
  }

  async function save() {
    setError(undefined);
    let draft: ManualContextDraft;
    try {
      draft = buildDraft();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Check the entered values.',
      );
      return;
    }

    setSaving(true);
    try {
      const event = await saveManualContext(draft, editingEvent);
      setSavedMessage(
        `${event.title} ${editingEvent ? 'updated' : 'saved'} at ${formatTime(event.start)}.`,
      );
      setOpen(false);
      if (editingEvent) onEditEnd?.();
      resetForm(initialTimestamp);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'The context event could not be saved.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {showLauncher ? (
        <SectionCard style={compact ? styles.compactCard : styles.card}>
          {compact ? (
            <Pressable
              accessibilityRole="button"
              onPress={begin}
              style={({ pressed }) => [
                styles.compactLauncher,
                pressed && { opacity: 0.68 },
              ]}
            >
              <View
                style={[
                  styles.compactIcon,
                  {
                    backgroundColor: `${colors.accent}18`,
                    borderRadius: radius.sm,
                  },
                ]}
              >
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.accent}
                  name="add"
                  size={21}
                />
              </View>
              <View style={styles.cardCopy}>
                <Text style={[styles.compactTitle, { color: colors.text }]}>
                  Log health context
                </Text>
                <Text
                  style={[
                    styles.compactDetail,
                    { color: colors.textSecondary },
                  ]}
                >
                  Activity, sleep, weight, medication or a note
                </Text>
              </View>
              <Ionicons
                accessibilityElementsHidden
                color={colors.textTertiary}
                name="chevron-forward"
                size={19}
              />
            </Pressable>
          ) : (
            <>
              <View style={styles.cardTop}>
                <View
                  style={[
                    styles.cardIcon,
                    {
                      backgroundColor: `${colors.accent}18`,
                      borderRadius: radius.md,
                    },
                  ]}
                >
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.accent}
                    name="add-circle-outline"
                    size={25}
                  />
                </View>
                <View style={styles.cardCopy}>
                  <Text style={[styles.cardTitle, { color: colors.text }]}>
                    Add health context
                  </Text>
                  <Text
                    style={[styles.cardBody, { color: colors.textSecondary }]}
                  >
                    Record meals, activity, sleep, weight, medication or what
                    was happening around your glucose. Every entry stays
                    labelled as yours.
                  </Text>
                </View>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={begin}
                style={({ pressed }) => [
                  styles.addButton,
                  {
                    backgroundColor: colors.primary,
                    borderRadius: radius.md,
                    opacity: pressed ? 0.76 : 1,
                  },
                ]}
              >
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.onPrimary}
                  name="add"
                  size={21}
                />
                <Text
                  style={[
                    styles.addButtonText,
                    { color: colors.onPrimary },
                  ]}
                >
                  Log context
                </Text>
              </Pressable>
            </>
          )}
          {savedMessage ? (
            <View
              accessibilityLiveRegion="polite"
              style={[
                styles.savedBanner,
                {
                  backgroundColor: `${colors.accent}12`,
                  borderColor: `${colors.accent}55`,
                  borderRadius: radius.sm,
                },
              ]}
            >
              <Ionicons
                accessibilityElementsHidden
                color={colors.accent}
                name="checkmark-circle-outline"
                size={18}
              />
              <Text
                style={[styles.savedText, { color: colors.textSecondary }]}
              >
                {savedMessage}
              </Text>
            </View>
          ) : null}
        </SectionCard>
      ) : null}

      <Modal
        animationType="slide"
        onRequestClose={() => {
          if (Keyboard.isVisible()) {
            Keyboard.dismiss();
            return;
          }
          close();
        }}
        presentationStyle="pageSheet"
        statusBarTranslucent
        visible={open}
      >
        <SafeAreaView
          edges={['top', 'bottom']}
          style={[styles.modalSafe, { backgroundColor: colors.background }]}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalSafe}
          >
            <View
              style={[
                styles.modalHeader,
                { borderBottomColor: colors.divider },
              ]}
            >
              <View>
                <Text style={[styles.modalEyebrow, { color: colors.primary }]}>
                  PERSONAL RECORD
                </Text>
                <Text
                  accessibilityRole="header"
                  style={[styles.modalTitle, { color: colors.text }]}
                >
                  {editingEvent ? 'Edit context' : 'Log context'}
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Close context form"
                accessibilityRole="button"
                disabled={saving}
                hitSlop={6}
                onPress={close}
                style={({ pressed }) => [
                  styles.closeButton,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderRadius: radius.pill,
                    opacity: pressed ? 0.65 : 1,
                  },
                ]}
              >
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.text}
                  name="close"
                  size={23}
                />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.form}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={[styles.helper, { color: colors.textSecondary }]}>
                {editingEvent
                  ? 'Correct this entry without changing its source identity. T1 Arc will refresh any evidence built from it.'
                  : 'These entries add context to your evidence timeline. T1 Arc does not use them to recommend doses.'}
              </Text>

              {editingEvent ? (
                <View
                  accessibilityLabel={`${selectedKind.label} entry type, fixed while editing`}
                  style={[
                    styles.lockedKind,
                    {
                      backgroundColor: `${colors.primary}10`,
                      borderColor: `${colors.primary}3D`,
                      borderRadius: radius.md,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.lockedKindIcon,
                      {
                        backgroundColor: `${colors.primary}18`,
                        borderRadius: radius.sm,
                      },
                    ]}
                  >
                    <Ionicons
                      accessibilityElementsHidden
                      color={colors.primary}
                      name={selectedKind.icon}
                      size={21}
                    />
                  </View>
                  <View style={styles.lockedKindCopy}>
                    <Text
                      style={[styles.lockedKindTitle, { color: colors.text }]}
                    >
                      {selectedKind.label}
                    </Text>
                    <Text
                      style={[
                        styles.lockedKindDetail,
                        { color: colors.textSecondary },
                      ]}
                    >
                      Entry type stays fixed while you correct its details.
                    </Text>
                  </View>
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.primary}
                    name="lock-closed-outline"
                    size={17}
                  />
                </View>
              ) : (
                <>
                  <FieldLabel>What are you recording?</FieldLabel>
                  <View
                    accessibilityLabel="Context type"
                    accessibilityRole="radiogroup"
                    style={styles.kindGrid}
                  >
                    {kindOptions.map((option) => {
                      const selected = option.value === kind;
                      return (
                        <Pressable
                          accessibilityRole="radio"
                          accessibilityState={{ checked: selected }}
                          key={option.value}
                          onPress={() => {
                            setKind(option.value);
                            setError(undefined);
                          }}
                          style={({ pressed }) => [
                            styles.kindButton,
                            {
                              backgroundColor: selected
                                ? `${colors.primary}16`
                                : colors.surface,
                              borderColor: selected
                                ? colors.primary
                                : colors.border,
                              borderRadius: radius.md,
                              opacity: pressed ? 0.68 : 1,
                            },
                          ]}
                        >
                          <Ionicons
                            accessibilityElementsHidden
                            color={
                              selected ? colors.primary : colors.textSecondary
                            }
                            name={option.icon}
                            size={21}
                          />
                          <Text
                            style={[
                              styles.kindText,
                              {
                                color: selected
                                  ? colors.primaryStrong
                                  : colors.textSecondary,
                              },
                            ]}
                          >
                            {option.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              )}

              <View style={styles.fieldGroup}>
                <FieldLabel>
                  {kind === 'sleep' ? 'Wake date and time' : 'Date and time'}
                </FieldLabel>
                <View style={styles.dateRow}>
                  <Pressable
                    accessibilityLabel={`Change date, currently ${formatDate(toDateKey(timestamp))}`}
                    accessibilityRole="button"
                    onPress={chooseDate}
                    style={({ pressed }) => [
                      styles.dateButton,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                        borderRadius: radius.md,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Ionicons
                      accessibilityElementsHidden
                      color={colors.primary}
                      name="calendar-outline"
                      size={19}
                    />
                    <Text
                      numberOfLines={1}
                      style={[styles.dateText, { color: colors.text }]}
                    >
                      {formatDate(toDateKey(timestamp), {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel={`Change time, currently ${formatTime(timestamp)}`}
                    accessibilityRole="button"
                    onPress={chooseTime}
                    style={({ pressed }) => [
                      styles.timeButton,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                        borderRadius: radius.md,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Ionicons
                      accessibilityElementsHidden
                      color={colors.primary}
                      name="time-outline"
                      size={19}
                    />
                    <Text style={[styles.dateText, { color: colors.text }]}>
                      {formatTime(timestamp)}
                    </Text>
                  </Pressable>
                </View>
                <Text style={[styles.timeZone, { color: colors.textTertiary }]}>
                  Europe/London time
                </Text>
              </View>

              {kind === 'meal' ? (
                <>
                  <ChoiceChips<MealType>
                    label="Meal type"
                    onChange={setMealType}
                    options={[
                      { value: 'breakfast', label: 'Breakfast' },
                      { value: 'lunch', label: 'Lunch' },
                      { value: 'dinner', label: 'Dinner' },
                      { value: 'snack', label: 'Snack' },
                    ]}
                    value={mealType}
                  />
                  <View style={styles.fieldGroup}>
                    <FieldLabel>Carbohydrate</FieldLabel>
                    <FormInput
                      accessibilityLabel="Carbohydrate in grams"
                      keyboardType="decimal-pad"
                      onChangeText={setCarbs}
                      placeholder="0"
                      suffix="g"
                      value={carbs}
                    />
                  </View>
                </>
              ) : null}

              {kind === 'activity' ? (
                <>
                  <ChoiceChips<ActivityType>
                    label="Activity type"
                    onChange={setActivityType}
                    options={[
                      { value: 'walk', label: 'Walk' },
                      { value: 'run', label: 'Run' },
                      { value: 'cycle', label: 'Cycle' },
                      { value: 'strength', label: 'Strength' },
                      { value: 'other', label: 'Other' },
                    ]}
                    value={activityType}
                  />
                  <View style={styles.fieldGroup}>
                    <FieldLabel>Duration</FieldLabel>
                    <FormInput
                      accessibilityLabel="Activity duration in minutes"
                      keyboardType="number-pad"
                      onChangeText={setDuration}
                      placeholder="30"
                      suffix="min"
                      value={duration}
                    />
                  </View>
                  <ChoiceChips<Intensity>
                    label="Intensity"
                    onChange={setIntensity}
                    options={[
                      { value: 'light', label: 'Light' },
                      { value: 'moderate', label: 'Moderate' },
                      { value: 'vigorous', label: 'Vigorous' },
                    ]}
                    value={intensity}
                  />
                </>
              ) : null}

              {kind === 'sleep' ? (
                <>
                  <View style={styles.fieldGroup}>
                    <FieldLabel>Sleep duration</FieldLabel>
                    <FormInput
                      accessibilityLabel="Sleep duration in minutes"
                      keyboardType="number-pad"
                      onChangeText={setDuration}
                      placeholder="450"
                      suffix="min"
                      value={duration}
                    />
                  </View>
                  <View style={styles.fieldGroup}>
                    <FieldLabel optional>Sleep quality</FieldLabel>
                    <FormInput
                      accessibilityLabel="Sleep quality percent"
                      keyboardType="number-pad"
                      onChangeText={setSleepQuality}
                      placeholder="80"
                      suffix="%"
                      value={sleepQuality}
                    />
                  </View>
                </>
              ) : null}

              {kind === 'weight' ? (
                <View style={styles.fieldGroup}>
                  <FieldLabel>Weight</FieldLabel>
                  <FormInput
                    accessibilityLabel="Weight in kilograms"
                    keyboardType="decimal-pad"
                    onChangeText={setWeight}
                    placeholder="75.0"
                    suffix="kg"
                    value={weight}
                  />
                </View>
              ) : null}

              {kind === 'medication' ? (
                <>
                  <View style={styles.fieldGroup}>
                    <FieldLabel>Medication name</FieldLabel>
                    <FormInput
                      accessibilityLabel="Medication name"
                      onChangeText={setTitle}
                      placeholder="Medication"
                      value={title}
                    />
                  </View>
                  <View style={styles.twoColumn}>
                    <View style={styles.column}>
                      <FieldLabel optional>Amount</FieldLabel>
                      <FormInput
                        accessibilityLabel="Medication amount"
                        keyboardType="decimal-pad"
                        onChangeText={setMedicationAmount}
                        placeholder="1"
                        value={medicationAmount}
                      />
                    </View>
                    <View style={styles.column}>
                      <FieldLabel optional>Unit</FieldLabel>
                      <FormInput
                        accessibilityLabel="Medication unit"
                        onChangeText={setMedicationUnit}
                        placeholder="tablet"
                        value={medicationUnit}
                      />
                    </View>
                  </View>
                </>
              ) : null}

              {kind === 'note' ? (
                <>
                  <ChoiceChips<NoteCategory>
                    label="What was happening?"
                    onChange={setNoteCategory}
                    options={[
                      { value: 'illness', label: 'Illness' },
                      { value: 'stress', label: 'Stress' },
                      { value: 'pump', label: 'Pod / site' },
                      { value: 'sensor', label: 'Sensor' },
                      { value: 'hormones', label: 'Hormones' },
                      { value: 'travel', label: 'Travel' },
                      { value: 'other', label: 'Other' },
                    ]}
                    value={noteCategory}
                  />
                  <View style={styles.fieldGroup}>
                    <FieldLabel optional>Details</FieldLabel>
                    <FormInput
                      accessibilityLabel="Context note details"
                      multiline
                      onChangeText={setNoteDetail}
                      placeholder="What did you notice?"
                      value={noteDetail}
                    />
                  </View>
                </>
              ) : null}

              {kind !== 'medication' ? (
                <View style={styles.fieldGroup}>
                  <FieldLabel optional>Label</FieldLabel>
                  <FormInput
                    accessibilityLabel={`${kindLabel(kind)} label`}
                    onChangeText={setTitle}
                    placeholder={`Name this ${kind}`}
                    value={title}
                  />
                </View>
              ) : null}

              {error ? (
                <View
                  accessibilityLiveRegion="assertive"
                  style={[
                    styles.error,
                    {
                      backgroundColor: `${colors.danger}10`,
                      borderColor: `${colors.danger}55`,
                      borderRadius: radius.sm,
                    },
                  ]}
                >
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.danger}
                    name="alert-circle-outline"
                    size={19}
                  />
                  <Text style={[styles.errorText, { color: colors.danger }]}>
                    {error}
                  </Text>
                </View>
              ) : null}
            </ScrollView>

            <View
              style={[
                styles.footer,
                {
                  backgroundColor: colors.background,
                  borderTopColor: colors.divider,
                },
              ]}
            >
              <Pressable
                accessibilityRole="button"
                disabled={saving}
                onPress={() => void save()}
                style={({ pressed }) => [
                  styles.saveButton,
                  {
                    backgroundColor: colors.primary,
                    borderRadius: radius.md,
                    opacity: pressed || saving ? 0.72 : 1,
                  },
                ]}
              >
                {saving ? (
                  <ActivityIndicator color={colors.onPrimary} />
                ) : (
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.onPrimary}
                    name="checkmark"
                    size={21}
                  />
                )}
                <Text
                  style={[styles.saveButtonText, { color: colors.onPrimary }]}
                >
                  {saving
                    ? 'Saving securely…'
                    : `${editingEvent ? 'Update' : 'Save'} ${kindLabel(kind).toLowerCase()}`}
                </Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 16,
  },
  compactCard: {
    padding: 0,
    overflow: 'hidden',
  },
  compactLauncher: {
    minHeight: 68,
    paddingHorizontal: 13,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  compactIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
  },
  compactDetail: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 1,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 13,
  },
  cardIcon: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardCopy: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '800',
  },
  cardBody: {
    fontSize: 13,
    lineHeight: 20,
    marginTop: 4,
  },
  addButton: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  addButtonText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  savedBanner: {
    minHeight: 42,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  savedText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  modalSafe: {
    flex: 1,
  },
  modalHeader: {
    minHeight: 74,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalEyebrow: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 1.05,
  },
  modalTitle: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  closeButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  form: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    padding: 18,
    paddingBottom: 30,
    gap: 22,
  },
  helper: {
    fontSize: 13,
    lineHeight: 20,
  },
  labelRow: {
    minHeight: 20,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },
  label: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '800',
  },
  optional: {
    fontSize: 11,
    lineHeight: 16,
  },
  kindGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  kindButton: {
    minHeight: 48,
    minWidth: '30%',
    flexGrow: 1,
    borderWidth: 1,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  kindText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  lockedKind: {
    minHeight: 66,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  lockedKindIcon: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockedKindCopy: {
    flex: 1,
    minWidth: 0,
  },
  lockedKindTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '800',
  },
  lockedKindDetail: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 1,
  },
  fieldGroup: {},
  inputShell: {
    minHeight: 52,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    minHeight: 50,
    flex: 1,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  multilineInput: {
    minHeight: 104,
    paddingTop: 14,
    paddingBottom: 14,
  },
  suffix: {
    paddingHorizontal: 14,
    fontSize: 13,
    fontWeight: '700',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  choiceChip: {
    minHeight: 44,
    minWidth: 76,
    borderWidth: 1,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  dateRow: {
    flexDirection: 'row',
    gap: 8,
  },
  dateButton: {
    minHeight: 52,
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  timeButton: {
    minHeight: 52,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
  },
  dateText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  timeZone: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 5,
  },
  twoColumn: {
    flexDirection: 'row',
    gap: 10,
  },
  column: {
    flex: 1,
    minWidth: 0,
  },
  error: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 11,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 14,
  },
  saveButton: {
    width: '100%',
    maxWidth: 680,
    minHeight: 54,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  saveButtonText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
});
