import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { BolusDelivery } from '@/domain/models';
import { formatShortDate, formatTime, toDateKey } from '@/domain/time';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';

export function InsulinEventList({
  boluses,
  multiDay = false,
}: {
  boluses: BolusDelivery[];
  multiDay?: boolean;
}) {
  const { colors } = useAppTheme();
  const recent = [...boluses].sort((a, b) => b.timestamp - a.timestamp).slice(0, 8);
  return (
    <SectionCard>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Bolus deliveries</Text>
        <Text style={[styles.count, { color: colors.textSecondary }]}>
          {boluses.length} in range
        </Text>
      </View>
      {recent.length === 0 ? (
        <Text style={[styles.empty, { color: colors.textSecondary }]}>
          No bolus deliveries are present in this range.
        </Text>
      ) : (
        recent.map((delivery, index) => (
          <View
            key={delivery.id}
            style={[
              styles.row,
              index !== recent.length - 1 && {
                borderBottomColor: colors.divider,
                borderBottomWidth: StyleSheet.hairlineWidth,
              },
            ]}
          >
            <View style={[styles.icon, { backgroundColor: `${colors.insulin}18` }]}>
              <Ionicons
                accessibilityElementsHidden
                name="water-outline"
                color={colors.insulin}
                size={19}
              />
            </View>
            <View style={styles.rowCopy}>
              <Text style={[styles.time, { color: colors.text }]}>
                {formatTime(delivery.timestamp)}
              </Text>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>
                {[
                  multiDay
                    ? formatShortDate(toDateKey(delivery.timestamp))
                    : delivery.deliveryType || 'Delivered bolus',
                  delivery.carbsInputGrams === undefined
                    ? undefined
                    : `${delivery.carbsInputGrams.toFixed(0)} g entered`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
            <Text style={[styles.units, { color: colors.insulin }]}>
              {delivery.units.toFixed(1)} U
            </Text>
          </View>
        ))
      )}
      <Text style={[styles.note, { color: colors.textTertiary }]}>
        Exact imported events only. No dose intent is inferred.
      </Text>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 6,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
  },
  count: {
    fontSize: 12,
    lineHeight: 18,
  },
  row: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 10,
  },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCopy: {
    flex: 1,
  },
  time: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  meta: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 1,
  },
  units: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  empty: {
    fontSize: 13,
    lineHeight: 20,
    paddingVertical: 24,
  },
  note: {
    fontSize: 11,
    lineHeight: 17,
    marginTop: 10,
  },
});
