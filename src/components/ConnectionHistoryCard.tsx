import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { readPersonalAppState } from '@/data/persistence/personalAppState';
import { DIRECT_LIBRE_LINKUP_SOURCE_ID } from '@/data/libreLinkUp/constants';
import { CONNECTION_HISTORY_PREFIX, readConnectionHistory, type ConnectionCheck } from '@/domain/connectionHistory';
import { formatDate, formatTime, toDateKey } from '@/domain/time';
import { useDataContext } from '@/providers/DataProvider';
import { useAppTheme } from '@/theme/theme';
import { SectionCard } from './SectionCard';

export function ConnectionHistoryCard() {
  const { colors } = useAppTheme();
  const { ownerIdentity, revision, demoMode, refreshData, syncing, now } = useDataContext();
  const [expanded, setExpanded] = useState(false);
  const [visibleCount, setVisibleCount] = useState(30);
  const [state, setState] = useState<{ owner: string; checks: ConnectionCheck[]; error?: string }>();
  const [retryError, setRetryError] = useState<string>();
  useEffect(() => {
    let active = true;
    if (!expanded || demoMode) return;
    void readPersonalAppState(CONNECTION_HISTORY_PREFIX + DIRECT_LIBRE_LINKUP_SOURCE_ID).then(value => {
      if (active) setState({ owner: ownerIdentity, checks: readConnectionHistory(value) });
    }).catch(() => { if (active) setState({ owner: ownerIdentity, checks: [], error: 'History could not be loaded. Close and reopen this panel to retry.' }); });
    return () => { active = false; };
  }, [expanded, ownerIdentity, revision, demoMode]);
  const retainedChecks = !demoMode && state?.owner === ownerIdentity ? state.checks.filter(check => check.at >= now - 7 * 86400000) : [];
  const checks = retainedChecks.slice(-visibleCount).reverse();
  return <SectionCard><View style={{ gap: 12 }}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: colors.primary, fontWeight: '700' }}>LibreLinkUp connection history {expanded ? '−' : '+'}</Text></Pressable>
    {expanded ? <>
      <Text style={{ color: colors.textSecondary }}>Recent checks from this phone. Repeated unchanged results are sampled hourly; changes are retained for up to seven days. This does not show whether the controller uploaded to LibreView.</Text>
      {!checks.length ? <Text style={{ color: colors.textSecondary }}>No recorded checks yet. History starts with this update.</Text> : null}
      {checks.map((check, index) => <View key={`${check.at}:${index}`} style={{ gap: 4 }}><Text style={{ color: colors.text }}>{formatDate(toDateKey(check.at))} {formatTime(check.at)} · {check.outcome === 'new-reading' ? 'Newer reading received' : check.outcome === 'no-new-reading' ? 'Source replied · no newer reading' : check.reason === 'rate-limited' ? 'Source asked us to wait' : check.reason === 'network' ? 'Connection request failed' : check.reason === 'account' ? 'Account needs attention' : 'Source request failed'}</Text>{check.measurementAt ? <Text style={{ color: colors.textSecondary }}>Latest saved reading: {formatDate(toDateKey(check.measurementAt))} {formatTime(check.measurementAt)}</Text> : null}</View>)}
      {retainedChecks.length > checks.length ? <Pressable accessibilityRole="button" onPress={() => setVisibleCount(count => count + 30)} style={{ minHeight: 48, padding: 12 }}><Text style={{ color: colors.primary }}>Show older checks</Text></Pressable> : null}
      {state?.owner === ownerIdentity && state.error ? <Text style={{ color: colors.danger }}>{state.error}</Text> : null}
      {retryError ? <Text style={{ color: colors.danger }}>{retryError}</Text> : null}
      <Pressable disabled={syncing || demoMode} accessibilityRole="button" onPress={() => { setRetryError(undefined); void refreshData().catch(() => setRetryError('Refresh did not complete. Check the source status above.')); }} style={{ minHeight: 48, padding: 12 }}><Text style={{ color: colors.primary }}>{syncing ? 'Checking…' : 'Check sources again'}</Text></Pressable>
      <Text style={{ color: colors.textSecondary }}>A retry respects the source’s waiting period. If it replies with old data, check the source app and the controller’s internet connection.</Text>
    </> : null}
  </View></SectionCard>;
}
