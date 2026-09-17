import Ionicons from '@expo/vector-icons/Ionicons';
import { useLayoutEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { EvidenceReference } from '@/domain/insights';
import type { NotebookEntry } from '@/domain/personalNotebook';
import { notebookEntryFromAnswer, notebookSaveError } from '@/data/notebook/answerSnapshot';
import { saveNotebookEntry } from '@/data/notebook/notebookRepository';
import { acquireLocalDataWriteLease, assertLocalDataWriteLeaseCurrent, type LocalDataWriteLease } from '@/data/privacy/localDataWriteEpoch';
import { useDataContext } from '@/providers/DataProvider';
import { useAppTheme } from '@/theme/theme';
import type { TarvisAnswer } from '@/data/tarvis/types';

interface Props {
  id: string; title: string; answer: TarvisAnswer; evidence: EvidenceReference[]; createdAt: number;
  ownerIdentity: string; dataMode: string; disabled?: boolean;
  onSaved(entry: NotebookEntry): void;
}

export function SaveToNotebookButton(props: Props) {
  return <SaveAnswerButton key={`${props.id}\0${props.ownerIdentity}\0${props.dataMode}`} {...props} />;
}

function SaveAnswerButton({ id, title, answer, evidence, createdAt, ownerIdentity, dataMode, disabled, onSaved }: Props) {
  const current = useDataContext();
  const scope = useRef({ ownerIdentity: current.ownerIdentity, dataMode: current.dataMode });
  const mounted = useRef(false);
  const inFlight = useRef(false);
  useLayoutEffect(() => {
    scope.current = { ownerIdentity: current.ownerIdentity, dataMode: current.dataMode };
  }, [current.ownerIdentity, current.dataMode]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const { colors } = useAppTheme();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ entry: NotebookEntry; lease: LocalDataWriteLease }>();
  const [error, setError] = useState<string>();
  const busy = saving || disabled || ownerIdentity !== current.ownerIdentity || dataMode !== current.dataMode;
  function stillCurrent() {
    return mounted.current && scope.current.ownerIdentity === ownerIdentity && scope.current.dataMode === dataMode;
  }
  async function save() {
    if (busy || inFlight.current || !stillCurrent()) return;
    inFlight.current = true;
    setSaving(true);
    setError(undefined);
    try {
      if (saved) {
        await assertLocalDataWriteLeaseCurrent(saved.lease);
        if (stillCurrent()) onSaved(saved.entry);
        return;
      }
      const lease = await acquireLocalDataWriteLease();
      const entry = notebookEntryFromAnswer({ id, title, answer, evidence, createdAt, ownerIdentity, dataMode });
      await assertLocalDataWriteLeaseCurrent(lease);
      if (!stillCurrent()) return;
      const result = await saveNotebookEntry(entry, { ownerIdentity, dataMode }, lease);
      await assertLocalDataWriteLeaseCurrent(lease);
      if (stillCurrent()) setSaved({ entry: result, lease });
    } catch (reason) {
      if (stillCurrent()) setError(notebookSaveError(reason));
    } finally {
      inFlight.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  return <View>
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(busy), busy: saving }} disabled={Boolean(busy)} onPress={() => void save()} style={({ pressed }) => ({ minHeight: 48, flexDirection: 'row', gap: 8, alignItems: 'center', opacity: busy || pressed ? 0.55 : 1 })}>
      <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={18} color={colors.primary} accessibilityElementsHidden />
      <Text style={[styles.label, { color: colors.primary }]}>{saving ? 'Saving on your phone…' : saved ? 'Saved · Open notebook' : 'Save to notebook'}</Text>
    </Pressable>
    {error ? <Text accessibilityLiveRegion="polite" style={[styles.error, { color: colors.warning }]}>{error}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  label: { fontSize: 14, lineHeight: 21, fontWeight: '600', flexShrink: 1 },
  error: { fontSize: 14, lineHeight: 21 },
});
