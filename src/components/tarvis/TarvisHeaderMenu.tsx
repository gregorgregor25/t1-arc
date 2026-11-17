import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppTheme } from '@/theme/theme';
import { PREFERRED_TOUCH_TARGET } from '@/theme/tokens';

import type { TarvisHeaderMenuItem, TarvisHeaderMenuItemId } from './headerMenuItems';

/**
 * The "More" button in the Tarv1s header and the short sheet it opens.
 * The sheet closes before an item runs, so the next screen or dialog is not
 * hidden behind it.
 */
export function TarvisHeaderMenu({
  items,
  onSelect,
  disabled = false,
}: {
  items: readonly TarvisHeaderMenuItem[];
  onSelect(id: TarvisHeaderMenuItemId): void;
  disabled?: boolean;
}) {
  const { colors, radius, type } = useAppTheme();
  const [open, setOpen] = useState(false);

  function choose(item: TarvisHeaderMenuItem) {
    if (item.disabled) return;
    setOpen(false);
    onSelect(item.id);
  }

  return (
    <>
      <Pressable
        accessibilityHint="Conversation history, notebook, export, report and Tarv1s settings"
        accessibilityLabel="More Tarv1s options"
        accessibilityRole="button"
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        hitSlop={6}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: radius.pill,
            opacity: disabled ? 0 : pressed ? 0.6 : 1,
          },
        ]}
      >
        <Ionicons accessibilityElementsHidden color={colors.text} name="ellipsis-horizontal" size={20} />
      </Pressable>
      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        statusBarTranslucent
        transparent
        visible={open}
      >
        <Pressable
          accessibilityLabel="Close menu"
          accessibilityRole="button"
          onPress={() => setOpen(false)}
          style={[styles.backdrop, { backgroundColor: colors.overlay }]}
        />
        <SafeAreaView edges={['bottom']} style={styles.sheetFrame} pointerEvents="box-none">
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: colors.surfaceElevated,
                borderColor: colors.border,
                borderTopLeftRadius: radius.lg,
                borderTopRightRadius: radius.lg,
              },
            ]}
          >
            <Text accessibilityRole="header" style={[styles.title, { color: colors.text, fontSize: type.title }]}>
              Tarv1s
            </Text>
            {items.map((item, index) => (
              <Pressable
                key={item.id}
                accessibilityHint={item.detail}
                accessibilityLabel={item.label}
                accessibilityRole="button"
                accessibilityState={{ disabled: item.disabled }}
                disabled={item.disabled}
                onPress={() => choose(item)}
                style={({ pressed }) => [
                  styles.row,
                  index > 0 && { borderTopColor: colors.divider, borderTopWidth: StyleSheet.hairlineWidth },
                  { opacity: item.disabled ? 0.5 : pressed ? 0.65 : 1 },
                ]}
              >
                <Ionicons accessibilityElementsHidden color={colors.primary} name={item.icon} size={21} />
                <View style={styles.rowCopy}>
                  <Text style={[styles.rowTitle, { color: colors.text, fontSize: type.bodyLarge }]}>{item.label}</Text>
                  <Text style={[{ color: colors.textSecondary, fontSize: type.callout }]}>
                    {item.detail}
                  </Text>
                </View>
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              onPress={() => setOpen(false)}
              style={({ pressed }) => [
                styles.cancel,
                { borderColor: colors.border, borderRadius: radius.md, opacity: pressed ? 0.65 : 1 },
              ]}
            >
              <Text style={[styles.cancelText, { color: colors.text, fontSize: type.bodyLarge }]}>Cancel</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    width: PREFERRED_TOUCH_TARGET,
    height: PREFERRED_TOUCH_TARGET,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  sheetFrame: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 16,
  },
  title: { fontWeight: '700', marginBottom: 6 },
  row: {
    minHeight: PREFERRED_TOUCH_TARGET + 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 10,
  },
  rowCopy: { flex: 1, gap: 2 },
  rowTitle: { fontWeight: '700' },
  cancel: {
    minHeight: PREFERRED_TOUCH_TARGET,
    marginTop: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: { fontWeight: '700' },
});
