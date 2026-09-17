import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Installer, { type InstallerProgress, type WatchEndpoint } from '../../../modules/t1arc-watch-installer';
import GlucoseDisplay from '../../../modules/t1arc-glucose-display';
import { useAppTheme } from '@/theme/theme';
import { FoodToolsPage } from '../foodLogger/FoodToolsPage';
import { WATCH_BRANDS, WATCH_SETUP_TITLES, automaticWatchChoice, setupError, watchPort, type WatchBrand } from './watchSetupGuide';

export function WatchSetupWizard({ visible, onClose }: { visible: boolean; onClose(): void }) {
  const { colors, radius } = useAppTheme();
  const [step, setStep] = useState(0);
  const [brand, setBrand] = useState<WatchBrand>('samsung');
  const [legacy, setLegacy] = useState(false);
  const [devices, setDevices] = useState<WatchEndpoint[]>([]);
  const [selected, setSelected] = useState('');
  const [manual, setManual] = useState(false);
  const [host, setHost] = useState('');
  const [pairingPort, setPairingPort] = useState('');
  const [connectionPort, setConnectionPort] = useState('');
  const [code, setCode] = useState('');
  const [pairedHost, setPairedHost] = useState('');
  const [model, setModel] = useState('your watch');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [progress, setProgress] = useState<InstallerProgress>();
  const [readingConfirmed, setReadingConfirmed] = useState(false);
  const operation = useRef(0);
  const running = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const listener = Installer?.addListener('progress', event => { if (mounted.current && running.current) setProgress(event); });
    return () => { mounted.current = false; listener?.remove(); void Installer?.disconnectAsync(); };
  }, []);

  async function run(action: (current: () => boolean) => Promise<void>) {
    if (!Installer?.available || running.current) return;
    running.current = true;
    const generation = ++operation.current;
    const current = () => mounted.current && operation.current === generation;
    setBusy(true); setError('');
    try { await action(current); }
    catch (failure) { if (current()) { setProgress(undefined); setError(setupError(failure)); } }
    finally { if (current()) { running.current = false; setBusy(false); } }
  }

  function choose(device: WatchEndpoint) {
    setSelected(device.id); setHost(device.host);
    setPairingPort(device.pairingPort ? String(device.pairingPort) : '');
    setConnectionPort(device.connectionPort ? String(device.connectionPort) : '');
    setLegacy(device.legacy); setError('');
  }

  function scan() {
    void run(async current => {
      const found = await Installer!.discoverAsync();
      if (!current()) return;
      setDevices(found);
      const previous = found.find(device => device.host === host);
      const choice = automaticWatchChoice(found, host, manual, selected);
      if (choice) choose(choice);
      else setSelected(previous?.id ?? '');
      setManual(found.length === 0 || (manual && !choice));
      setNotice(found.length ? 'Choose the device whose address matches your watch. Only a Wear OS watch can be installed.' : 'No watch found yet. Keep Pair new device open on the watch, then try again or enter its address below.');
    });
  }

  function advance() {
    setError(''); setNotice('');
    setStep(step + 1);
    if (step === 2) scan();
  }

  function pairAndConnect() {
    void run(async current => {
      let port = watchPort(connectionPort);
      if (!host.trim()) throw new Error('Choose your watch, or enter the IP address shown on it.');
      if (!manual && devices.length > 1 && !selected) throw new Error('Choose your watch before continuing.');
      if (!legacy && pairedHost !== host.trim()) {
        if (!/^\d{6}$/.test(code)) throw new Error('Enter the six-digit pairing code shown on your watch.');
        let pairPort = watchPort(pairingPort);
        if (!pairPort) {
          // The user may open Pair new device after the initial scan. Give its
          // short-lived pairing service a fresh discovery before asking for ports.
          const found = await Installer!.discoverAsync();
          if (!current()) return;
          setDevices(found);
          const target = found.find(device => device.host === host.trim() && device.pairingPort);
          pairPort = target?.pairingPort;
          if (target) {
            setSelected(target.id);
            setPairingPort(String(pairPort));
            port = target.connectionPort ?? port;
            if (port) setConnectionPort(String(port));
          }
        }
        if (!pairPort) { setManual(true); throw new Error('Enter the pairing port from Pair new device on your watch.'); }
        await Installer!.pairAsync(host.trim(), pairPort, code);
        if (!current()) return;
        setPairedHost(host.trim()); setCode('');
        setNotice('Paired. Return to the main Wireless debugging screen on your watch.');
        const found = await Installer!.discoverAsync();
        if (!current()) return;
        const connected = found.find(device => device.host === host.trim() && device.connectionPort);
        port = connected?.connectionPort ?? port;
        if (port) setConnectionPort(String(port));
      }
      if (!port) { setManual(true); throw new Error('Enter the connection port from the main Wireless debugging screen. It is different from the pairing port.'); }
      const connected = await Installer!.connectAsync(host.trim(), port);
      if (current()) { setModel(connected.model); setStep(4); setNotice(''); }
    });
  }

  function install() {
    void run(async current => {
      const port = watchPort(connectionPort);
      if (!port) throw new Error('Go back and reconnect your watch.');
      setProgress({ phase: 'checking', percent: 0 });
      await Installer!.connectAsync(host.trim(), port);
      if (!current()) return;
      const result = await Installer!.installAsync();
      if (!current()) return;
      setStep(5); setReadingConfirmed(false);
      setNotice(result.alreadyInstalled ? 'The matching companion is already installed.' : `T1 Arc ${result.version} is installed on ${result.model}.`);
    });
  }

  function checkConnection() {
    void run(async current => {
      const status = await GlucoseDisplay.getWearStatusAsync();
      if (!current()) return;
      setNotice(status.companionAvailable
        ? 'A companion is connected. Open T1 Arc on your watch to check the reading and its time; a connected status alone does not confirm delivery.'
        : 'Installed, but the companion has not connected yet. Open T1 Arc on the watch and check it is paired to this phone in the manufacturer’s app.');
    });
  }

  async function cancel() {
    ++operation.current;
    setBusy(true);
    try { await Installer?.cancelAsync(); }
    finally { if (mounted.current) { running.current = false; setBusy(false); setError('Setup stopped. Reconnect before retrying; an installation already accepted by the watch may still finish.'); if (step === 4) setStep(3); } }
  }

  function back() {
    if (busy) return;
    setError('');
    if (step > 0 && step < 5) { setStep(step - 1); return; }
    void Installer?.disconnectAsync();
    onClose();
  }

  const input = (label: string, value: string, change: (value: string) => void, numeric = true) => <View style={styles.field}>
    <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
    <TextInput accessibilityLabel={label} value={value} onChangeText={change} editable={!busy}
      autoCapitalize="none" autoCorrect={false} keyboardType={numeric ? 'number-pad' : 'default'}
      style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.sm }]} />
  </View>;

  return <FoodToolsPage visible={visible} title={WATCH_SETUP_TITLES[step]!} backLabel={step === 0 || step === 5 ? 'Back to watch settings' : 'Back'} onBack={back} busy={busy}>
    <Text accessibilityLabel={`Step ${step + 1} of 6`} style={[styles.step, { color: colors.primary }]}>STEP {step + 1} OF 6</Text>
    <View style={styles.steps}>{WATCH_SETUP_TITLES.map((title, index) => <View key={title} style={[styles.stepBar, { backgroundColor: index <= step ? colors.primary : colors.border }]} />)}</View>
    {step === 0 && <>
      <Text style={[styles.body, { color: colors.text }]}>Connect your phone and watch to the same Wi-Fi. Keep the watch nearby, awake and charging.</Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>Your watch should already be paired with this phone in its usual watch app. You only need debugging for installation and companion updates.</Text>
    </>}
    {step === 1 && <>
      <Text style={[styles.body, { color: colors.text }]}>Which watch do you have?</Text>
      {WATCH_BRANDS.map(item => <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{ checked: brand === item.id }} onPress={() => setBrand(item.id)}
        style={[styles.button, { borderRadius: radius.md, borderColor: brand === item.id ? colors.primary : colors.border, backgroundColor: colors.surfaceMuted }]}>
        <Text style={[styles.buttonText, { color: brand === item.id ? colors.primary : colors.text }]}>{item.label}{brand === item.id ? ' ✓' : ''}</Text>
      </Pressable>)}
      <Text style={[styles.body, { color: colors.text }]}>{WATCH_BRANDS.find(item => item.id === brand)!.developerSteps}</Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>Already enabled? Continue to the next step.</Text>
    </>}
    {step === 2 && <>
      <Text style={[styles.body, { color: colors.text }]}>{legacy
        ? 'Return to Settings → Developer options on your watch. Turn on ADB debugging, then Debug over Wi-Fi.'
        : 'Return to Settings → Developer options on your watch. Turn on ADB debugging, then Wireless debugging. If asked, allow debugging on this Wi-Fi network.'}</Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>{legacy
        ? 'Keep its address visible. Approve “Allow debugging” on the watch when this phone connects.'
        : 'Open Wireless debugging → Pair new device and leave that screen open.'}</Text>
      <SetupButton label={legacy ? 'Use pairing-code setup instead' : 'My watch only has “Debug over Wi-Fi”'} onPress={() => setLegacy(!legacy)} disabled={busy} />
    </>}
    {step === 3 && <>
      <Text style={[styles.body, { color: colors.text }]}>{legacy ? 'Keep Debug over Wi-Fi open on your watch.' : 'Keep Pair new device open on your watch and enter its six-digit code here.'}</Text>
      {devices.map(device => <Pressable key={device.id} disabled={busy} accessibilityRole="radio" accessibilityState={{ checked: selected === device.id, disabled: busy }} onPress={() => choose(device)}
        style={[styles.button, { borderRadius: radius.md, borderColor: selected === device.id ? colors.primary : colors.border }]}>
        <Text style={[styles.buttonText, { color: colors.text }]}>{device.name}</Text>
        <Text style={{ color: colors.textSecondary }}>{device.host}{selected === device.id ? ' ✓' : ''}</Text>
      </Pressable>)}
      {!legacy && pairedHost !== host.trim() && input('Pairing code', code, value => setCode(value.replace(/\D/g, '').slice(0, 6)))}
      {manual && <>
        {input('Watch IP address', host, value => { setHost(value); setSelected(''); }, false)}
        {!legacy && pairedHost !== host.trim() && input('Pairing port (Pair new device screen)', pairingPort, setPairingPort)}
        {input('Connection port (main debugging screen)', connectionPort, setConnectionPort)}
      </>}
      <SetupButton label="Find watch again" onPress={scan} disabled={busy} />
      {!legacy && !!host && pairedHost !== host.trim() && <SetupButton label="This phone is already paired" onPress={() => { setPairedHost(host.trim()); setCode(''); if (!connectionPort) setManual(true); }} disabled={busy} />}
      {!manual && <SetupButton label="My watch is not listed" onPress={() => setManual(true)} disabled={busy} />}
      {!!pairedHost && <SetupButton label="Pair again with a new code" onPress={() => { setPairedHost(''); setCode(''); setManual(true); }} disabled={busy} />}
    </>}
    {step === 4 && <>
      <Text style={[styles.body, { color: colors.text }]}>Ready to install on {model}.</Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>T1 Arc will install the matching companion, including its five watch-face designs. Keep both devices on this Wi-Fi until it finishes.</Text>
      {progress && <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.primary }]}>{({ checking: 'Checking the companion…', transferring: `Transferring… ${progress.percent}%`, installing: 'Installing on the watch…', verifying: 'Verifying installation…' })[progress.phase]}</Text>}
    </>}
    {step === 5 && <>
      <Text style={[styles.body, { color: colors.text }]}>Open T1 Arc on your watch. Check that your glucose reading and its time appear.</Text>
      <SetupButton label="Check companion connection" onPress={checkConnection} disabled={busy} />
      <SetupButton label={readingConfirmed ? 'Reading checked ✓' : 'I can see my reading on the watch'} onPress={() => setReadingConfirmed(true)} disabled={busy} />
      <Text style={[styles.body, { color: colors.text }]}>On your watch, turn Wireless debugging and ADB debugging off. Normal glucose syncing does not need them.</Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>Choose a face next. On supported Wear OS 6 watches, the designs are already inside the companion. Older watches keep their existing setup options.</Text>
    </>}
    {!!notice && <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.textSecondary }]}>{notice}</Text>}
    {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[styles.body, { color: colors.warning }]}>{error}</Text>}
    {busy ? <><ActivityIndicator color={colors.primary} /><SetupButton label="Stop setup" onPress={() => void cancel()} /></>
      : step < 3 ? <SetupButton label="Continue" onPress={advance} primary />
      : step === 3 ? <SetupButton label={legacy || pairedHost === host.trim() ? 'Connect watch' : 'Pair and connect'} onPress={pairAndConnect} primary />
      : step === 4 ? <SetupButton label="Install on watch" onPress={install} primary />
      : <SetupButton label="Done · choose a watch face" onPress={() => { void Installer?.disconnectAsync(); onClose(); }} primary />}
  </FoodToolsPage>;
}

function SetupButton({ label, onPress, primary = false, disabled = false }: { label: string; onPress(): void; primary?: boolean; disabled?: boolean }) {
  const { colors, radius } = useAppTheme();
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, { borderRadius: radius.md, borderColor: colors.border,
      backgroundColor: primary ? colors.primary : colors.surfaceMuted, opacity: disabled ? 0.45 : pressed ? 0.7 : 1 }]}>
    <Text style={[styles.buttonText, { color: primary ? colors.onPrimary : colors.text }]}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  body: { fontSize: 16, lineHeight: 24 }, step: { fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  steps: { flexDirection: 'row', gap: 6, marginBottom: 8 }, stepBar: { flex: 1, height: 4, borderRadius: 2 },
  button: { minHeight: 52, padding: 14, borderWidth: 1, justifyContent: 'center', gap: 4 },
  buttonText: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  field: { gap: 8 }, label: { fontSize: 14, fontWeight: '600' }, input: { minHeight: 52, borderWidth: 1, padding: 12, fontSize: 18 },
});
