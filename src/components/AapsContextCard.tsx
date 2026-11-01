import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';

import {
  getAapsLocalSourceStatus,
  getLatestAapsContext,
} from '@/data/aaps/localAapsSource';
import { formatRegionalNumber } from '@/domain/regionalFormat';
import { relativeAge } from '@/domain/time';
import { useRegionalProfile } from '@/providers/RegionalProfileProvider';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';

type Context = Awaited<ReturnType<typeof getLatestAapsContext>>;

export function AapsContextCard({ now, revision }: { now: number; revision: number }) {
  const { colors } = useAppTheme();
  const { defaults } = useRegionalProfile();
  const [selected, setSelected] = useState(false);
  const [context, setContext] = useState<Context>();
  const refreshGeneration = useRef(0);

  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    try {
      const source = await getAapsLocalSourceStatus();
      if (generation !== refreshGeneration.current) return;
      if (source.selectedSourceId !== 'aaps-local') {
        setSelected(false);
        setContext(undefined);
        return;
      }
      const latest = await getLatestAapsContext();
      if (generation !== refreshGeneration.current) return;
      setContext(latest);
      setSelected(true);
    } catch {
      if (generation !== refreshGeneration.current) return;
      setSelected(false);
      setContext(undefined);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(refresh);
    const interval = setInterval(() => void refresh(), 30_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      refreshGeneration.current += 1;
      clearInterval(interval);
      subscription.remove();
    };
  }, [refresh, revision]);

  if (!selected) return null;

  const ageMs = context ? now - context.receivedAt : undefined;
  const stale = ageMs !== undefined && ageMs > 12 * 60_000;
  const number = (value: number | undefined, digits: number) =>
    value === undefined
      ? 'Unavailable'
      : formatRegionalNumber(value, defaults.locale, {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        });

  return (
    <SectionCard accessibilityLabel="AAPS insulin and carbohydrate estimates">
      <View style={styles.headingRow}>
        <Text style={[styles.heading, { color: colors.text }]}>AAPS estimates</Text>
        {stale ? <Text style={[styles.stale, { color: colors.warning }]}>No recent broadcast</Text> : null}
      </View>
      <Text style={[styles.age, { color: colors.textSecondary }]}>
        {context ? `Last AAPS broadcast ${relativeAge(context.receivedAt, now)}` : 'Waiting for a local AAPS broadcast'}
      </Text>
      <View style={styles.values}>
        <View style={styles.value}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Insulin on board</Text>
          <Text style={[styles.measure, { color: colors.text }]}>
            {number(context?.iobUnits, 2)}{context?.iobUnits === undefined ? '' : ' U'}
          </Text>
        </View>
        <View style={styles.value}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Carbs on board</Text>
          <Text style={[styles.measure, { color: colors.text }]}>
            {number(context?.cobGrams, 1)}{context?.cobGrams === undefined ? '' : ' g'}
          </Text>
        </View>
      </View>
      <Text style={[styles.note, { color: colors.textSecondary }]}>
        Calculated by AAPS; these are estimates rather than delivered insulin or logged carbs.
      </Text>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  headingRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  heading: { fontSize: 17, fontWeight: '700', lineHeight: 23 },
  stale: { fontSize: 12, fontWeight: '700' },
  age: { fontSize: 13, lineHeight: 19, marginTop: 3 },
  values: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, marginTop: 16 },
  value: { flexBasis: 126, flexGrow: 1, gap: 2 },
  label: { fontSize: 13, lineHeight: 19 },
  measure: { fontSize: 22, fontWeight: '700', lineHeight: 29 },
  note: { fontSize: 12, lineHeight: 18, marginTop: 15 },
});
