import type { ReactNode } from 'react';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { SectionHeading } from '@/components/AppScreen';
import { useAppTheme } from '@/theme/theme';

import { HistoryFilterChips } from './HistoryFilterChips';
import {
  type HistoryRecordFilter,
  historyRecordFilterOptions,
  resolveHistoryRecordFilter,
} from './historyRecordFilters';

/**
 * History "Records": one heading and filter chips in place of the three
 * separate cards (Around the timeline, Insulin doses, Glucose + insulin).
 * The cards themselves are unchanged and keep their edit and delete actions.
 */
export function HistoryRecordsSection({
  context,
  contextCount,
  insulin,
  insulinMissing,
  summary,
}: {
  /** The "Around the timeline" list. */
  context: ReactNode;
  /** Number of context records, used for the empty message. */
  contextCount: number;
  /** The "Insulin doses" list; not offered when insulin is not connected. */
  insulin: ReactNode;
  insulinMissing: boolean;
  /** The "Glucose + insulin" summary card. */
  summary: ReactNode;
}) {
  const { colors, type } = useAppTheme();
  const [chosen, setChosen] = useState<HistoryRecordFilter>('context');
  const options = historyRecordFilterOptions(insulinMissing);
  const filter = resolveHistoryRecordFilter(chosen, options);

  return (
    <View style={styles.section}>
      <SectionHeading
        title="Records"
        detail="Choose which records to show for this period."
      />
      <HistoryFilterChips<HistoryRecordFilter>
        accessibilityLabel="Records to show"
        onChange={setChosen}
        options={options}
        value={filter}
      />
      <View style={styles.panel}>
        {filter === 'context' ? (
          contextCount > 0 ? (
            context
          ) : (
            <Text style={[styles.empty, { color: colors.textSecondary, fontSize: type.callout }]}>
              No notes, ketones, activity or other records around the timeline in this period.
            </Text>
          )
        ) : filter === 'insulin' ? (
          insulin
        ) : (
          summary
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 0 },
  panel: { marginTop: 12 },
  empty: { lineHeight: 21, paddingVertical: 8 },
});
