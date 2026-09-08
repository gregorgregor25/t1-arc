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

export function ConnectionSummary({ sources }: { sources: readonly DataSourceStatus[] }) {
  const [expanded, setExpanded] = useState(false);
  const { colors } = useAppTheme();
  const navigation = useNavigation<NavigationProp<RootTabParamList>>();
  const issues = connectionIssues(sources);
  if (!issues.length) return null;
  return <View>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={({ pressed }) => ({ minHeight: 48, flexDirection: 'row', gap: 8, alignItems: 'center', opacity: pressed ? 0.7 : 1 })}>
      <Ionicons name="information-circle-outline" size={20} color={colors.warning} accessibilityElementsHidden />
      <Text style={{ color: colors.textSecondary, flex: 1 }}>{issues.length === 1 ? `${issues[0]!.label} records need a check` : 'Some connections need a check'}</Text>
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
  </View>;
}
