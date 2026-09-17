import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { TimelineData } from '@/domain/models';
import { useDataContext } from '@/providers/DataProvider';
import { useAppTheme } from '@/theme/theme';

export function FoodCompletenessAction({ data }: { data: TimelineData }) {
  const { saveManualContext, deleteManualContext, demoMode } = useDataContext();
  const { colors } = useAppTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const notes = data.context.filter(event => event.observation?.kind === 'food-incomplete');
  async function toggle() {
    if (busy) return;
    setBusy(true); setError(undefined);
    try {
      if (notes.length) { for (const note of notes) await deleteManualContext(note.id); }
      else await saveManualContext({ kind: 'food-incomplete', timestamp: data.range.start, observation: { kind: 'food-incomplete' } });
    } catch { setError('Could not update this day. Tap again to retry.'); }
    finally { setBusy(false); }
  }
  return <View><Pressable accessibilityRole="checkbox" accessibilityState={{ checked: notes.length > 0, disabled: busy || demoMode }} disabled={busy || demoMode} onPress={() => void toggle()} style={{ minHeight: 48, padding: 12 }}><Text style={{ color: colors.primary }}>{notes.length ? '✓ Some food was not logged · Undo' : 'Some food was not logged'}</Text></Pressable>{error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}</View>;
}
