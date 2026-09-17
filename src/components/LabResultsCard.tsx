import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { usePersonalObservations } from '@/hooks/usePersonalObservations';
import { useDataContext } from '@/providers/DataProvider';
import { useAppTheme } from '@/theme/theme';
import { formatDate, toDateKey } from '@/domain/time';
import type { HealthContextEvent } from '@/domain/models';
import { ManualContextCard } from './ManualContextCard';
import { SectionCard } from './SectionCard';

export function LabResultsCard() {
  const { colors } = useAppTheme();
  const { now, demoMode } = useDataContext();
  const observations = usePersonalObservations('lab-result');
  const [editing, setEditing] = useState<HealthContextEvent>();
  const [launch, setLaunch] = useState(0);
  const results = observations.events.filter(event => event.observation?.kind === 'lab-result');
  return <SectionCard><View style={{ gap: 12 }}>
    <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 19, fontWeight: '700' }}>Lab results</Text>
    <Text style={{ color: colors.textSecondary }}>Measured results from your check-ups, entered by you. These stay separate from the glucose-based GMI on Today.</Text>
    {results.map(event => <Pressable key={event.id} accessibilityRole="button" onPress={() => setEditing(event)} style={{ padding: 14, minHeight: 48, borderRadius: 12, backgroundColor: colors.surfaceMuted }}><Text style={{ color: colors.text, fontWeight: '600' }}>{event.title}</Text><Text style={{ color: colors.textSecondary }}>{formatDate(toDateKey(event.start))}{event.observation?.kind === 'lab-result' && event.observation.laboratory ? ` · ${event.observation.laboratory}` : ''} · Tap to edit</Text></Pressable>)}
    {!results.length ? <Text style={{ color: colors.textSecondary }}>No laboratory results recorded yet.</Text> : null}
    {observations.error ? <Text style={{ color: colors.danger }}>{observations.error}</Text> : null}
    <Pressable accessibilityRole="button" disabled={demoMode} onPress={() => setLaunch(value => value + 1)} style={{ minHeight: 48, padding: 14 }}><Text style={{ color: colors.primary }}>Add lab result</Text></Pressable>
    <ManualContextCard initialKind="lab-result" initialTimestamp={now} launchRequest={launch} editingEvent={editing} onEditEnd={() => setEditing(undefined)} lockKind showLauncher={false} />
  </View></SectionCard>;
}
