import { prepareFoodPhoto } from '@/data/food/foodPhotoCapture';
import type { LabelConvention } from '@/data/food/labelConvention';
import { FoodLabelReview } from './FoodLabelReview';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Keyboard, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, type AppStateStatus } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { FoodLabelDraft } from '@/data/food/foodLabelCapture';
import { discardFoodLabelPhoto, foodLabelCaptureAvailable, recognizeFoodLabelPhoto } from '@/data/food/foodLabelRecognition';
import { useAppTheme } from '@/theme/theme';

export interface FoodLabelCaptureModalProps {
  visible: boolean;
  onClose(): void;
  onResult(draft: FoodLabelDraft): void;
}

export function FoodLabelCaptureModal({ visible, onClose, onResult }: FoodLabelCaptureModalProps) {
  return visible ? <FoodLabelCaptureSession onClose={onClose} onResult={onResult} /> : null;
}

function FoodLabelCaptureSession({ onClose, onResult }: Omit<FoodLabelCaptureModalProps, 'visible'>) {
  const { colors } = useAppTheme();
  const camera = useRef<CameraView>(null);
  const generation = useRef(0);
  const captureLock = useRef(false);
  const sessionActive = useRef(true);
  const foreground = useRef(AppState.currentState === 'active');
  const permissionRequestInFlight = useRef(false);
  const permissionRoundTrip = useRef(false);
  const [permission, requestPermission, refreshPermission] = useCameraPermissions();
  const [appActive, setAppActive] = useState(() => AppState.currentState === 'active');
  const [permissionPending, setPermissionPending] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [torch, setTorch] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [preview, setPreview] = useState<string>();
  const [labelConvention, setLabelConvention] = useState<LabelConvention>();
  const [draft, setDraft] = useState<FoodLabelDraft>();
  const [error, setError] = useState<string>();
  const available = foodLabelCaptureAvailable();

  useEffect(() => {
    sessionActive.current = true;
    void refreshPermission();
    return () => { sessionActive.current = false; generation.current += 1; };
  }, [refreshPermission]);

  useEffect(() => {
    function handleAppStateChange(state: AppStateStatus) {
      foreground.current = state === 'active';
      setAppActive(foreground.current);
      if (state === 'active') {
        if (!permissionRequestInFlight.current) permissionRoundTrip.current = false;
      } else {
        generation.current += 1;
        setTorch(false);
        setReady(false);
        // Android's permission dialog can pause the activity. No camera is mounted
        // during this explicit round-trip; genuine background capture still cancels.
        if (state === 'background' && !permissionRoundTrip.current) {
          sessionActive.current = false;
          onClose();
        }
      }
    }
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [onClose]);

  function close() {
    sessionActive.current = false;
    generation.current += 1;
    setTorch(false);
    onClose();
  }

  async function requestCameraAccess() {
    if (permission?.canAskAgain === false) {
      void Linking.openSettings();
      return;
    }
    if (permissionRoundTrip.current) return;
    permissionRoundTrip.current = true;
    permissionRequestInFlight.current = true;
    setPermissionPending(true);
    setReady(false);
    setTorch(false);
    try {
      await requestPermission();
    } catch {
      if (sessionActive.current) setError('Camera permission could not be requested. You can enter the label values yourself.');
    } finally {
      permissionRequestInFlight.current = false;
      // Resolution may precede Android's active event. Keep the camera unmounted
      // until both the permission request and the foreground transition finish.
      if (foreground.current) permissionRoundTrip.current = false;
      if (sessionActive.current) setPermissionPending(false);
    }
  }

  async function capture() {
    if (!camera.current || !ready || captureLock.current || !sessionActive.current || !foreground.current || permissionRoundTrip.current) return;
    captureLock.current = true;
    const current = generation.current;
    setBusy(true);
    setError(undefined);
    let photoUri: string | undefined;
    try {
      const picture = await camera.current.takePictureAsync({ quality: 0.98, exif: false,
        base64: false, skipProcessing: false, imageType: 'jpg' });
      photoUri = picture?.uri;
      if (!photoUri) throw new Error('The camera did not return a photo.');
      if (generation.current !== current) return;
      const reviewPhoto = await prepareFoodPhoto(photoUri, false);
      if (generation.current !== current) return;
      const result = await recognizeFoodLabelPhoto(photoUri);
      if (generation.current !== current) return;
      setPreview(reviewPhoto);
      setDraft(result);
      setTorch(false);
    } catch {
      if (generation.current === current) {
        setError('The label could not be processed. Try again, or enter the values yourself.');
      }
    } finally {
      if (photoUri) await discardFoodLabelPhoto(photoUri);
      captureLock.current = false;
      if (sessionActive.current) setBusy(false);
    }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={() => {
      if (Platform.OS === 'android' && Keyboard.isVisible()) { Keyboard.dismiss(); return; }
      close();
    }}>
      <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
        <KeyboardAvoidingView behavior={Platform.OS === 'android' ? 'height' : 'padding'} style={styles.screen}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Read a nutrition label</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close label capture" onPress={close} style={styles.iconButton}>
            <Ionicons name="close" size={26} color={colors.text} />
          </Pressable>
        </View>
        {!available ? (
          <ScrollView contentContainerStyle={styles.body}>
            <Text style={[styles.copy, { color: colors.textSecondary }]}>Label capture is unavailable in this build. You can enter the label values yourself.</Text>
            <Pressable accessibilityRole="button" onPress={close} style={[styles.button, { backgroundColor: colors.primary }]}>
              <Text style={[styles.buttonText, { color: colors.onPrimary }]}>Enter values</Text>
            </Pressable>
          </ScrollView>
        ) : draft ? (
          <FoodLabelReview draft={draft} preview={preview} convention={labelConvention} onConvention={setLabelConvention}
            onResult={value => { generation.current += 1; onResult(value); }}
            onRetake={() => { setDraft(undefined); setPreview(undefined); setReady(false); }} />
        ) : !appActive || permissionPending ? (
          <View style={styles.body}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.copy, { color: colors.textSecondary }]}>Waiting for the camera permission screen to finish. The camera is paused.</Text>
          </View>
        ) : !permission?.granted ? (
          <ScrollView contentContainerStyle={styles.body}>
            <Text style={[styles.copy, { color: colors.textSecondary }]}>Allow the camera to read the printed nutrition table. The photo and text stay on this phone.</Text>
            <Text style={[styles.note, { color: colors.textSecondary }]}>Google ML Kit may send SDK usage and performance metrics to Google, but not your photo or label text.</Text>
            {error && <Text accessibilityRole="alert" style={[styles.copy, { color: colors.textSecondary }]}>{error}</Text>}
            <Pressable accessibilityRole="button" onPress={() => void requestCameraAccess()} style={[styles.button, { backgroundColor: colors.primary }]}>
              <Text style={[styles.buttonText, { color: colors.onPrimary }]}>{permission?.canAskAgain === false ? 'Open camera settings' : 'Allow camera'}</Text>
            </Pressable>
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={styles.cameraBody}>
            <Text style={[styles.copy, { color: colors.textSecondary }]}>Move close enough to read the numbers clearly. Fill the frame with the nutrition table and its amount heading.</Text>
            <CameraView ref={camera} style={styles.camera} facing="back" enableTorch={torch} zoom={zoom}
              onCameraReady={() => setReady(true)} onMountError={() => setError('The camera could not start. Close this screen and enter the label values.')}
              animateShutter />
            <View style={styles.zoomControls}>
              <Pressable accessibilityRole="button" accessibilityLabel="Zoom label camera out" disabled={busy || zoom === 0}
                onPress={() => setZoom(value => Math.max(0, value - 0.05))} style={styles.zoomButton}>
                <Text style={[styles.copy, { color: colors.primary }]}>− Zoom out</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Zoom label camera in" disabled={busy || zoom >= 0.3}
                onPress={() => setZoom(value => Math.min(0.3, value + 0.05))} style={styles.zoomButton}>
                <Text style={[styles.copy, { color: colors.primary }]}>+ Zoom in</Text>
              </Pressable>
            </View>
            {error && <Text accessibilityRole="alert" style={[styles.copy, { color: colors.textSecondary }]}>{error}</Text>}
            {busy && <View style={styles.reading}><ActivityIndicator color={colors.primary} /><Text style={[styles.copy, { color: colors.text }]}>Reading on this phone…</Text></View>}
            <View style={styles.actions}>
              <Pressable accessibilityRole="button" accessibilityLabel={torch ? 'Turn label light off' : 'Turn label light on'}
                accessibilityState={{ selected: torch, disabled: busy }} disabled={busy} onPress={() => setTorch((value) => !value)} style={styles.iconButton}>
                <Ionicons name={torch ? 'flash' : 'flash-outline'} size={25} color={colors.primary} />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityState={{ disabled: !ready || busy }} disabled={!ready || busy}
                onPress={() => void capture()} style={[styles.button, styles.captureButton, { backgroundColor: colors.primary, opacity: !ready || busy ? 0.5 : 1 }]}>
                <Text style={[styles.buttonText, { color: colors.onPrimary }]}>Read label</Text>
              </Pressable>
            </View>
            <Text style={[styles.note, { color: colors.textSecondary }]}>Read the label, check the numbers, then choose whether to save. No food is added automatically.</Text>
            <Text style={[styles.note, { color: colors.textSecondary }]}>Recognition runs on this phone. Google ML Kit may send SDK usage and performance metrics, but not your photo or label text, to Google.</Text>
          </ScrollView>
        )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 21, fontWeight: '700', flexShrink: 1 },
  iconButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', marginLeft: 'auto' },
  body: { padding: 20, gap: 16 },
  copy: { fontSize: 16, lineHeight: 23, flexShrink: 1 },
  note: { fontSize: 13, lineHeight: 19 },
  button: { minHeight: 50, borderRadius: 14, padding: 14, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  cameraBody: { flexGrow: 1, padding: 20, gap: 14 },
  camera: { height: 360, minHeight: 160, borderRadius: 16, overflow: 'hidden' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  captureButton: { flex: 1 },
  reading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  zoomControls: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  zoomButton: { minHeight: 48, padding: 10, justifyContent: 'center' },
});
