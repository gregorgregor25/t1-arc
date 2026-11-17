import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useAppTheme } from '@/theme/theme';
import { PREFERRED_TOUCH_TARGET } from '@/theme/tokens';

/**
 * A full-screen sheet with a heading, a close button and scrolling content.
 * Android back closes it. Used for the History share options and the Health
 * edit options, so rarely used controls stay one tap away. It opens without
 * the slide animation when the phone is set to reduce motion.
 */
export function PageSheet({
  children,
  closeLabel,
  onClose,
  subtitle,
  title,
  visible,
}: {
  children: ReactNode;
  /** Spoken label for the close button, for example "Close share options". */
  closeLabel: string;
  onClose(): void;
  subtitle?: string;
  title: string;
  visible: boolean;
}) {
  const { colors, type } = useAppTheme();
  const reducedMotion = useReducedMotion();
  return (
    <Modal animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={onClose} presentationStyle="fullScreen" visible={visible}>
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerCopy}>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.text, fontSize: type.screenTitle }]}>
              {title}
            </Text>
            {subtitle ? (
              <Text style={[styles.subtitle, { color: colors.textSecondary, fontSize: type.body }]}>{subtitle}</Text>
            ) : null}
          </View>
          <Pressable
            accessibilityLabel={closeLabel}
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [
              styles.close,
              {
                backgroundColor: pressed ? colors.surfaceElevated : colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <Ionicons
              accessibilityElementsHidden
              color={colors.text}
              importantForAccessibility="no-hide-descendants"
              name="close"
              size={24}
            />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerCopy: { flex: 1, gap: 4 },
  title: { fontWeight: '700', lineHeight: 34 },
  subtitle: { lineHeight: 21 },
  close: {
    width: PREFERRED_TOUCH_TARGET,
    height: PREFERRED_TOUCH_TARGET,
    borderRadius: PREFERRED_TOUCH_TARGET / 2,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 40,
    gap: 12,
  },
});
