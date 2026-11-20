import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { SectionHeading } from '@/components/AppScreen';
import { useAppTheme } from '@/theme/theme';

import { HistoryFilterChips } from './HistoryFilterChips';
import {
  type HistoryRecordFilter,
  historyRecordFilterOptions,
  historyRecordListsFor,
  resolveHistoryRecordFilter,
} from './historyRecordFilters';

/**
 * History "Records": one heading and filter chips in place of the three
 * separate cards (Around the timeline, Insulin doses, Glucose + insulin).
 * "All" shows every card, as before. The cards themselves are unchanged and
 * keep their edit and delete actions and warnings. The chosen filter is held
 * by the screen so it survives changing the period.
 */
export function HistoryRecordsSection({
  context,
  contextCount,
  filter: chosen,
  insulin,
  insulinMissing,
  onFilterChange,
  summary,
}: {
  /** The "Around the timeline" list. */
  context: ReactNode;
  /** Number of context records, used for the empty message. */
  contextCount: number;
  filter: HistoryRecordFilter;
  /** The "Insulin doses" list; not offered when insulin is not connected. */
  insulin: ReactNode;
  insulinMissing: boolean;
  onFilterChange(filter: HistoryRecordFilter): void;
  /** The "Glucose + insulin" summary card. */
  summary: ReactNode;
}) {
  const { colors, type } = useAppTheme();
  const options = historyRecordFilterOptions(insulinMissing);
  const filter = resolveHistoryRecordFilter(chosen, options);
  const lists = historyRecordListsFor(filter, insulinMissing);

  return (
    <View style={styles.section}>
      <SectionHeading
        title="Records"
        detail="Choose which records to show for this period."
      />
      <HistoryFilterChips<HistoryRecordFilter>
        accessibilityLabel="Records to show"
        onChange={onFilterChange}
        options={options}
        value={filter}
      />
      <View style={styles.panel}>
        {lists.context ? (
          contextCount > 0 ? (
            context
          ) : (
            <Text style={[styles.empty, { color: colors.textSecondary, fontSize: type.callout }]}>
              No notes, ketones, activity or other records around the timeline in this period.
            </Text>
          )
        ) : null}
        {lists.insulin ? insulin : null}
        {lists.summary ? summary : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 0 },
  panel: { marginTop: 12, gap: 12 },
  empty: { lineHeight: 21, paddingVertical: 8 },
});
