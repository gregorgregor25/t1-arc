import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { getCountryFoodPackStatuses, installCountryFoodPack, removeCountryFoodPack, subscribeCountryFoodPackStatus, type CountryFoodPackStatus } from '@/data/food/countryPacks';
import { formatRegionalNumber } from '@/domain/regionalFormat';
import { useRegionalProfile } from '@/providers/RegionalProfileProvider';
import { useAppTheme } from '@/theme/theme';

/** Optional larger catalogue. Everyday search requires neither this setup nor an account. */
export function FoodCatalogueExtras({ onChange }: { onChange(): void }) {
  const { colors, radius } = useAppTheme();
  const { defaults } = useRegionalProfile();
  const [status, setStatus] = useState<CountryFoodPackStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const mounted = useRef(true);
  const controller = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    let generation = 0;
    const refresh = () => {
      const request = ++generation;
      void getCountryFoodPackStatuses().then(packs => {
        if (mounted.current && request === generation) setStatus(packs.find(pack => pack.id === 'us-usda-branded'));
      }).catch(() => { if (mounted.current) setError('The extra food catalogue is unavailable right now. Regular search still works.'); });
    };
    refresh();
    const unsubscribe = subscribeCountryFoodPackStatus(refresh);
    return () => { mounted.current = false; unsubscribe(); controller.current?.abort(); };
  }, []);
  async function change(install: boolean) {
    if (busy || status?.state === 'installing') return;
    setBusy(true);
    setError(undefined);
    const operation = new AbortController();
    controller.current = operation;
    try {
      if (install) await installCountryFoodPack('us-usda-branded', { signal: operation.signal });
      else await removeCountryFoodPack('us-usda-branded');
      if (mounted.current) onChange();
    } catch (nextError) {
      if (mounted.current && !operation.signal.aborted) setError(nextError instanceof Error ? nextError.message : 'The catalogue could not be changed. Regular search still works.');
    } finally {
      if (controller.current === operation) controller.current = undefined;
      if (mounted.current) setBusy(false);
    }
  }
  const installing = status?.state === 'installing';
  const installed = status?.state === 'installed';
  if (!status && !error) return null;
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.md }]}>
      <Text style={[styles.title, { color: colors.text }]}>More US packaged foods</Text>
      <Text style={[styles.copy, { color: colors.textSecondary }]}>{installed ? 'Included in search and barcode scanning on this phone.' : 'Add the offline USDA branded catalogue. No account or API key needed.'}</Text>
      {status ? <Text style={[styles.copy, { color: colors.textTertiary }]}>{formatRegionalNumber(status.foodCount, defaults.locale)} foods · {formatRegionalNumber(Math.ceil(status.sizeBytes / 1_000_000), defaults.locale)} MB on this phone</Text> : null}
      {installing || busy ? <View style={styles.progress}><ActivityIndicator color={colors.primary} /><Text accessibilityLiveRegion="polite" style={[styles.copy, { color: colors.textSecondary }]}>{installing ? `Preparing${status?.progress !== undefined ? ` · ${Math.round(status.progress * 100)}%` : ''}…` : 'Updating…'}</Text></View> : null}
      {error ? <Text accessibilityLiveRegion="polite" style={[styles.copy, { color: colors.textSecondary }]}>{error}</Text> : null}
      {status && status.state !== 'unavailable' && !installing && !busy ? <Pressable accessibilityRole="button" onPress={() => void change(!installed)} style={styles.button}><Text style={[styles.action, { color: colors.primary }]}>{installed ? 'Remove offline catalogue' : 'Add offline catalogue'}</Text></Pressable> : null}
      {installed ? <Text style={[styles.copy, { color: colors.textTertiary }]}>Removing it does not delete your saved foods or meals.</Text> : null}
    </View>
  );
}
const styles = StyleSheet.create({
  card: { padding: 16, borderWidth: StyleSheet.hairlineWidth, gap: 10 },
  title: { fontSize: 16, fontWeight: '700' },
  copy: { fontSize: 14, lineHeight: 21 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  button: { minHeight: 48, justifyContent: 'center' },
  action: { fontSize: 15, fontWeight: '700' },
});
