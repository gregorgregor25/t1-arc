import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  ToastAndroid,
  View,
} from 'react-native';

import {
  getLocalDataSummary,
} from '@/data/privacy/localDataVault';
import {
  LocalDataSummary,
  localDataRecordCount,
  localDataStoredItemCount,
} from '@/domain/localDataSummary';
import { useDataContext } from '@/providers/DataProvider';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';

const EMPTY_SUMMARY: LocalDataSummary = {
  glucoseReadings: 0,
  insulinRecords: 0,
  contextRecords: 0,
  foodLogs: 0,
  foodRecipes: 0,
  healthConnectRecords: 0,
  retainedSourceExports: 0,
  notificationSourceEvents: 0,
  savedInsightReports: 0,
};

function VaultFact({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.fact}>
      <Text style={[styles.factValue, { color: colors.text }]}>
        {value.toLocaleString('en-GB')}
      </Text>
      <Text style={[styles.factLabel, { color: colors.textTertiary }]}>
        {label}
      </Text>
    </View>
  );
}

export function LocalDataControlCard({
  onErased,
}: {
  onErased(): void;
}) {
  const { colors, radius } = useAppTheme();
  const {
    eraseAllLocalHealthData,
    glookoSyncing,
    revision,
    syncing,
  } = useDataContext();
  const [summary, setSummary] = useState<LocalDataSummary>();
  const [erasing, setErasing] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void getLocalDataSummary()
      .then((next) => {
        if (active) setSummary(next);
      })
      .catch(() => {
        if (active) {
          setError('T1 Arc could not count the local records.');
        }
      });
    return () => {
      active = false;
    };
  }, [revision]);

  const disabled =
    erasing ||
    syncing ||
    glookoSyncing ||
    !summary ||
    localDataStoredItemCount(summary) === 0;

  async function erase() {
    setErasing(true);
    setError(undefined);
    try {
      const removed = await eraseAllLocalHealthData();
      setSummary(EMPTY_SUMMARY);
      onErased();
      if (Platform.OS === 'android') {
        ToastAndroid.show(
          `${localDataRecordCount(removed).toLocaleString('en-GB')} local records and ${removed.retainedSourceExports.toLocaleString('en-GB')} raw source copies erased.`,
          ToastAndroid.LONG,
        );
      }
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'The local data could not be erased.',
      );
    } finally {
      setErasing(false);
    }
  }

  function confirmErase() {
    Alert.alert(
      'Erase all T1 Arc health data?',
      'This removes glucose, insulin, food, context, Health Connect copies, saved reviews, original Glooko exports and notification evidence from this device. It also disconnects LibreLinkUp, Nightscout, xDrip and Glooko.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'This cannot be undone',
              'Create an encrypted backup first if you may need this history again. Android Health Connect permissions remain under Android control, but every T1 Arc category is switched off so erased records are not silently copied back.',
              [
                { text: 'Keep my data', style: 'cancel' },
                {
                  text: 'Erase this device',
                  style: 'destructive',
                  onPress: () => void erase(),
                },
              ],
            );
          },
        },
      ],
    );
  }

  return (
    <SectionCard>
      <View style={styles.header}>
        <View
          style={[
            styles.icon,
            {
              backgroundColor: `${colors.danger}12`,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.danger}
            name="shield-outline"
            size={23}
          />
        </View>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: colors.text }]}>
            What T1 Arc holds
          </Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            A live count from the encrypted database on this phone. Display
            colours and layout choices are not health records and are kept.
          </Text>
        </View>
      </View>

      {summary ? (
        <View
          accessibilityLabel={`${localDataRecordCount(summary)} local T1 Arc records and ${summary.retainedSourceExports} retained source exports`}
          style={[styles.facts, { borderColor: colors.divider }]}
        >
          <VaultFact label="Glucose" value={summary.glucoseReadings} />
          <VaultFact label="Insulin" value={summary.insulinRecords} />
          <VaultFact
            label="Food + context"
            value={
              summary.contextRecords +
              summary.foodLogs +
              summary.foodRecipes
            }
          />
          <VaultFact
            label="Health Connect"
            value={summary.healthConnectRecords}
          />
          <VaultFact
            label="Raw source copies"
            value={
              summary.retainedSourceExports +
              summary.notificationSourceEvents
            }
          />
          <VaultFact
            label="Saved reviews"
            value={summary.savedInsightReports}
          />
        </View>
      ) : (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Counting encrypted records…
          </Text>
        </View>
      )}

      <Text style={[styles.warning, { color: colors.textSecondary }]}>
        Erasing stops T1 Arc collectors, clears source credentials, Glooko
        cookies, pending notification captures and the Wear/widget glucose
        snapshot before deleting the encrypted records.
      </Text>
      {error ? (
        <Text
          accessibilityLiveRegion="assertive"
          style={[styles.error, { color: colors.danger }]}
        >
          {error}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPress={confirmErase}
        style={({ pressed }) => [
          styles.eraseButton,
          {
            borderColor: disabled ? colors.divider : `${colors.danger}88`,
            borderRadius: radius.md,
            opacity: pressed ? 0.65 : 1,
          },
        ]}
      >
        {erasing ? (
          <ActivityIndicator color={colors.danger} />
        ) : (
          <Ionicons
            accessibilityElementsHidden
            color={disabled ? colors.textTertiary : colors.danger}
            name="trash-outline"
            size={18}
          />
        )}
        <Text
          style={[
            styles.eraseText,
            { color: disabled ? colors.textTertiary : colors.danger },
          ]}
        >
          {erasing ? 'Erasing securely…' : 'Erase all data from this device'}
        </Text>
      </Pressable>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  icon: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '800',
  },
  body: {
    fontSize: 11,
    lineHeight: 17,
    marginTop: 3,
  },
  facts: {
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 16,
    paddingVertical: 6,
  },
  fact: {
    width: '33.333%',
    minHeight: 64,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  factValue: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  factLabel: {
    fontSize: 8,
    lineHeight: 12,
    fontWeight: '700',
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.35,
  },
  loading: {
    minHeight: 90,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  loadingText: {
    fontSize: 11,
    lineHeight: 16,
  },
  warning: {
    fontSize: 10,
    lineHeight: 16,
    marginTop: 13,
  },
  error: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 8,
  },
  eraseButton: {
    minHeight: 50,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
    paddingHorizontal: 14,
  },
  eraseText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
});
