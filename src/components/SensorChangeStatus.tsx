import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { SqliteHealthRecordStore } from '@/data/persistence/SqliteHealthRecordStore';
import type { ContextNoteEvent } from '@/domain/models';
import type { SensorChangeStatusValue } from '@/domain/sensorChange';
import { formatDate, formatTime, toDateKey } from '@/domain/time';
import { useDataContext } from '@/providers/DataProvider';
import { useAppTheme } from '@/theme/theme';

import { ManualContextCard } from './ManualContextCard';

/** Small inline context alongside glucose, without changing the value, freshness or alerts. */
export function SensorChangeStatus({ sourceId, onRecord }: {
  sourceId?: string;
  onRecord(): void;
}) {
  const { colors, radius } = useAppTheme();
  const { demoMode, deleteManualContext, now, ownerIdentity, repository, revision } = useDataContext();
  const store = useMemo(() => new SqliteHealthRecordStore(), []);
  const [snapshot, setSnapshot] = useState<{
    owner: string;
    sourceId?: string;
    value?: SensorChangeStatusValue;
  }>();
  const [editingEvent, setEditingEvent] = useState<ContextNoteEvent>();

  useEffect(() => {
    let active = true;
    if (demoMode || !repository) return;
    store.getSensorChangeStatus(sourceId, now).then((value) => {
      if (active) setSnapshot({ owner: ownerIdentity, sourceId, value });
    }).catch(() => {
      if (active) setSnapshot({ owner: ownerIdentity, sourceId });
    });
    return () => { active = false; };
  }, [demoMode, now, ownerIdentity, repository, revision, sourceId, store]);

  const status = !demoMode && snapshot?.owner === ownerIdentity && snapshot.sourceId === sourceId
    ? snapshot.value : undefined;
  const event = status?.waiting ? status.event : undefined;

  function editOrRemove() {
    if (!event) return;
    Alert.alert('Recorded sensor change', 'Edit the start time, or remove this note if it was added by mistake.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Edit time', onPress: () => setEditingEvent(event) },
      { text: 'Remove note', style: 'destructive', onPress: () => {
        void deleteManualContext(event.id).catch(() => {
          Alert.alert('Note not removed', 'Your sensor-change note is still saved. Please try again.');
        });
      } },
    ]);
  }

  return (
    <View style={styles.container}>
      {event ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Waiting for readings. Edit recorded sensor change"
          onPress={editOrRemove} style={styles.status}>
          <Ionicons name="time-outline" size={19} color={colors.textSecondary} accessibilityElementsHidden />
          <View style={styles.copy}>
            <Text style={[styles.title, { color: colors.text }]}>Waiting for readings</Text>
            <Text style={[styles.detail, { color: colors.textSecondary }]}>
              New sensor recorded {toDateKey(event.start) !== toDateKey(now) ? `${formatDate(toDateKey(event.start))} at ` : 'at '}{formatTime(event.start)}
            </Text>
          </View>
          <Ionicons name="create-outline" size={18} color={colors.textSecondary} accessibilityElementsHidden />
        </Pressable>
      ) : null}
      <Pressable accessibilityRole="button" onPress={onRecord}
        accessibilityLabel="Record sensor change"
        accessibilityHint="Opens a form to record when you changed your sensor. Nothing is saved until you confirm. This does not start a sensor or change alerts."
        style={({ pressed }) => [styles.action, {
          backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
          borderColor: colors.primary,
          borderRadius: radius.md,
        }]}>
        <Ionicons name="add-outline" size={20} color={colors.primary} accessibilityElementsHidden />
        <Text style={[styles.actionLabel, { color: colors.primary }]}>Record sensor change</Text>
      </Pressable>
      <ManualContextCard editingEvent={editingEvent} glucoseSourceId={sourceId}
        initialTimestamp={now} onEditEnd={() => setEditingEvent(undefined)} showLauncher={false} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 8 },
  copy: { flex: 1, gap: 2 },
  title: { fontSize: 14, fontWeight: '600' },
  detail: { fontSize: 13, lineHeight: 19 },
  action: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', maxWidth: '100%', gap: 8, minHeight: 48, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1 },
  actionLabel: { flexShrink: 1, fontSize: 14, fontWeight: '600' },
});
