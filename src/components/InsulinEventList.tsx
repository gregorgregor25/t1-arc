import Ionicons from '@expo/vector-icons/Ionicons';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { isManualInsulinDelivery } from '@/data/manualInsulin';
import { BolusDelivery } from '@/domain/models';
import {
  formatRegionalFixedNumber,
  formatRegionalNumber,
} from '@/domain/regionalFormat';
import { formatShortDate, formatTime, toDateKey } from '@/domain/time';
import { useRegionalProfile } from '@/providers/RegionalProfileProvider';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';

export function InsulinEventList({
  boluses,
  multiDay = false,
  onDeleteManualInsulin,
  onEditManualInsulin,
}: {
  boluses: BolusDelivery[];
  multiDay?: boolean;
  onDeleteManualInsulin?(id: string): Promise<boolean>;
  onEditManualInsulin?(delivery: BolusDelivery): void;
}) {
  const { colors } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const recent = [...boluses].sort((a, b) => b.timestamp - a.timestamp).slice(0, 8);
  return (
    <SectionCard>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Insulin doses</Text>
        <Text style={[styles.count, { color: colors.textSecondary }]}>
          {formatRegionalNumber(boluses.length, regional.locale, {
            maximumFractionDigits: 0,
          })} in range
        </Text>
      </View>
      {recent.length === 0 ? (
        <Text style={[styles.empty, { color: colors.textSecondary }]}>
          No insulin doses are present in this range.
        </Text>
      ) : (
        recent.map((delivery, index) => {
          const manual = isManualInsulinDelivery(delivery);
          return (
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
              <View
                style={[
                  styles.icon,
                  { backgroundColor: `${colors.insulin}18` },
                ]}
              >
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
                      : undefined,
                    delivery.deliveryType || 'Delivered insulin',
                    delivery.carbsInputGrams === undefined
                      ? undefined
                      : `${formatRegionalFixedNumber(delivery.carbsInputGrams, regional.locale, 0)} g entered`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              <View style={styles.trailing}>
                <Text style={[styles.units, { color: colors.insulin }]}>
                  {formatRegionalFixedNumber(
                    delivery.units,
                    regional.locale,
                    1,
                  )}{' '}
                  U
                </Text>
                {manual &&
                (onEditManualInsulin || onDeleteManualInsulin) ? (
                  <View style={styles.actions}>
                    {onEditManualInsulin ? (
                      <Pressable
                        accessibilityLabel="Edit manual insulin dose"
                        accessibilityRole="button"
                        hitSlop={4}
                        onPress={() => onEditManualInsulin(delivery)}
                        style={({ pressed }) => [
                          styles.action,
                          { opacity: pressed ? 0.55 : 1 },
                        ]}
                      >
                        <Ionicons
                          accessibilityElementsHidden
                          color={colors.primary}
                          name="create-outline"
                          size={18}
                        />
                      </Pressable>
                    ) : null}
                    {onDeleteManualInsulin ? (
                      <Pressable
                        accessibilityLabel="Delete manual insulin dose"
                        accessibilityRole="button"
                        hitSlop={4}
                        onPress={() =>
                          Alert.alert(
                            'Delete insulin dose?',
                            'This removes only this manual record. Imported insulin is never changed here.',
                            [
                              { text: 'Cancel', style: 'cancel' },
                              {
                                text: 'Delete dose',
                                style: 'destructive',
                                onPress: () => {
                                  void onDeleteManualInsulin(delivery.id)
                                    .then((deleted) => {
                                      if (!deleted) {
                                        Alert.alert(
                                          'Dose not deleted',
                                          'The manual dose was no longer available.',
                                        );
                                      }
                                    })
                                    .catch(() => {
                                      Alert.alert(
                                        'Dose not deleted',
                                        'T1 Arc could not delete the manual dose. Try again.',
                                      );
                                    });
                                },
                              },
                            ],
                          )
                        }
                        style={({ pressed }) => [
                          styles.action,
                          { opacity: pressed ? 0.55 : 1 },
                        ]}
                      >
                        <Ionicons
                          accessibilityElementsHidden
                          color={colors.danger}
                          name="trash-outline"
                          size={18}
                        />
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </View>
            </View>
          );
        })
      )}
      <Text style={[styles.note, { color: colors.textTertiary }]}>
        Recorded events only. No dose intent is inferred.
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
  trailing: {
    alignItems: 'flex-end',
    gap: 5,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  action: {
    minWidth: 28,
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
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
