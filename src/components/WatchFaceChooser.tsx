import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import T1ArcGlucoseDisplay, { WatchFaceDeviceStatus, WatchFaceId } from '../../modules/t1arc-glucose-display';
import { applyWatchFaceResult, canInstallWatchFace, WATCH_FACES, watchFaceStatusCopy, watchFaceUpdateRequired } from '@/domain/watchFaces';
import { useAppTheme } from '@/theme/theme';

import { WatchFacePreview } from './WatchFacePreview';

const GUIDE = 'https://github.com/gregorgregor25/t1-arc/blob/codex/public-release-snapshot/docs/WATCH_SETUP.md';

export function WatchFaceChooser() {
  const { colors, radius } = useAppTheme();
  const { width, fontScale } = useWindowDimensions();
  const stacked = width < 380 || fontScale > 1.3;
  const [devices, setDevices] = useState<WatchFaceDeviceStatus[]>([]);
  const [nodeId, setNodeId] = useState('');
  const [selected, setSelected] = useState<WatchFaceId>('meridian');
  const [checking, setChecking] = useState(true);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState('');
  const generation = useRef(0);
  const operation = useRef(false);
  const mounted = useRef(true);
  const touched = useRef(false);
  const device = devices.find((item) => item.nodeId === nodeId);
  const selectedFace = WATCH_FACES.find((item) => item.id === selected)!;

  const refresh = useCallback(async () => {
    if (operation.current) return;
    const token = ++generation.current;
    setChecking(true);
    setNotice('');
    try {
      const next = Platform.OS === 'android' ? await T1ArcGlucoseDisplay.getWatchFaceStatusAsync() : [];
      if (!mounted.current || token !== generation.current) return;
      setDevices(next);
      const onlyWatch = next.length === 1 ? next[0] : undefined;
      setNodeId((previous) => next.some((item) => item.nodeId === previous)
        ? previous : onlyWatch?.nodeId ?? '');
      if (!touched.current && onlyWatch?.installedFaceId) setSelected(onlyWatch.installedFaceId);
    } catch {
      if (mounted.current && token === generation.current) {
        setDevices([]);
        setNotice('The watch could not be checked. Keep it nearby and try again.');
      }
    } finally {
      if (mounted.current && token === generation.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void Promise.resolve().then(() => { if (mounted.current) void refresh(); });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => { mounted.current = false; generation.current += 1; subscription.remove(); };
  }, [refresh]);

  const run = async (activate: boolean) => {
    if (!device || operation.current) return;
    const target = device;
    operation.current = true;
    generation.current += 1;
    setChecking(false);
    setWorking(true);
    setNotice('');
    try {
      if (activate) {
        const opened = await T1ArcGlucoseDisplay.openWatchFaceActivationAsync(target.nodeId);
        if (mounted.current) setNotice(opened
          ? 'Setup was sent to your watch. Follow its instructions, then check status here.'
          : 'Select the face by touching and holding your current watch face.');
      } else {
        const result = await T1ArcGlucoseDisplay.installBundledWatchFaceAsync(target.nodeId, selected);
        if (mounted.current) setDevices((current) => current.map((item) =>
          item.nodeId === target.nodeId ? applyWatchFaceResult(item, result) : item));
      }
    } catch {
      if (mounted.current) setNotice('This step could not be confirmed. Check the watch before trying again.');
    } finally {
      operation.current = false;
      if (mounted.current) setWorking(false);
    }
  };

  const disabled = working || checking;
  const installAllowed = !disabled && canInstallWatchFace(device, selected);
  const activationAvailable = !disabled && Boolean(device?.installedFaceId && !device.active &&
    !device.activationDenied && !device.activationUsed && ['ready', 'activation_required'].includes(device.code));

  return (
    <View style={styles.root}>
      <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>Watch faces</Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>
        Five distinct designs. Previews show example readings, not your live glucose.
      </Text>
      {devices.length > 1 && (
        <View style={styles.targets}>
          <Text style={[styles.body, { color: colors.text }]}>Choose your watch</Text>
          {devices.map((item) => (
            <Pressable key={item.nodeId} accessibilityRole="radio"
              accessibilityState={{ checked: nodeId === item.nodeId, disabled }}
              disabled={disabled} onPress={() => {
                setNodeId(item.nodeId); setSelected(item.installedFaceId ?? 'meridian'); setNotice('');
              }}
              style={({ pressed }) => [styles.target, { borderColor: nodeId === item.nodeId ? colors.primary : colors.border,
                borderRadius: radius.md, opacity: pressed ? 0.7 : 1 }]}>
              <Ionicons name="watch-outline" size={20} color={colors.primary} />
              <Text style={[styles.body, styles.flex, { color: colors.text }]}>{item.watchName}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <View accessibilityLiveRegion="polite" style={[styles.status, { backgroundColor: colors.surfaceMuted, borderRadius: radius.md }]}>
        {checking || working ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="watch-outline" size={21} color={colors.primary} />}
        <Text style={[styles.body, styles.flex, { color: colors.textSecondary }]}>
          {working ? 'Working with your watch. You can still go back.' : checking ? 'Checking watch-face support…'
            : notice || (devices.length > 1 && !device ? 'Choose the watch you want to change.' : watchFaceStatusCopy(device))}
        </Text>
      </View>
      <View style={styles.designs}>
        {WATCH_FACES.map((face) => (
          <Pressable key={face.id} accessibilityRole="radio"
            accessibilityLabel={face.name + '. ' + face.description}
            accessibilityState={{ checked: selected === face.id, disabled: working }}
            disabled={working} onPress={() => { touched.current = true; setSelected(face.id); }}
            style={({ pressed }) => [styles.design, stacked && styles.stacked, {
              borderColor: selected === face.id ? colors.primary : colors.border,
              backgroundColor: selected === face.id ? colors.primary + '0C' : 'transparent',
              borderRadius: radius.lg, opacity: pressed ? 0.72 : 1,
            }]}>
            <WatchFacePreview id={face.id} />
            <View style={stacked ? undefined : styles.flex}>
              <View style={styles.nameRow}>
                <Text style={[styles.name, { color: colors.text }]}>{face.name}</Text>
                <Ionicons name={selected === face.id ? 'radio-button-on' : 'radio-button-off'} size={22} color={selected === face.id ? colors.primary : colors.textTertiary} />
              </View>
              <Text style={[styles.body, { color: colors.textSecondary }]}>{face.description}</Text>
              {device?.active && device.installedFaceId === face.id && (
                <Text style={[styles.active, { color: colors.primary }]}>Active on your watch</Text>
              )}
              {watchFaceUpdateRequired(device, face.id) && (
                <Text style={[styles.active, { color: colors.textSecondary }]}>Needs the latest watch companion</Text>
              )}
            </View>
          </Pressable>
        ))}
      </View>
      {watchFaceUpdateRequired(device, selected) && (
        <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.textSecondary }]}>
          Update your watch companion from the same release as this phone app to use {selectedFace.name}.
          Your current watch face will keep working.
        </Text>
      )}
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: !installAllowed, busy: working }}
        disabled={!installAllowed} onPress={() => void run(false)}
        style={({ pressed }) => [styles.action, { backgroundColor: colors.primary, borderRadius: radius.md,
          opacity: !installAllowed ? 0.45 : pressed ? 0.75 : 1 }]}>
        <Text style={[styles.actionText, { color: colors.onPrimary }]}>Use {selectedFace.name} on watch</Text>
      </Pressable>
      {activationAvailable && (
        <Pressable accessibilityRole="button" onPress={() => void run(true)}
          style={({ pressed }) => [styles.action, { borderColor: colors.primary, borderWidth: 1, borderRadius: radius.md, opacity: pressed ? 0.7 : 1 }]}>
          <Text style={[styles.actionText, { color: colors.primary }]}>Open setup on watch</Text>
        </Pressable>
      )}
      <Text style={[styles.small, { color: colors.textSecondary }]}>
        Wear OS 6 or later keeps one installed T1 Arc design in this slot. Switching designs resets face-specific customisation.
        Your glucose units and colours still follow the phone.
      </Text>
      <View style={styles.links}>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled}
          onPress={() => void refresh()} style={styles.link}>
          <Text style={[styles.linkText, { color: colors.primary, opacity: disabled ? 0.5 : 1 }]}>Check face status</Text>
        </Pressable>
        <Pressable accessibilityRole="link" onPress={() => {
          void Linking.openURL(GUIDE).catch(() => setNotice('Open the Watch setup guide in the T1 Arc GitHub repository.'));
        }} style={styles.link}>
          <Text style={[styles.linkText, { color: colors.primary }]}>Watch setup guide</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { marginTop: 24, gap: 12 },
  heading: { fontSize: 21, fontWeight: '800' },
  body: { fontSize: 14, lineHeight: 21 },
  small: { fontSize: 12, lineHeight: 19 },
  flex: { flex: 1, minWidth: 0 },
  targets: { gap: 8 },
  target: { minHeight: 48, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1 },
  status: { padding: 14, gap: 10, flexDirection: 'row', alignItems: 'center' },
  designs: { gap: 12 },
  design: { padding: 14, gap: 16, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center' },
  stacked: { flexDirection: 'column', alignItems: 'stretch' },
  nameRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 6 },
  name: { fontSize: 18, fontWeight: '700' },
  active: { fontSize: 12, fontWeight: '700', marginTop: 8 },
  action: { minHeight: 50, justifyContent: 'center', alignItems: 'center', padding: 14 },
  actionText: { fontSize: 15, fontWeight: '800', textAlign: 'center' },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  link: { minHeight: 48, paddingVertical: 12, paddingHorizontal: 4, justifyContent: 'center' },
  linkText: { fontSize: 13, fontWeight: '700' },
});
