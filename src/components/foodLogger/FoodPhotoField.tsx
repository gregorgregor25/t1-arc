import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { AppState, Image, Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { prepareFoodPhoto } from '@/data/food/foodPhotoCapture';
import { discardFoodLabelPhoto } from '@/data/food/foodLabelRecognition';
import { readFoodPhoto } from '@/data/food/foodPhotoRepository';
import type { FoodPhotoOwner } from '@/data/food/foodPhotoPolicy';
import { useDataContext } from '@/providers/DataProvider';
import { useAppTheme } from '@/theme/theme';

/** Draft value: undefined keeps a saved photo, null removes it, string replaces it. */
export function FoodPhotoField({ owner, value, onChange, label = 'Food photo', disabled = false }: {
  owner?: FoodPhotoOwner; value?: string | null; onChange(value: string | null): void; label?: string; disabled?: boolean;
}) {
  const { colors } = useAppTheme();
  const { ownerIdentity, demoMode } = useDataContext();
  const [capture, setCapture] = useState(false);
  const [saved, setSaved] = useState<{ key: string; uri?: string }>();
  const [error, setError] = useState<string>();
  const key = `${ownerIdentity}:${owner?.kind}:${owner?.id}`;
  const kind = owner?.kind, id = owner?.id;
  useEffect(() => {
    let active = true;
    if (kind && id && !demoMode) void readFoodPhoto({ kind, id }).then(photo => { if (active) setSaved({ key, uri: photo?.uri }); }).catch(() => { if (active) setError('Saved photo could not be loaded. Reopen this entry to retry.'); });
    return () => { active = false; };
  }, [key, kind, id, demoMode]);
  const uri = value === undefined ? saved?.key === key ? saved.uri : undefined : value ?? undefined;
  return <View style={{ gap: 10 }}>
    {uri ? <Image accessible accessibilityLabel={label} source={{ uri }} style={{ width: '100%', height: 180, borderRadius: 14 }} resizeMode="contain" /> : null}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
      <Pressable disabled={disabled || demoMode} accessibilityRole="button" onPress={() => setCapture(true)} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: colors.primary }}>{uri ? `Replace ${label.toLowerCase()}` : `Add ${label.toLowerCase()}`}</Text></Pressable>
      {uri ? <Pressable disabled={disabled} accessibilityRole="button" onPress={() => onChange(null)} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: colors.primary }}>Remove photo</Text></Pressable> : null}
    </View>
    {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
    {capture ? <PhotoCamera key={key} onClose={() => setCapture(false)} onPhoto={photo => { onChange(photo); setCapture(false); }} /> : null}
  </View>;
}

function PhotoCamera({ onClose, onPhoto }: { onClose(): void; onPhoto(photo: string): void }) {
  const { colors } = useAppTheme();
  const camera = useRef<CameraView>(null);
  const active = useRef(true);
  const busyRef = useRef(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    active.current = true;
    const listener = AppState.addEventListener('change', state => { setForeground(state === 'active'); if (state !== 'active') setReady(false); });
    return () => { active.current = false; listener.remove(); };
  }, []);
  async function capture() {
    if (!camera.current || !ready || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(undefined);
    let uri: string | undefined;
    try {
      uri = (await camera.current.takePictureAsync({ quality: 0.85, exif: false, imageType: 'jpg' }))?.uri;
      if (!uri) throw new Error('No photo');
      const photo = await prepareFoodPhoto(uri);
      if (active.current && AppState.currentState === 'active') onPhoto(photo);
    } catch { if (active.current) setError('The photo could not be saved. Take it again.'); }
    finally { if (uri) await discardFoodLabelPhoto(uri); busyRef.current = false; if (active.current) setBusy(false); }
  }
  return <Modal onRequestClose={onClose} animationType="slide"><SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}><ScrollView contentContainerStyle={{ padding: 20, gap: 18 }}>
    <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 24, fontWeight: '700' }}>Take a food photo</Text>
    <Text style={{ color: colors.textSecondary }}>A visual reminder for this entry. Nutrition still comes from the label or ingredients. Photos are saved privately with your entry and included in encrypted backups.</Text>
    {permission?.granted && foreground ? <CameraView ref={camera} facing="back" onCameraReady={() => setReady(true)} onMountError={() => setError('The camera could not start. Close and retry.')} style={{ height: 320, borderRadius: 16 }} /> : <Pressable accessibilityRole="button" onPress={() => { void (permission?.canAskAgain === false ? Linking.openSettings() : requestPermission()).catch(() => setError('Camera access could not be opened. Retry or close.')); }} style={{ padding: 16, minHeight: 48 }}><Text style={{ color: colors.primary }}>{permission?.canAskAgain === false ? 'Open camera settings' : 'Allow camera'}</Text></Pressable>}
    {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
    <Pressable disabled={!ready || busy || !foreground} accessibilityRole="button" onPress={() => void capture()} style={{ padding: 16, minHeight: 50, borderRadius: 14, backgroundColor: colors.primary, opacity: ready && !busy ? 1 : 0.5 }}><Text style={{ color: colors.onPrimary }}>{busy ? 'Preparing photo…' : 'Use photo'}</Text></Pressable>
    <Pressable accessibilityRole="button" onPress={onClose} style={{ padding: 16, minHeight: 48 }}><Text style={{ color: colors.primary }}>Cancel</Text></Pressable>
  </ScrollView></SafeAreaView></Modal>;
}
