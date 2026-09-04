import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SavedInsightReport } from '@/data/insights/insightReportRepository';
import { formatDate, toDateKey } from '@/domain/time';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';

function reviewLabel(report: SavedInsightReport) {
  return `Week ending ${formatDate(
    toDateKey(report.report.currentRange.end - 1),
    { day: 'numeric', month: 'short' },
  )}`;
}

export function InsightReviewHistoryCard({
  reports,
  selectedId,
  onSelect,
}: {
  reports: SavedInsightReport[];
  selectedId?: string;
  onSelect(report: SavedInsightReport): void;
}) {
  const { colors, radius } = useAppTheme();
  const unread = reports.filter((report) => !report.viewedAt).length;

  return (
    <SectionCard>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: colors.text }]}>
            Review history
          </Text>
          <Text style={[styles.detail, { color: colors.textSecondary }]}>
            Generated and stored privately on this phone.
          </Text>
        </View>
        {unread ? (
          <View
            style={[
              styles.unreadBadge,
              {
                backgroundColor: `${colors.accent}18`,
                borderColor: `${colors.accent}55`,
                borderRadius: radius.pill,
              },
            ]}
          >
            <Text style={[styles.unreadText, { color: colors.accent }]}>
              {unread} NEW
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.rows}>
        {reports.slice(0, 6).map((report) => {
          const selected = report.id === selectedId;
          return (
            <Pressable
              key={report.id}
              accessibilityLabel={`${reviewLabel(report)}. ${report.report.headline}`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onSelect(report)}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: selected
                    ? colors.surfaceMuted
                    : colors.surface,
                  borderColor: selected
                    ? `${colors.primary}88`
                    : colors.divider,
                  borderRadius: radius.md,
                  opacity: pressed ? 0.72 : 1,
                },
              ]}
            >
              <View
                style={[
                  styles.icon,
                  {
                    backgroundColor: `${colors.primary}14`,
                    borderRadius: radius.sm,
                  },
                ]}
              >
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.primary}
                  name="calendar-outline"
                  size={20}
                />
              </View>
              <View style={styles.copy}>
                <View style={styles.labelRow}>
                  <Text
                    style={[styles.label, { color: colors.textTertiary }]}
                  >
                    {reviewLabel(report)}
                  </Text>
                  {!report.viewedAt ? (
                    <View
                      accessibilityLabel="New review"
                      style={[
                        styles.dot,
                        { backgroundColor: colors.accent },
                      ]}
                    />
                  ) : null}
                </View>
                <Text
                  numberOfLines={2}
                  style={[styles.headline, { color: colors.text }]}
                >
                  {report.report.headline}
                </Text>
              </View>
              <Ionicons
                accessibilityElementsHidden
                color={colors.textTertiary}
                name={selected ? 'checkmark-circle' : 'chevron-forward'}
                size={20}
              />
            </Pressable>
          );
        })}
      </View>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerCopy: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
  },
  detail: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  unreadBadge: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  unreadText: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  rows: {
    gap: 8,
    marginTop: 16,
  },
  row: {
    minHeight: 72,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  icon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 99,
  },
  headline: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
    marginTop: 2,
  },
});
