import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text } from 'react-native';
import { useDataContext } from '@/providers/DataProvider';
import { useAppTheme } from '@/theme/theme';

/** Only mounted by the editor for a verified manually entered record. */
export function DeleteManualEntryButton({ id, insulin = false, disabled, onDeleted, onBusyChange }: {
  id: string;
  insulin?: boolean;
  disabled: boolean;
  onDeleted(): void;
  onBusyChange(busy: boolean): void;
}) {
  const { colors, radius } = useAppTheme();
  const { deleteManualContext, deleteManualInsulin, ownerIdentity } = useDataContext();
  const [busy, setBusy] = useState(false);
  const operation = useRef(false);
  const current = useRef({ id, ownerIdentity, disabled, active: true });
  useEffect(() => {
    current.current = { id, ownerIdentity, disabled, active: true };
    return () => { current.current.active = false; };
  }, [id, ownerIdentity, disabled]);

  const stillCurrent = () => current.current.active && current.current.id === id && current.current.ownerIdentity === ownerIdentity;

  function confirm() {
    if (current.current.disabled || operation.current || !stillCurrent()) return;
    Alert.alert('Delete this entry?', 'Only this manually recorded entry will be removed from T1 Arc. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete entry', style: 'destructive', onPress: () => { void remove(); } },
    ]);
  }

  async function remove() {
    if (current.current.disabled || operation.current || !stillCurrent()) return;
    operation.current = true;
    setBusy(true);
    onBusyChange(true);
    try {
      const removed = await (insulin ? deleteManualInsulin(id) : deleteManualContext(id));
      if (!stillCurrent()) return;
      if (removed) onDeleted();
      else Alert.alert('Entry not found', 'This entry may already have been removed. Close this form and refresh your history.');
    } catch {
      if (stillCurrent()) Alert.alert('Entry not deleted', 'Your entry has not been removed. Please try again.');
    } finally {
      operation.current = false;
      if (stillCurrent()) { setBusy(false); onBusyChange(false); }
    }
  }

  return <Pressable accessibilityRole="button" accessibilityLabel="Delete entry"
    accessibilityHint="Asks for confirmation before removing this manually recorded entry"
    accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy}
    onPress={confirm} style={({ pressed }) => [styles.button, {
      borderColor: colors.border, borderRadius: radius.md,
      opacity: disabled || busy ? 0.5 : pressed ? 0.65 : 1,
    }]}>
    <Ionicons name="trash-outline" size={20} color={colors.danger} accessibilityElementsHidden />
    <Text style={[styles.label, { color: colors.danger }]}>{busy ? 'Deleting…' : 'Delete entry'}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  button: { minHeight: 48, borderWidth: 1, padding: 12, marginTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  label: { fontSize: 14, fontWeight: '600', flexShrink: 1 },
});
