import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppTheme } from '@/theme/theme';

export interface FoodToolsPageProps {
  visible: boolean;
  title: string;
  onBack(): void;
  backLabel?: string;
  busy?: boolean;
  children: ReactNode;
}

/** Secondary food entry surface. Its owner retains every form and meal draft. */
export function FoodToolsPage({
  visible,
  title,
  onBack,
  backLabel = 'Back to meal',
  busy = false,
  children,
}: FoodToolsPageProps) {
  const { colors, radius } = useAppTheme();

  function requestBack() {
    if (visible && !busy) onBack();
  }

  return (
    <Modal
      animationType="none"
      onRequestClose={requestBack}
      presentationStyle="fullScreen"
      statusBarTranslucent
      visible={visible}
    >
      <SafeAreaView
        accessibilityViewIsModal
        edges={['top', 'bottom', 'left', 'right']}
        style={[styles.screen, { backgroundColor: colors.background }]}
      >
        <KeyboardAvoidingView
          // Android already resizes this window for the keyboard.
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.screen}
        >
          <View style={[styles.header, { borderBottomColor: colors.divider }]}>
            <Pressable
              accessibilityLabel={backLabel}
              accessibilityRole="button"
              accessibilityState={{ disabled: busy, busy }}
              disabled={busy}
              onPress={requestBack}
              style={({ pressed }) => [styles.back, {
                borderRadius: radius.md,
                backgroundColor: pressed ? colors.surfaceMuted : colors.background,
                opacity: busy ? 0.45 : 1,
              }]}
            >
              <Text style={[styles.backLabel, { color: colors.primary }]}>{backLabel}</Text>
            </Pressable>
            <View style={styles.heading}>
              <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{title}</Text>
              {busy ? <ActivityIndicator accessibilityLabel="Working" color={colors.primary} /> : null}
            </View>
          </View>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            style={styles.screen}
          >
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    alignSelf: 'center', width: '100%', maxWidth: 720, minWidth: 0,
    paddingHorizontal: 20, paddingTop: 4, paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: {
    alignSelf: 'flex-start', minWidth: 48, minHeight: 48, maxWidth: '100%',
    paddingHorizontal: 12, paddingVertical: 12, justifyContent: 'center',
  },
  backLabel: { fontSize: 16, fontWeight: '700', flexShrink: 1 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8 },
  title: { fontSize: 24, fontWeight: '800', flex: 1, flexShrink: 1, minWidth: 0 },
  content: {
    flexGrow: 1, alignSelf: 'center', width: '100%', maxWidth: 720,
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 24, gap: 16,
  },
});
