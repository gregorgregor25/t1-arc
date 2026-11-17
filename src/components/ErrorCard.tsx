import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';

/**
 * A calm, specific error. `title` says what could not happen, `message` says
 * what the person can do. Technical text for support goes in `details`, which
 * stays hidden until the person opens it.
 */
export function ErrorCard({
  details,
  message,
  onRetry,
  retryLabel = 'Try again',
  title,
}: {
  details?: string;
  message: string;
  onRetry?(): void;
  retryLabel?: string;
  title: string;
}) {
  const { colors, radius } = useAppTheme();
  const [showDetails, setShowDetails] = useState(false);
  const extraDetails = details?.trim() && details.trim() !== message.trim()
    ? details.trim()
    : undefined;
  return (
    <SectionCard>
      <View style={styles.container}>
        <Ionicons
          accessibilityElementsHidden
          name="alert-circle-outline"
          color={colors.danger}
          size={24}
        />
        <View style={styles.copy}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
            {title}
          </Text>
          <Text style={[styles.message, { color: colors.textSecondary }]}>
            {message}
          </Text>
          {onRetry || extraDetails ? (
            <View style={styles.actions}>
              {onRetry ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={onRetry}
                  style={({ pressed }) => [
                    styles.retryButton,
                    {
                      borderColor: colors.border,
                      borderRadius: radius.md,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.primary}
                    name="refresh-outline"
                    size={17}
                  />
                  <Text style={[styles.actionText, { color: colors.primary }]}>
                    {retryLabel}
                  </Text>
                </Pressable>
              ) : null}
              {extraDetails ? (
                <Pressable
                  accessibilityHint="Shows technical details you can share with support"
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showDetails }}
                  onPress={() => setShowDetails((open) => !open)}
                  style={({ pressed }) => [styles.detailsButton, { opacity: pressed ? 0.7 : 1 }]}
                >
                  <Text style={[styles.actionText, { color: colors.textSecondary }]}>
                    Details
                  </Text>
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.textSecondary}
                    name={showDetails ? 'chevron-up' : 'chevron-down'}
                    size={16}
                  />
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {extraDetails && showDetails ? (
            <Text selectable style={[styles.details, { color: colors.textTertiary }]}>
              {extraDetails}
            </Text>
          ) : null}
        </View>
      </View>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 96,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  copy: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },
  message: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 3,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    marginTop: 10,
  },
  retryButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
  },
  detailsButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 4,
  },
  actionText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  details: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
  },
});
