import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { getHealthConnectOverview } from '@/data/healthConnect/healthConnectRepository';
import { readNutritionSource, saveNutritionSource } from '@/data/nutritionSourceRepository';
import { useDataContext } from '@/providers/DataProvider';
import { useAppTheme } from '@/theme/theme';
import { SectionCard } from './SectionCard';

export function FoodSourceCard() {
  const { colors } = useAppTheme();
  const { ownerIdentity, demoMode, reloadSources } = useDataContext();
  const [selected, setSelected] = useState('t1arc');
  const [sources, setSources] = useState<{ id: string; label: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    if (demoMode) return;
    void Promise.all([readNutritionSource(), getHealthConnectOverview()]).then(([value, overview]) => {
      if (!active) return;
      setSelected(value);
      setSources(overview.sources.filter(source => source.categories.includes('nutrition')).map(source => ({ id: `health-connect:${source.packageName}`, label: source.displayName })));
    }).catch(() => { if (active) setError('Could not load food sources. Reopen Settings to retry.'); });
    return () => { active = false; };
  }, [ownerIdentity, demoMode]);
  async function choose(id: string) {
    if (busy || demoMode) return;
    setBusy(true); setError(undefined);
    try { await saveNutritionSource(id); setSelected(id); await reloadSources(); }
    catch { setError('The food source was not changed. Tap your choice to retry.'); }
    finally { setBusy(false); }
  }
  return <SectionCard><View style={{ gap: 12 }}>
    <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 19, fontWeight: '700' }}>Food totals</Text>
    <Text style={{ color: colors.textSecondary }}>Choose one food diary. Pump carbohydrate entries from Glooko stay in your history as context and are excluded from food totals. Hypo treatments logged here are included.</Text>
    {[{ id: 't1arc', label: 'T1 Arc · foods you log here' }, ...sources].map(source => <Pressable key={source.id} accessibilityRole="radio" accessibilityState={{ checked: selected === source.id, disabled: busy || demoMode }} disabled={busy || demoMode} onPress={() => void choose(source.id)} style={{ minHeight: 48, padding: 14, borderRadius: 12, backgroundColor: selected === source.id ? colors.primary : colors.surfaceMuted }}><Text style={{ color: selected === source.id ? colors.onPrimary : colors.text }}>{source.label}</Text></Pressable>)}
    {selected !== 't1arc' && !sources.some(source => source.id === selected) ? <Text style={{ color: colors.warning }}>The selected food source is currently unavailable. Choose T1 Arc to use foods logged here.</Text> : null}
    {error ? <Text accessibilityLiveRegion="polite" style={{ color: colors.danger }}>{error}</Text> : null}
  </View></SectionCard>;
}
