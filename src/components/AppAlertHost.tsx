import { useRef, useSyncExternalStore } from 'react';
import {
  AccessibilityInfo, findNodeHandle, Keyboard, Modal, Pressable,
  ScrollView, StyleSheet, Text, useWindowDimensions, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '@/theme/theme';
import { dismissAppAlert, getAppAlert, pressAppAlertButton, subscribeAppAlert } from './appAlert';

/** One app-themed surface for confirmations, choices and recoverable errors. */
export function AppAlertHost() {
  const dialog = useSyncExternalStore(subscribeAppAlert, getAppAlert, getAppAlert);
  const { colors, radius } = useAppTheme();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const titleRef = useRef<Text>(null);
  if (!dialog) return null;

  return (
    <Modal
      key={dialog.id}
      transparent
      visible
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => dismissAppAlert(dialog.id)}
      onShow={() => {
        Keyboard.dismiss();
        const handle = findNodeHandle(titleRef.current);
        if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
      }}
    >
      <View style={[styles.backdrop, { backgroundColor: colors.overlay, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        <Pressable
          accessible={false}
          importantForAccessibility="no"
          style={StyleSheet.absoluteFill}
          onPress={() => dismissAppAlert(dialog.id)}
        />
        <View accessibilityViewIsModal style={[styles.panel, {
          backgroundColor: colors.surfaceElevated,
          borderColor: colors.border,
          borderRadius: radius.xl,
          maxHeight: Math.max(160, height - insets.top - insets.bottom - 48),
        }]}>
          <ScrollView contentContainerStyle={styles.content} bounces={false} keyboardShouldPersistTaps="handled">
            <Text ref={titleRef} accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{dialog.title}</Text>
            {dialog.message ? <Text style={[styles.message, { color: colors.textSecondary }]}>{dialog.message}</Text> : null}
            <View style={styles.actions}>
              {dialog.buttons.map((button, index) => {
                const destructive = button.style === 'destructive';
                const cancel = button.style === 'cancel';
                return (
                  <Pressable
                    key={index}
                    accessibilityRole="button"
                    accessibilityLabel={button.text ?? 'OK'}
                    onPress={() => pressAppAlertButton(dialog.id, index)}
                    style={({ pressed }) => [styles.button, {
                      borderRadius: radius.md,
                      borderColor: destructive ? colors.danger : cancel ? colors.border : colors.primary,
                      backgroundColor: destructive ? `${colors.danger}18` : cancel ? colors.surfaceMuted : colors.primary,
                      opacity: pressed ? 0.75 : 1,
                    }]}
                  >
                    <Text style={[styles.buttonText, { color: destructive ? colors.danger : cancel ? colors.text : colors.onPrimary }]}>{button.text ?? 'OK'}</Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  panel: { width: '100%', maxWidth: 480, borderWidth: 1, overflow: 'hidden' },
  content: { padding: 24 },
  title: { fontSize: 22, lineHeight: 29, fontWeight: '800' },
  message: { fontSize: 16, lineHeight: 24, marginTop: 14 },
  actions: { gap: 10, marginTop: 24 },
  button: { minHeight: 48, paddingHorizontal: 18, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  buttonText: { fontSize: 16, lineHeight: 23, fontWeight: '700', textAlign: 'center' },
});
