import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import type { RootTabParamList } from '@/navigation/AppNavigator';
import { sourceSettingsRouteParams } from '@/navigation/sourceNavigation';
import { connectionIssues, connectionSettingsTarget } from '@/domain/connectionSummary';
import type { DataSourceStatus } from '@/domain/models';
import { formatDate, formatTime, toDateKey } from '@/domain/time';
import { useAppTheme } from '@/theme/theme';

/**
 * One chip for every connection and insulin-record check on Today. It stays
 * hidden while everything is up to date, and opens the details in place.
 */
export function ConnectionSummary({ sources, insulinThrough }: {
  sources: readonly DataSourceStatus[];
  /** "Insulin records through 13:00", only while synced insulin lags. */
  insulinThrough?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const { colors, radius } = useAppTheme();
  const navigation = useNavigation<NavigationProp<RootTabParamList>>();
  const issues = connectionIssues(sources);
  if (!issues.length && !insulinThrough) return null;
  const chipLabel = issues.length > 1 || (issues.length === 1 && insulinThrough)
    ? 'Some connections need a check'
    : issues.length === 1
      ? `${issues[0]!.label} records need a check`
      : 'Insulin records need a check';
  return <View style={{ gap: 4 }}>
    <Pressable accessibilityRole="button" accessibilityHint={expanded ? 'Hides the connection details' : 'Shows which records need a check'} accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={({ pressed }) => ({ minHeight: 44, maxWidth: '100%', alignSelf: 'flex-start', flexDirection: 'row', gap: 6, alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: colors.warning, borderRadius: radius.pill, backgroundColor: pressed ? colors.surfaceMuted : colors.surface })}>
      <Ionicons name="alert-circle-outline" size={18} color={colors.warning} accessibilityElementsHidden />
      <Text style={{ color: colors.text, flexShrink: 1, fontSize: 14, fontWeight: '700' }}>{chipLabel}</Text>
      <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} accessibilityElementsHidden />
    </Pressable>
    {expanded ? issues.map(source => <View key={source.id} style={{ paddingVertical: 8 }}>
      <Text style={{ color: colors.text, fontWeight: '600' }}>{source.label}</Text>
      <Text style={{ color: colors.textSecondary, lineHeight: 21 }}>{source.dataThrough === undefined ? source.recordCount === 0 ? 'No records have arrived yet.' : 'The latest record time is unavailable.' : `Records through ${formatDate(toDateKey(source.dataThrough), { day: 'numeric', month: 'short', year: 'numeric' })}, ${formatTime(source.dataThrough)}.`}</Text>
      <Text style={{ color: colors.textSecondary, lineHeight: 21 }}>{source.detail}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Check ${source.label} connection settings`} onPress={() => {
        const target = connectionSettingsTarget(source.id);
        navigation.navigate('Sources', target ? sourceSettingsRouteParams(target) : { focused: false });
      }} style={({ pressed }) => ({ minHeight: 48, justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}><Text style={{ color: colors.primary, fontWeight: '600' }}>Check connection</Text></Pressable>
    </View>) : null}
    {expanded && insulinThrough ? <View style={{ paddingVertical: 8 }}>
      <Text style={{ color: colors.text, fontWeight: '600' }}>Insulin records</Text>
      <Text style={{ color: colors.textSecondary, lineHeight: 21 }}>{insulinThrough}. Today&apos;s insulin totals may be incomplete until newer records arrive.</Text>
    </View> : null}
    {expanded ? <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Sources', { ...sourceSettingsRouteParams(), panel: 'source-health' })} style={({ pressed }) => ({ minHeight: 48, justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}><Text style={{ color: colors.primary, fontWeight: '600' }}>See source health</Text></Pressable> : null}
  </View>;
}
