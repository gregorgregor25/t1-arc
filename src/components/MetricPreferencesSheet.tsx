import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { moveDisplayPriority } from '@/domain/displayPreferences';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useAppTheme } from '@/theme/theme';

export interface MetricPreferenceOption { id: string; label: string }

export function MetricPreferencesSheet({
  visible, mode, options, selected, onChange, onClose, onSave, onReset, saving, error,
}: {
  visible: boolean;
  mode: 'priorities' | 'visibility';
  options: MetricPreferenceOption[];
  selected: string[];
  onChange(ids: string[]): void;
  onClose(): void;
  onSave(): void;
  onReset(): void;
  saving: boolean;
  error?: string;
}) {
  const { colors, radius } = useAppTheme();
  const reducedMotion = useReducedMotion();
  const ordered = mode === 'priorities'
    ? selected.flatMap(id => options.filter(option => option.id === id))
    : options;
  return (
    <Modal visible={visible} animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={onClose} presentationStyle="pageSheet">
      <SafeAreaView style={[styles.page, { backgroundColor: colors.background }]}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
            {mode === 'priorities' ? 'Your priorities' : 'Your health view'}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel={saving ? "Close while saving" : "Cancel display changes"} onPress={onClose} style={({ pressed }) => [styles.action, { opacity: pressed ? 0.6 : 1 }]}>
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.description, { color: colors.textSecondary }]}>
            {mode === 'priorities' ? 'Move what matters up. Today shows the first three with available data.' : 'Choose what you want to see. Hidden sections still keep their records.'}
          </Text>
          {ordered.map((option, index) => {
            const checked = selected.includes(option.id);
            return (
              <View key={option.id} style={[styles.row, { borderBottomColor: colors.divider }]}>
                {mode === 'visibility' ? (
                  <Pressable accessibilityRole="checkbox" accessibilityState={{ checked, disabled: saving }} disabled={saving} accessibilityLabel={option.label} onPress={() => onChange(checked ? selected.filter(id => id !== option.id) : [...selected, option.id])} style={({ pressed }) => [styles.choice, { opacity: saving || pressed ? 0.6 : 1 }]}>
                    <Ionicons name={checked ? 'checkbox' : 'square-outline'} color={checked ? colors.primary : colors.textSecondary} size={24} />
                    <Text style={[styles.label, { color: colors.text }]}>{option.label}</Text>
                  </Pressable>
                ) : (
                  <>
                    <Text style={[styles.label, { color: colors.text }]}>{option.label}</Text>
                    {([-1, 1] as const).map(offset => {
                      const disabled = saving || index + offset < 0 || index + offset >= ordered.length;
                      return <Pressable key={offset} accessibilityRole="button" accessibilityLabel={`Move ${option.label} ${offset === -1 ? 'up' : 'down'}`} accessibilityState={{ disabled }} disabled={disabled} onPress={() => onChange(moveDisplayPriority(selected, option.id, offset))} style={({ pressed }) => [styles.action, { opacity: disabled ? 0.35 : pressed ? 0.6 : 1 }]}>
                        <Ionicons name={offset === -1 ? 'arrow-up' : 'arrow-down'} color={colors.primary} size={22} />
                      </Pressable>;
                    })}
                  </>
                )}
              </View>
            );
          })}
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving }} disabled={saving} onPress={onReset} style={({ pressed }) => [styles.reset, { opacity: saving || pressed ? 0.6 : 1 }]}>
            <Text style={[styles.link, { color: colors.primary }]}>{mode === 'priorities' ? 'Use default order' : 'Show all sections'}</Text>
          </Pressable>
          {error ? <Text accessibilityRole="alert" style={[styles.description, { color: colors.warning }]}>{error}</Text> : null}
        </ScrollView>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving, busy: saving }} disabled={saving} onPress={onSave} style={({ pressed }) => [styles.save, { backgroundColor: colors.primary, borderRadius: radius.md, opacity: saving || pressed ? 0.65 : 1 }]}>
          <Text style={[styles.saveText, { color: colors.onPrimary }]}>{saving ? 'Saving…' : 'Save choices'}</Text>
        </Pressable>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { flex: 1, fontSize: 24, lineHeight: 32, fontWeight: '700' },
  content: { padding: 20 },
  description: { fontSize: 15, lineHeight: 23, marginBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 64, borderBottomWidth: StyleSheet.hairlineWidth },
  label: { flex: 1, fontSize: 16, lineHeight: 24 },
  choice: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 10 },
  action: { minWidth: 48, minHeight: 48, justifyContent: 'center', alignItems: 'center' },
  reset: { minHeight: 48, justifyContent: 'center', marginTop: 16 },
  link: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  save: { minHeight: 52, margin: 20, alignItems: 'center', justifyContent: 'center', padding: 12 },
  saveText: { fontSize: 16, lineHeight: 24, fontWeight: '700' },
});
