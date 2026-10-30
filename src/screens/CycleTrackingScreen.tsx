import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useNavigation, type NavigationProp } from '@react-navigation/native';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Alert } from '@/components/appAlert';
import { AppScreen } from '@/components/AppScreen';
import { EmptyState } from '@/components/EmptyState';
import { ErrorCard } from '@/components/ErrorCard';
import { SectionCard } from '@/components/SectionCard';
import { clearManualCycleTracking, deleteCycleDay, deleteCyclePeriod, loadCycleTracking, saveCycleDay, saveCyclePeriod, type CyclePeriod, type CycleSnapshot } from '@/data/cycleTracking';
import { localCycleDate } from '@/domain/cycleTracking';
import { formatDate, type DateKey } from '@/domain/time';
import type { RootTabParamList } from '@/navigation/AppNavigator';
import { useDataContext } from '@/providers/DataProvider';
import { useAppTheme } from '@/theme/theme';

type Flow = 'spotting' | 'light' | 'medium' | 'heavy';
type PeriodAction = 'start' | 'end' | undefined;
const SYMPTOMS = ['Cramps', 'Headache', 'Low energy', 'Other'] as const;
const FLOWS: { label: string; value: Flow }[] = [
  { label: 'Spotting', value: 'spotting' }, { label: 'Light', value: 'light' },
  { label: 'Medium', value: 'medium' }, { label: 'Heavy', value: 'heavy' },
];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function monthFrom(date: DateKey) { return date.slice(0, 7); }
function monthKey(year: number, monthZero: number) {
  const date = new Date(Date.UTC(year, monthZero, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
function shiftMonth(month: string, offset: number) {
  const [year, value] = month.split('-').map(Number);
  return monthKey(year!, value! - 1 + offset);
}
function monthCells(month: string): (DateKey | undefined)[] {
  const [year, value] = month.split('-').map(Number);
  const firstWeekday = (new Date(Date.UTC(year!, value! - 1, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year!, value!, 0)).getUTCDate();
  return [...Array.from({ length: firstWeekday }, () => undefined),
    ...Array.from({ length: days }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}` as DateKey)];
}
function includesDay(period: CyclePeriod, date: string, today: string) {
  return period.startDate <= date && date <= (period.endDate ?? today);
}
function dateLabel(date: string) {
  return formatDate(date as DateKey, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function CycleTrackingScreen() {
  const navigation = useNavigation<NavigationProp<RootTabParamList>>();
  const { colors, radius } = useAppTheme();
  const { now } = useDataContext();
  const today = localCycleDate(now) as DateKey;
  const [selectedDate, setSelectedDate] = useState<DateKey>(today);
  const [month, setMonth] = useState(monthFrom(today));
  const [snapshot, setSnapshot] = useState<CycleSnapshot>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState<CyclePeriod>();
  const [periodAction, setPeriodAction] = useState<PeriodAction>();
  const [flow, setFlow] = useState<Flow>();
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [dayDirty, setDayDirty] = useState(false);
  const [flowDirty, setFlowDirty] = useState(false);
  const loadGeneration = useRef(0);
  const focused = useRef(false);

  const refresh = useCallback(async () => {
    if (!focused.current) return;
    const generation = ++loadGeneration.current;
    try {
      const next = await loadCycleTracking();
      if (focused.current && generation === loadGeneration.current) { setSnapshot(next); setError(''); }
    } catch {
      if (focused.current && generation === loadGeneration.current) setError('Cycle history is unavailable. Try again.');
    } finally {
      if (focused.current && generation === loadGeneration.current) setLoading(false);
    }
  }, []);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    let active = true;
    void Promise.resolve().then(() => { if (active) void refresh(); });
    return () => { active = false; focused.current = false; loadGeneration.current++; };
  }, [refresh]));

  const periods = snapshot?.periods ?? [];
  const days = snapshot?.days ?? [];
  const savedDay = days.find((day) => day.date === selectedDate);
  const selectedPeriod = periods.find((period) => includesDay(period, selectedDate, today));
  const ongoingPeriod = periods.find((period) => period.source === 'manual' && !period.endDate);
  const openPeriod = ongoingPeriod && ongoingPeriod.startDate <= selectedDate ? ongoingPeriod : undefined;
  const estimate = snapshot?.nextPeriodEstimate;
  const estimatedDates = useMemo(() => {
    if (!estimate) return new Set<string>();
    return new Set([estimate.startDate]);
  }, [estimate]);

  function selectDay(date: DateKey, keepPeriod = false) {
    setSelectedDate(date);
    if (!keepPeriod) { setEditing(false); setEditingPeriod(undefined); setPeriodAction(undefined); }
    const day = days.find((item) => item.date === date);
    setFlow(day?.flow); setSymptoms(day?.symptoms ?? []); setNotes(day?.notes ?? '');
    setDayDirty(false); setFlowDirty(false);
  }
  function startLog() { selectDay(today); setMonth(monthFrom(today)); setEditing(true); setPeriodAction(ongoingPeriod ? undefined : 'start'); }
  function editPeriod(period: CyclePeriod) {
    if (period.readOnly) return;
    selectDay(period.startDate as DateKey);
    setMonth(monthFrom(period.startDate as DateKey));
    setEditingPeriod(period);
    setPeriodAction('start');
    setEditing(true);
  }
  async function save() {
    if (saving) return;
    setSaving(true); setError('');
    try {
      if (selectedDate > today) throw new Error('You can only log dates up to today.');
      if (editingPeriod) {
        await saveCyclePeriod({ id: editingPeriod.id, startDate: periodAction === 'end' ? editingPeriod.startDate : selectedDate, endDate: periodAction === 'end' ? selectedDate : editingPeriod.endDate });
      } else if (periodAction === 'start') {
        await saveCyclePeriod({ startDate: selectedDate });
      } else if (periodAction === 'end') {
        if (!openPeriod) throw new Error('Log a period start before marking its end.');
        await saveCyclePeriod({ id: openPeriod.id, startDate: openPeriod.startDate, endDate: selectedDate });
      }
      if (dayDirty) {
        await saveCycleDay({ date: selectedDate, flow: savedDay?.flowSource === 'health-connect' && !flowDirty ? undefined : flow, symptoms, notes: notes.trim() });
      }
      await refresh(); setEditing(false); setEditingPeriod(undefined); setPeriodAction(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this entry. Please try again.');
    } finally { setSaving(false); }
  }
  function confirmDeletePeriod(period: CyclePeriod) {
    Alert.alert('Delete this period?', 'This removes only the period you logged in T1 Arc.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { void (async () => {
        try { await deleteCyclePeriod(period.id); await refresh(); setEditing(false); }
        catch { setError('Could not delete this period. Please try again.'); }
      })(); } },
    ]);
  }
  function confirmDeleteDay() {
    Alert.alert('Delete this day’s details?', 'The period dates will stay in your history.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { void (async () => {
        try { await deleteCycleDay(selectedDate); await refresh(); setEditing(false); setFlow(undefined); setSymptoms([]); setNotes(''); setDayDirty(false); setFlowDirty(false); }
        catch { setError('Could not delete this day’s details. Please try again.'); }
      })(); } },
    ]);
  }
  function confirmClearAll() {
    Alert.alert('Delete my cycle entries?', 'This permanently removes period dates and daily details you logged in T1 Arc. Records imported from Health Connect remain available there and can still appear here.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete my entries', style: 'destructive', onPress: () => { void (async () => {
        try { await clearManualCycleTracking(); await refresh(); setEditing(false); setFlow(undefined); setSymptoms([]); setNotes(''); }
        catch { setError('Could not delete your cycle entries. Please try again.'); }
      })(); } },
    ]);
  }

  const cellBorder = colors.surfaceBorder;
  return <AppScreen title="Cycle tracking" trailing={<Pressable accessibilityRole="button" accessibilityLabel="Back to health" onPress={() => navigation.navigate('Health')} style={styles.back}><Ionicons name="close" size={25} color={colors.textSecondary} /></Pressable>}>
    <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Your history, at a glance</Text>
    {loading ? <ActivityIndicator color={colors.primary} accessibilityLabel="Loading cycle history" style={styles.loading} /> : null}
    {error ? <ErrorCard message={error} /> : null}
    {!loading ? <>
      <Pressable accessibilityRole="button" onPress={startLog} style={[styles.primaryButton, { backgroundColor: colors.primary, borderRadius: radius.md }]}><Text style={[styles.primaryText, { color: colors.onPrimary }]}>Log period</Text></Pressable>
      <SectionCard style={styles.section}>
        {estimate ? <><Text style={[styles.h2, { color: colors.text }]}>Next period: around {dateLabel(estimate.startDate)}</Text><Text style={[styles.small, { color: colors.textSecondary }]}>Estimate based on {estimate.basedOnCycles} logged cycles. It may change.</Text></> : <Text style={[styles.small, { color: colors.textSecondary }]}>After a few cycles, an estimated next date can appear here. Estimates are not medical guidance.</Text>}
        <View style={styles.monthHeader}>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => setMonth(shiftMonth(month, -1))} hitSlop={8}><Ionicons name="chevron-back" size={22} color={colors.text} /></Pressable>
          <Text accessibilityRole="header" style={[styles.h2, { color: colors.text }]}>{formatDate(`${month}-01` as DateKey, { month: 'long', year: 'numeric' })}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => setMonth(shiftMonth(month, 1))} hitSlop={8}><Ionicons name="chevron-forward" size={22} color={colors.text} /></Pressable>
        </View>
        <View style={styles.calendar}>{WEEKDAYS.map((label) => <Text key={label} style={[styles.weekday, { color: colors.textSecondary }]}>{label}</Text>)}
          {monthCells(month).map((date, index) => date ? <Pressable key={date} accessibilityRole="button" accessibilityLabel={`${dateLabel(date)}${periods.some((period) => includesDay(period, date, today)) ? ', logged period' : estimatedDates.has(date) ? ', estimated period start' : ''}`} accessibilityState={{ selected: date === selectedDate }} onPress={() => { selectDay(date, Boolean(editingPeriod)); setEditing(date <= today); }} style={[styles.dayCell, date === selectedDate && { borderColor: colors.primary, borderWidth: 2 }, periods.some((period) => includesDay(period, date, today)) && styles.loggedDay, estimatedDates.has(date) && !periods.some((period) => includesDay(period, date, today)) && styles.estimatedDay]}><Text style={[styles.dayText, { color: periods.some((period) => includesDay(period, date, today)) ? '#1B1D24' : colors.text }]}>{Number(date.slice(-2))}</Text></Pressable> : <View key={`blank-${index}`} style={styles.dayCell} />)}
        </View>
        <View style={styles.legend}><View style={[styles.legendDot, styles.loggedDay]} /><Text style={[styles.small, { color: colors.textSecondary }]}>Logged period</Text><View style={[styles.legendDot, styles.estimatedDay]} /><Text style={[styles.small, { color: colors.textSecondary }]}>Estimated start</Text></View>
      </SectionCard>
      {editing ? <SectionCard style={styles.section}>
        <Text accessibilityRole="header" style={[styles.h2, { color: colors.text }]}>Log {dateLabel(selectedDate)}</Text>
        <Text style={[styles.small, { color: colors.textSecondary }]}>Choose a day on the calendar, then mark a period start or end. Daily details are optional.</Text>
        {ongoingPeriod && !editingPeriod ? <Text style={[styles.small, { color: colors.textSecondary }]}>A period starting {dateLabel(ongoingPeriod.startDate)} is still ongoing. Mark its end before logging another start.</Text> : null}
        {selectedPeriod?.readOnly && !editingPeriod ? <Text style={[styles.small, { color: colors.textSecondary }]}>A period imported from {selectedPeriod.sourceLabel ?? 'Health Connect'} is shown on this day. You can still add private notes.</Text> : null}
        <View style={styles.choiceRow}>
          {(['start', 'end'] as const).map((action) => <Pressable key={action} accessibilityRole="radio" accessibilityState={{ checked: periodAction === action, disabled: action === 'start' && Boolean(ongoingPeriod) && !editingPeriod }} disabled={action === 'start' && Boolean(ongoingPeriod) && !editingPeriod} onPress={() => setPeriodAction(periodAction === action ? undefined : action)} style={[styles.choice, { borderColor: cellBorder, borderRadius: radius.md, backgroundColor: periodAction === action ? colors.targetBand : colors.surface, opacity: action === 'start' && ongoingPeriod && !editingPeriod ? 0.45 : 1 }]}><Text style={[styles.choiceText, { color: colors.text }]}>{action === 'start' ? 'Period started' : 'Period ended'}</Text></Pressable>)}
        </View>
        <Text style={[styles.label, { color: colors.text }]}>Flow</Text>
        {savedDay?.flowSource === 'health-connect' ? <Text style={[styles.small, { color: colors.textSecondary }]}>Flow imported from Health Connect. Changing it creates a local entry.</Text> : null}
        <View style={styles.choiceRow}>{FLOWS.map((item) => <Pressable key={item.value} accessibilityRole="radio" accessibilityState={{ checked: flow === item.value }} onPress={() => { setFlow(flow === item.value ? undefined : item.value); setDayDirty(true); setFlowDirty(true); }} style={[styles.pill, { borderColor: flow === item.value ? colors.primary : cellBorder, backgroundColor: flow === item.value ? colors.primary : colors.surface }]}><Text style={{ color: flow === item.value ? colors.onPrimary : colors.text }}>{item.label}</Text></Pressable>)}</View>
        <Text style={[styles.label, { color: colors.text }]}>Symptoms</Text>
        <View style={styles.choiceRow}>{SYMPTOMS.map((symptom) => <Pressable key={symptom} accessibilityRole="checkbox" accessibilityState={{ checked: symptoms.includes(symptom) }} onPress={() => { setSymptoms((current) => current.includes(symptom) ? current.filter((item) => item !== symptom) : [...current, symptom]); setDayDirty(true); }} style={[styles.pill, { borderColor: symptoms.includes(symptom) ? colors.primary : cellBorder, backgroundColor: symptoms.includes(symptom) ? colors.targetBand : colors.surface }]}><Text style={{ color: colors.text }}>{symptom}</Text></Pressable>)}<Pressable accessibilityRole="button" accessibilityLabel="Clear symptoms" onPress={() => { setSymptoms([]); setDayDirty(true); }} style={[styles.pill, { borderColor: cellBorder, backgroundColor: symptoms.length ? colors.surface : colors.targetBand }]}><Text style={{ color: colors.text }}>None</Text></Pressable></View>
        <Text style={[styles.label, { color: colors.text }]}>Notes (optional)</Text>
        <TextInput accessibilityLabel="Cycle notes" multiline maxLength={1000} value={notes} onChangeText={(value) => { setNotes(value); setDayDirty(true); }} placeholder="Anything you want to remember" placeholderTextColor={colors.textTertiary} style={[styles.notes, { color: colors.text, borderColor: cellBorder, borderRadius: radius.md }]} />
        <Text style={[styles.small, { color: colors.textSecondary }]}>Saved privately on this phone. You choose what to share.</Text>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving }} disabled={saving} onPress={() => void save()} style={[styles.primaryButton, { backgroundColor: colors.primary, borderRadius: radius.md }]}><Text style={[styles.primaryText, { color: colors.onPrimary }]}>{saving ? 'Saving…' : 'Save entry'}</Text></Pressable>
        {savedDay && !savedDay.readOnly ? <Pressable accessibilityRole="button" onPress={confirmDeleteDay} style={styles.deleteLink}><Text style={{ color: colors.danger }}>Delete day’s details</Text></Pressable> : null}
        {editingPeriod ? <Pressable accessibilityRole="button" onPress={() => confirmDeletePeriod(editingPeriod)} style={styles.deleteLink}><Text style={{ color: colors.danger }}>Delete this period</Text></Pressable> : null}
      </SectionCard> : null}
      {!periods.length && !editing ? <EmptyState icon="calendar-outline" title="No cycles logged yet" detail="Log a period when you want to start tracking. Cycle tracking is optional." action={{ label: 'Log a period', onPress: startLog }} /> : null}
      {periods.length ? <SectionCard style={styles.section}><Text accessibilityRole="header" style={[styles.h2, { color: colors.text }]}>Period history</Text>{[...periods].sort((a, b) => b.startDate.localeCompare(a.startDate)).slice(0, 12).map((period) => <View key={`${period.source}-${period.id}`} style={[styles.historyRow, { borderColor: colors.divider }]}><View style={styles.historyText}><Text style={[styles.choiceText, { color: colors.text }]}>{dateLabel(period.startDate)}{period.endDate ? ` – ${dateLabel(period.endDate)}` : ' – ongoing'}</Text><Text style={[styles.small, { color: colors.textSecondary }]}>{period.readOnly ? `From ${period.sourceLabel ?? 'Health Connect'}` : 'Logged in T1 Arc'}</Text></View>{!period.readOnly ? <Pressable accessibilityRole="button" accessibilityLabel={`Edit period starting ${dateLabel(period.startDate)}`} onPress={() => editPeriod(period)} hitSlop={8}><Ionicons name="create-outline" size={21} color={colors.primary} /></Pressable> : null}</View>)}</SectionCard> : null}
      {periods.some((period) => !period.readOnly) || days.some((day) => !day.readOnly) ? <Pressable accessibilityRole="button" onPress={confirmClearAll} style={styles.deleteLink}><Text style={{ color: colors.danger }}>Delete my cycle entries</Text></Pressable> : null}
    </> : null}
  </AppScreen>;
}

const styles = StyleSheet.create({
  subtitle: { fontSize: 15, lineHeight: 22, marginBottom: 18 },
  back: { padding: 6 }, loading: { marginVertical: 40 }, section: { marginTop: 16 },
  primaryButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 14, paddingHorizontal: 16 },
  primaryText: { fontSize: 16, fontWeight: '700' },
  h2: { fontSize: 18, fontWeight: '700', lineHeight: 26 },
  small: { fontSize: 13, lineHeight: 19 },
  label: { fontSize: 15, fontWeight: '700', marginTop: 20, marginBottom: 8 },
  monthHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 12 },
  calendar: { flexDirection: 'row', flexWrap: 'wrap' },
  weekday: { width: '14.2857%', textAlign: 'center', paddingVertical: 9, fontSize: 12 },
  dayCell: { width: '14.2857%', height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24, borderWidth: 1, borderColor: 'transparent' },
  dayText: { fontSize: 14 },
  loggedDay: { backgroundColor: '#E8A4AC' },
  estimatedDay: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#C86778' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 15 },
  legendDot: { width: 13, height: 13, borderRadius: 7, marginLeft: 4 },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  choice: { flexGrow: 1, minHeight: 48, borderWidth: 1, padding: 10, justifyContent: 'center', alignItems: 'center' },
  choiceText: { fontSize: 14, fontWeight: '600' },
  pill: { minHeight: 40, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, justifyContent: 'center' },
  notes: { minHeight: 94, textAlignVertical: 'top', padding: 12, borderWidth: 1, fontSize: 15 },
  deleteLink: { alignSelf: 'center', padding: 12, marginTop: 3 },
  historyRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 12 },
  historyText: { flex: 1, gap: 3 },
});
