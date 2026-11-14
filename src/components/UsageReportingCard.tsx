import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { Alert } from '@/components/appAlert';
import { getUsageConsentAsync, setUsageConsentAsync } from '@/data/usageReporting/usageReporter';
import { USAGE_REPORTING_COPY } from '@/domain/usageReportingCopy';
import { useAppTheme } from '@/theme/theme';

/** Settings > Privacy off switch for anonymous usage counts. There is no prompt. */
export function UsageReportingCard() {
  const { colors } = useAppTheme();
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const sequence = useRef(0);

  useEffect(() => {
    const request = ++sequence.current;
    getUsageConsentAsync()
      .then((consent) => {
        if (request !== sequence.current) return;
        setEnabled(consent === 'enabled');
        setLoadError(false);
      })
      .catch(() => {
        if (request === sequence.current) setLoadError(true);
      })
      .finally(() => {
        if (request === sequence.current) setLoading(false);
      });
    return () => {
      sequence.current += 1;
    };
  }, [reloadKey]);

  const retry = useCallback(() => {
    setLoading(true);
    setReloadKey((key) => key + 1);
  }, []);

  async function change(value: boolean) {
    const request = ++sequence.current;
    setBusy(true);
    setEnabled(value);
    try {
      await setUsageConsentAsync(value);
    } catch {
      if (request === sequence.current) {
        setBusy(false);
        Alert.alert(USAGE_REPORTING_COPY.saveErrorTitle, USAGE_REPORTING_COPY.saveErrorBody);
        // Show what is actually stored rather than the attempted position.
        retry();
      }
      return;
    }
    if (request === sequence.current) setBusy(false);
  }

  return (
    <View>
      <View style={styles.row}>
        <View style={styles.fill}>
          <Text style={[styles.heading, { color: colors.text }]}>{USAGE_REPORTING_COPY.settingLabel}</Text>
          <Text style={[styles.small, { color: colors.textSecondary }]}>{USAGE_REPORTING_COPY.settingHint}</Text>
        </View>
        <Switch
          accessibilityLabel={USAGE_REPORTING_COPY.settingLabel}
          accessibilityHint="Turning this off stops sending and deletes the local activity history."
          value={enabled}
          disabled={busy || loading || loadError}
          onValueChange={(value) => {
            void change(value);
          }}
          trackColor={{ true: colors.primary }}
        />
      </View>
      {loadError ? (
        <Pressable
          accessibilityRole="button"
          onPress={retry}
        >
          <Text style={[styles.link, { color: colors.primary }]}>{USAGE_REPORTING_COPY.loadError}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  heading: { fontSize: 18, lineHeight: 26, fontWeight: '700' },
  small: { fontSize: 14, lineHeight: 21, marginTop: 6 },
  link: { fontSize: 15, fontWeight: '600', paddingVertical: 8 },
});
