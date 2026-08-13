import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  isLocalXdripConnection,
  normalizeXdripConnection,
  xdripEndpointLabel,
} from '@/data/xdrip/connection';
import { loadXdripConnection } from '@/data/xdrip/secureStore';
import {
  XDRIP_SOURCE_ID,
  XdripConnection,
  XdripError,
} from '@/data/xdrip/types';
import { SqliteGlucoseHistoryStore } from '@/data/persistence/SqliteGlucoseHistoryStore';
import { formatTime, relativeAge } from '@/domain/time';
import { useDataContext } from '@/providers/DataProvider';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';

const SAME_PHONE_ENDPOINT = '127.0.0.1:17580';

export function XdripSourceCard() {
  const { colors, radius } = useAppTheme();
  const { connectXdrip, disconnectXdrip, revision } = useDataContext();
  const [saved, setSaved] = useState<XdripConnection>();
  const [endpoint, setEndpoint] = useState('');
  const [editing, setEditing] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const [latest, setLatest] = useState<{
    mmolL: number;
    timestamp: number;
  }>();

  useEffect(() => {
    let active = true;
    void (async () => {
      const [connection, reading] = await Promise.all([
        loadXdripConnection(),
        (async () => {
          const store = new SqliteGlucoseHistoryStore();
          await store.initialize();
          return store.getLatestReading(XDRIP_SOURCE_ID);
        })(),
      ]);
      if (!active) return;
      setSaved(connection);
      if (connection) {
        setEndpoint(connection.endpointUrl);
        setEditing(false);
      }
      setLatest(
        reading
          ? { mmolL: reading.mmolL, timestamp: reading.timestamp }
          : undefined,
      );
    })().catch(() => undefined);
    return () => {
      active = false;
    };
  }, [revision]);

  async function testAndSave() {
    setError(undefined);
    let connection: XdripConnection;
    try {
      connection = normalizeXdripConnection(endpoint);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Check the xDrip address.',
      );
      return;
    }
    setWorking(true);
    try {
      const reading = await connectXdrip(connection);
      setSaved(connection);
      setEndpoint(connection.endpointUrl);
      setLatest({
        mmolL: reading.mmolL,
        timestamp: reading.timestamp,
      });
      setEditing(false);
    } catch (nextError) {
      setError(
        nextError instanceof XdripError || nextError instanceof Error
          ? nextError.message
          : 'T1 Arc could not connect to xDrip.',
      );
    } finally {
      setWorking(false);
    }
  }

  function confirmDisconnect() {
    Alert.alert(
      'Disconnect xDrip?',
      'This removes the saved connection. Glucose already copied into T1 Arc is kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setWorking(true);
              setError(undefined);
              try {
                await disconnectXdrip();
                setSaved(undefined);
                setEndpoint('');
                setLatest(undefined);
                setEditing(false);
              } catch (nextError) {
                setError(
                  nextError instanceof Error
                    ? nextError.message
                    : 'T1 Arc could not disconnect xDrip.',
                );
              } finally {
                setWorking(false);
              }
            })();
          },
        },
      ],
    );
  }

  if (saved && !editing) {
    return (
      <SectionCard>
        <View style={styles.header}>
          <View
            style={[
              styles.icon,
              {
                backgroundColor: `${colors.glucose}16`,
                borderRadius: radius.md,
              },
            ]}
          >
            <Ionicons
              accessibilityElementsHidden
              color={colors.glucose}
              name="git-network-outline"
              size={24}
            />
          </View>
          <View style={styles.headerCopy}>
            <Text style={[styles.title, { color: colors.text }]}>
              xDrip connected
            </Text>
            <Text style={[styles.body, { color: colors.textSecondary }]}>
              {xdripEndpointLabel(saved)} ·{' '}
              {isLocalXdripConnection(saved)
                ? 'this phone only'
                : 'protected with HTTPS'}
            </Text>
          </View>
        </View>

        <View
          style={[
            styles.statusPanel,
            {
              backgroundColor: `${colors.accent}10`,
              borderColor: `${colors.accent}45`,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.accent}
            name={latest ? 'checkmark-circle' : 'time-outline'}
            size={21}
          />
          <View style={styles.statusCopy}>
            <Text style={[styles.statusTitle, { color: colors.text }]}>
              {latest ? 'Reading stored securely' : 'Waiting for glucose'}
            </Text>
            <Text style={[styles.statusBody, { color: colors.textSecondary }]}>
              {latest
                ? `${latest.mmolL.toFixed(1)} mmol/L at ${formatTime(
                    latest.timestamp,
                  )} · ${relativeAge(latest.timestamp)}`
                : 'T1 Arc will keep the last verified history visible with explicit freshness.'}
            </Text>
          </View>
        </View>

        <View style={styles.actionRow}>
          <Pressable
            accessibilityRole="button"
            disabled={working}
            onPress={() => {
              setError(undefined);
              setEditing(true);
            }}
            style={({ pressed }) => [
              styles.secondaryButton,
              {
                borderColor: colors.border,
                borderRadius: radius.md,
                opacity: pressed || working ? 0.65 : 1,
              },
            ]}
          >
            <Text style={[styles.secondaryText, { color: colors.primary }]}>
              Update connection
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={working}
            onPress={confirmDisconnect}
            style={({ pressed }) => [
              styles.secondaryButton,
              {
                borderColor: `${colors.danger}66`,
                borderRadius: radius.md,
                opacity: pressed || working ? 0.65 : 1,
              },
            ]}
          >
            <Text style={[styles.secondaryText, { color: colors.danger }]}>
              Disconnect
            </Text>
          </Pressable>
        </View>
        {error ? (
          <Text
            accessibilityLiveRegion="assertive"
            style={[styles.error, { color: colors.danger }]}
          >
            {error}
          </Text>
        ) : null}
      </SectionCard>
    );
  }

  return (
    <SectionCard>
      <View style={styles.header}>
        <View
          style={[
            styles.icon,
            {
              backgroundColor: `${colors.glucose}16`,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.glucose}
            name="git-network-outline"
            size={24}
          />
        </View>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: colors.text }]}>
              Connect xDrip
          </Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            Bring glucose readings from xDrip into your encrypted T1 Arc
            history.
          </Text>
        </View>
      </View>

      <Pressable
        accessibilityHint="Fills the usual address for xDrip on this phone."
        accessibilityRole="button"
        disabled={working}
        onPress={() => {
          setEndpoint(SAME_PHONE_ENDPOINT);
          setError(undefined);
        }}
        style={({ pressed }) => [
          styles.localPreset,
          {
            backgroundColor: colors.surfaceMuted,
            borderColor: colors.border,
            borderRadius: radius.md,
            opacity: pressed || working ? 0.65 : 1,
          },
        ]}
      >
        <Ionicons
          accessibilityElementsHidden
          color={colors.primary}
          name="phone-portrait-outline"
          size={20}
        />
        <View style={styles.presetCopy}>
          <Text style={[styles.presetTitle, { color: colors.text }]}>
            Use xDrip on this phone
          </Text>
          <Text style={[styles.presetDetail, { color: colors.textSecondary }]}>
            127.0.0.1:17580 · the usual address when xDrip is on this phone
          </Text>
        </View>
      </Pressable>

      <Text style={[styles.label, { color: colors.text }]}>
        xDrip address
      </Text>
      <TextInput
        accessibilityLabel="xDrip address"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        onChangeText={setEndpoint}
        placeholder="127.0.0.1:17580"
        placeholderTextColor={colors.textTertiary}
        style={[
          styles.input,
          {
            backgroundColor: colors.surfaceMuted,
            borderColor: colors.border,
            borderRadius: radius.md,
            color: colors.text,
          },
        ]}
        value={endpoint}
      />

      <View
        style={[
          styles.privacyPanel,
          {
            backgroundColor: `${colors.primary}0D`,
            borderColor: `${colors.primary}35`,
            borderRadius: radius.md,
          },
        ]}
      >
        <Ionicons
          accessibilityElementsHidden
          color={colors.primary}
          name="shield-checkmark-outline"
          size={20}
        />
        <Text style={[styles.privacyText, { color: colors.textSecondary }]}>
          A local address is allowed only for xDrip on this phone. Connections
          elsewhere must be secure. T1 Arc only reads glucose from xDrip.
        </Text>
      </View>

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
        disabled={working || !endpoint.trim()}
        onPress={() => void testAndSave()}
        style={({ pressed }) => [
          styles.primaryButton,
          {
            backgroundColor:
              working || !endpoint.trim() ? colors.border : colors.primary,
            borderRadius: radius.md,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        {working ? (
          <ActivityIndicator color={colors.onPrimary} />
        ) : (
          <Ionicons
            accessibilityElementsHidden
            color={
              endpoint.trim() ? colors.onPrimary : colors.textTertiary
            }
            name="shield-checkmark-outline"
            size={19}
          />
        )}
        <Text
          style={[
            styles.primaryText,
            {
              color: endpoint.trim()
                ? colors.onPrimary
                : colors.textTertiary,
            },
          ]}
        >
          {working ? 'Checking xDrip…' : 'Check and save connection'}
        </Text>
      </Pressable>

      {saved ? (
        <Pressable
          accessibilityRole="button"
          disabled={working}
          onPress={() => {
            setEditing(false);
            setEndpoint(saved.endpointUrl);
            setError(undefined);
          }}
          style={styles.cancelButton}
        >
          <Text style={[styles.cancelText, { color: colors.textSecondary }]}>
            Cancel changes
          </Text>
        </Pressable>
      ) : null}
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
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '800',
  },
  body: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
  },
  localPreset: {
    minHeight: 76,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  presetCopy: {
    flex: 1,
  },
  presetTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  presetDetail: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  label: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
    marginTop: 18,
    marginBottom: 7,
  },
  input: {
    minHeight: 52,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  privacyPanel: {
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 14,
    padding: 13,
  },
  privacyText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 17,
  },
  primaryButton: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    marginTop: 18,
    paddingHorizontal: 16,
  },
  primaryText: {
    fontSize: 13,
    fontWeight: '800',
  },
  statusPanel: {
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 18,
    padding: 14,
  },
  statusCopy: {
    flex: 1,
  },
  statusTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
  },
  statusBody: {
    fontSize: 11,
    lineHeight: 17,
    marginTop: 2,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  secondaryButton: {
    minHeight: 48,
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  secondaryText: {
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },
  error: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 12,
  },
  cancelButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  cancelText: {
    fontSize: 12,
    fontWeight: '700',
  },
});
