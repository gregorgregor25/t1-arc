import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '@/theme/theme';
import { PREFERRED_TOUCH_TARGET } from '@/theme/tokens';

import { StatusIndicator, type StatusTone, statusToneWord } from './StatusIndicator';

export interface ListRowProps {
  /** Main line, for example "Units and region". */
  title: string;
  /** Optional second line in secondary text. */
  detail?: string;
  /** Optional short value at the end, for example "mmol/L". */
  value?: string;
  /** Optional leading status shape; its word is spoken first. */
  status?: StatusTone;
  /** Replaces the default spoken status word (for example "Backup due"). */
  statusLabel?: string;
  /** Makes the row a button. Without it the row is plain, readable text. */
  onPress?: () => void;
  /** Shows the trailing chevron. Defaults to `true` when `onPress` is set. */
  showChevron?: boolean;
  /** Custom trailing element (for example a switch), shown after the value. */
  trailing?: ReactNode;
  disabled?: boolean;
  /** Overrides the composed label (status word, title, detail, value). */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** `link` for rows that open another screen in a browser-like way. */
  accessibilityRole?: 'button' | 'link';
  testID?: string;
}

/** Spoken label: status word, title, detail and value, in reading order. */
export function listRowAccessibilityLabel({
  title,
  detail,
  value,
  status,
  statusLabel,
}: Pick<ListRowProps, 'title' | 'detail' | 'value' | 'status' | 'statusLabel'>): string {
  return [status ? statusToneWord(status, statusLabel) : undefined, title, detail, value]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(', ');
}

/**
 * One row of a settings or record list: optional status shape, title, detail,
 * trailing value and chevron. At least 48 dp tall; text wraps and scales with
 * the system font size. Usually placed inside a `ListGroup`.
 */
export function ListRow({
  title,
  detail,
  value,
  status,
  statusLabel,
  onPress,
  showChevron = onPress !== undefined,
  trailing,
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole = 'button',
  testID,
}: ListRowProps) {
  const { colors, type } = useAppTheme();
  const label =
    accessibilityLabel ?? listRowAccessibilityLabel({ title, detail, value, status, statusLabel });

  const content = (
    <>
      {status ? <StatusIndicator tone={status} /> : null}
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.text, fontSize: type.bodyLarge }]}>{title}</Text>
        {detail ? (
          <Text style={[styles.detail, { color: colors.textSecondary, fontSize: type.callout }]}>
            {detail}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text style={[styles.value, { color: colors.textSecondary, fontSize: type.body }]}>{value}</Text>
      ) : null}
      {trailing}
      {showChevron ? (
        <Ionicons
          accessibilityElementsHidden
          color={colors.textSecondary}
          importantForAccessibility="no-hide-descendants"
          name="chevron-forward"
          size={18}
        />
      ) : null}
    </>
  );

  if (!onPress) {
    // A plain row reads as one item. When it hosts its own control (for
    // example a switch) it must stay a container so the control is reachable.
    const grouped = trailing === undefined || trailing === null;
    return (
      <View
        accessibilityHint={grouped ? accessibilityHint : undefined}
        accessibilityLabel={grouped ? label : undefined}
        accessible={grouped}
        style={styles.row}
        testID={testID}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={label}
      accessibilityRole={accessibilityRole}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { opacity: disabled ? 0.5 : pressed ? 0.7 : 1 }]}
      testID={testID}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: PREFERRED_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  copy: {
    flex: 1,
    flexShrink: 1,
    gap: 2,
  },
  title: {
    lineHeight: 22,
  },
  detail: {
    lineHeight: 20,
  },
  value: {
    flexShrink: 1,
    maxWidth: '45%',
    textAlign: 'right',
    lineHeight: 20,
  },
});
