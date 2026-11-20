import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '@/theme/theme';
import { PREFERRED_TOUCH_TARGET } from '@/theme/tokens';

import { StatusIndicator, type StatusTone, statusToneWord } from './StatusIndicator';

export interface StatusLineAction {
  label: string;
  onPress: () => void;
  accessibilityHint?: string;
}

export interface StatusLineProps {
  tone: StatusTone;
  /** Short state, for example "Backup due" or "Alarms on". */
  title: string;
  /** Supporting fact, for example "Last backup 19 days ago". */
  detail?: string;
  /** Replaces the default spoken status word for the tone. */
  statusLabel?: string;
  /** Optional text button at the end, for example "Back up". */
  action?: StatusLineAction;
  testID?: string;
}

/** Spoken summary of a status line: "Needs attention: Backup due. Last backup…" */
export function statusLineAccessibilityLabel({
  tone,
  title,
  detail,
  statusLabel,
}: Pick<StatusLineProps, 'tone' | 'title' | 'detail' | 'statusLabel'>): string {
  const summary = `${statusToneWord(tone, statusLabel)}: ${title}`;
  return detail ? `${summary}. ${detail}` : summary;
}

/**
 * One line of a status summary: shape, bold title, detail and an optional
 * action. The words are read as one item; the action is a separate button so
 * screen-reader users can reach it. Usually placed inside a `ListGroup`.
 */
export function StatusLine({ tone, title, detail, statusLabel, action, testID }: StatusLineProps) {
  const { colors, type } = useAppTheme();
  return (
    <View style={styles.row} testID={testID}>
      <View
        accessibilityLabel={statusLineAccessibilityLabel({ tone, title, detail, statusLabel })}
        accessible
        style={styles.summary}
      >
        <StatusIndicator tone={tone} />
        <View style={styles.copy}>
          <Text style={[styles.title, { color: colors.text, fontSize: type.bodyLarge }]}>{title}</Text>
          {detail ? (
            <Text style={[styles.detail, { color: colors.textSecondary, fontSize: type.callout }]}>
              {detail}
            </Text>
          ) : null}
        </View>
      </View>
      {action ? (
        <Pressable
          accessibilityHint={action.accessibilityHint}
          accessibilityLabel={action.label}
          accessibilityRole="button"
          onPress={action.onPress}
          style={({ pressed }) => [styles.action, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={[styles.actionLabel, { color: colors.primary, fontSize: type.body }]}>
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  summary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  copy: {
    flex: 1,
    flexShrink: 1,
    gap: 2,
  },
  title: {
    fontWeight: '700',
    lineHeight: 22,
  },
  detail: {
    lineHeight: 20,
  },
  action: {
    minHeight: PREFERRED_TOUCH_TARGET,
    minWidth: PREFERRED_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  actionLabel: {
    fontWeight: '700',
    textAlign: 'center',
  },
});
