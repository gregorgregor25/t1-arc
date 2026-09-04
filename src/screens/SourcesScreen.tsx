import Ionicons from "@expo/vector-icons/Ionicons";
import { NavigationProp, useNavigation } from "@react-navigation/native";
import {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { AppScreen } from "@/components/AppScreen";
import { AutomationStatusCard } from "@/components/AutomationStatusCard";
import { DexcomClarityImportCard } from "@/components/DexcomClarityImportCard";
import { DexcomShareSourceCard } from "@/components/DexcomShareSourceCard";
import { EncryptedBackupCard } from "@/components/EncryptedBackupCard";
import { GlookoImportCard } from "@/components/GlookoImportCard";
import { GlucoseDisplayCard } from "@/components/GlucoseDisplayCard";
import { GlucoseAlertSettingsCard } from "@/components/GlucoseAlertSettingsCard";
import { HealthConnectCard } from "@/components/HealthConnectCard";
import { HealthConnectRecordReview } from "@/components/HealthConnectRecordReview";
import { HevySourceCard } from "@/components/HevySourceCard";
import { StravaSourceCard } from "@/components/StravaSourceCard";
import { HomeGlucoseWidgetCard } from "@/components/HomeGlucoseWidgetCard";
import { LocalDataControlCard } from "@/components/LocalDataControlCard";
import { MaintainerMigrationCard } from "@/components/MaintainerMigrationCard";
import { MedtrumSourceCard } from "@/components/MedtrumSourceCard";
import { NightscoutSourceCard } from "@/components/NightscoutSourceCard";
import { NotificationSourceCard } from "@/components/NotificationSourceCard";
import { RegionalSettingsCard } from "@/components/RegionalSettingsCard";
import { OnboardingScreen } from "@/screens/OnboardingScreen";
import { SectionCard } from "@/components/SectionCard";
import { SourceSetupGuide } from "@/components/SourceSetupGuide";
import { ThemePreferenceCard } from "@/components/ThemePreferenceCard";
import { TarvisTreatmentProfileCard } from "@/components/TarvisTreatmentProfileCard";
import { WearCompanionCard } from "@/components/WearCompanionCard";
import { XdripSourceCard } from "@/components/XdripSourceCard";
import {
  commitVerifiedLibreLinkUp,
  verifyLibreLinkUp,
} from "@/data/libreLinkUp/connectLibreLinkUp";
import { disableGlucoseDisplay } from "@/data/glucoseDisplay/glucoseDisplayCoordinator";
import {
  beginLibreLinkUpConnectionChange,
  disconnectLibreLinkUpConnection,
  loadLibreLinkUpCredentials,
} from "@/data/libreLinkUp/secureStore";
import type { SourceConnectionWriteLease } from '@/data/live/sourceConnectionOwnership';
import {
  LibreLinkUpCredentials,
  LibreLinkUpError,
  LibreLinkUpSnapshot,
} from "@/data/libreLinkUp/types";
import { acquireLocalDataWriteLease } from '@/data/privacy/localDataWriteEpoch';
import { observeRegionalProfile } from "@/data/regionalProfile";
import { formatTime, relativeAge } from "@/domain/time";
import { formatGlucose, formatRegionalNumber } from "@/domain/regionalFormat";
import {
  DEFAULT_REGIONAL_PROFILE,
  resolveRegionalDefaults,
  type T1ArcRegionalProfile,
} from "@/domain/regionalProfile";
import { useAndroidBack } from "@/hooks/useAndroidBack";
import { useLatestData } from "@/hooks/useTimeline";
import type { RootTabParamList } from "@/navigation/AppNavigator";
import {
  SOURCE_MENU_ITEMS,
  SOURCE_MENU_SECTIONS,
  SourceJump,
  sourceJumpFromRoute,
  sourceSettingsBackTarget,
  sourceSettingsRouteParams,
} from "@/navigation/sourceNavigation";
import { SOURCE_SETUP_GUIDES } from "@/navigation/sourceSetupGuides";
import { useDataContext } from "@/providers/DataProvider";
import {
  beginLibreVerification,
  createLibreVerificationGuard,
  invalidateLibreVerification,
  isCurrentLibreVerification,
  libreVerificationActionLabel,
  libreSetupErrorForDisplay,
  LibreVerificationStage,
  runLibreVerification,
} from "@/screens/libreSetupVerification";
import { useAppTheme } from "@/theme/theme";

type TestState =
  | { kind: "idle" }
  | { kind: "testing"; stage: LibreVerificationStage }
  | { kind: "success"; snapshot: LibreLinkUpSnapshot; testedAt: number }
  | { kind: "error"; error: LibreLinkUpError };

type LibreCredentialLoadState = "loading" | "ready" | "unavailable";

function emptyLibreDraft(
  topLevelDomain: LibreLinkUpCredentials["topLevelDomain"] = "io",
): LibreLinkUpCredentials {
  return { email: "", password: "", topLevelDomain };
}

function maskEmail(value: string) {
  const [name = "", domain = ""] = value.split("@");
  if (!domain) return "Saved follower account";
  const visible = name.slice(0, Math.min(2, name.length));
  return `${visible}${"•".repeat(Math.max(3, Math.min(7, name.length - visible.length)))}@${domain}`;
}

export function SourcesScreen({
  route,
}: {
  route?: { params?: { focused?: boolean; source?: SourceJump } };
}) {
  const navigation = useNavigation<NavigationProp<RootTabParamList>>();
  const { colors, radius } = useAppTheme();
  const {
    activateLibreSnapshot,
    refreshData,
    reloadSources,
    setDataMode,
    syncing,
  } = useDataContext();
  const latest = useLatestData();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedCredentials, setSavedCredentials] = useState<
    LibreLinkUpCredentials | undefined
  >();
  const [editing, setEditing] = useState(true);
  const [testState, setTestState] = useState<TestState>({ kind: "idle" });
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [libreCredentialLoadState, setLibreCredentialLoadState] =
    useState<LibreCredentialLoadState>("loading");
  const [regionalProfile, setRegionalProfile] = useState<T1ArcRegionalProfile>(
    DEFAULT_REGIONAL_PROFILE,
  );
  const regionalDefaults = useMemo(
    () => resolveRegionalDefaults(regionalProfile),
    [regionalProfile],
  );
  const libreCredentialRequest = useRef(0);
  const libreDraft = useRef<LibreLinkUpCredentials>(
    emptyLibreDraft(resolveRegionalDefaults().libreTopLevelDomain),
  );
  const [libreTopLevelDomain, setLibreTopLevelDomain] = useState<"io" | "us">(
    () => resolveRegionalDefaults().libreTopLevelDomain,
  );
  const [libreVerificationGuard] = useState(() =>
    createLibreVerificationGuard(
      emptyLibreDraft(resolveRegionalDefaults().libreTopLevelDomain),
    ),
  );
  const activeLibreVerification = useRef<number | undefined>(undefined);
  const activeLibreVerificationAbort = useRef<AbortController | undefined>(
    undefined,
  );
  const libreVerificationBusy = useRef(false);
  const libreScreenMounted = useRef(false);
  const scrollViewRef = useRef<ScrollView | null>(null);
  const requestedSource = sourceJumpFromRoute(route?.params?.source);
  const activeSource = requestedSource;
  const [expandedSetting, setExpandedSetting] = useState<string>();
  const [tourOpen, setTourOpen] = useState(false);

  useEffect(() => observeRegionalProfile(setRegionalProfile), []);

  const replaceLibreDraft = useCallback(
    (draft: LibreLinkUpCredentials, clearVerification = true) => {
      libreDraft.current = draft;
      invalidateLibreVerification(libreVerificationGuard, draft);
      setEmail(draft.email);
      setPassword(draft.password);
      setLibreTopLevelDomain(draft.topLevelDomain);
      if (clearVerification) setTestState({ kind: "idle" });
    },
    [libreVerificationGuard],
  );

  const updateLibreDraft = useCallback(
    (update: Partial<LibreLinkUpCredentials>) => {
      if (libreVerificationBusy.current) return;
      replaceLibreDraft({ ...libreDraft.current, ...update });
    },
    [replaceLibreDraft],
  );

  useEffect(() => {
    // Route changes are navigation commands. Collapse any previously expanded
    // card before showing the requested source so stale controls cannot linger.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpandedSetting(undefined);
    if (requestedSource !== "libre") {
      activeLibreVerificationAbort.current?.abort();
      invalidateLibreVerification(
        libreVerificationGuard,
        libreDraft.current,
      );
      setTestState({ kind: "idle" });
    }
  }, [libreVerificationGuard, requestedSource]);

  const loadSavedLibreCredentials = useCallback(async () => {
    const request = ++libreCredentialRequest.current;
    setLibreCredentialLoadState("loading");
    try {
      const credentials = await loadLibreLinkUpCredentials();
      if (request !== libreCredentialRequest.current) return;
      const draft = credentials ?? emptyLibreDraft(regionalDefaults.libreTopLevelDomain);
      replaceLibreDraft(draft);
      setSavedCredentials(credentials);
      setSaved(credentials !== undefined);
      setEditing(credentials === undefined);
      setLibreCredentialLoadState("ready");
    } catch {
      if (request !== libreCredentialRequest.current) return;
      setLibreCredentialLoadState("unavailable");
    }
  }, [regionalDefaults.libreTopLevelDomain, replaceLibreDraft]);

  useEffect(() => {
    libreScreenMounted.current = true;
    // Start SecureStore work after the mount commits; the request generation
    // below prevents a late result from publishing after this screen closes.
    void Promise.resolve().then(() => {
      if (libreScreenMounted.current) void loadSavedLibreCredentials();
    });
    return () => {
      libreScreenMounted.current = false;
      activeLibreVerificationAbort.current?.abort();
      libreCredentialRequest.current += 1;
      invalidateLibreVerification(
        libreVerificationGuard,
        libreDraft.current,
      );
    };
  }, [libreVerificationGuard, loadSavedLibreCredentials]);

  const canTest =
    email.trim().includes("@") && password.length > 0 && !verificationBusy;
  const libreVerificationStage =
    testState.kind === "testing" ? testState.stage : undefined;
  const libreActionLabel = libreVerificationActionLabel(libreVerificationStage);
  const savedLibreActionLabel = libreVerificationActionLabel(
    libreVerificationStage,
    "Check connection",
  );

  const currentReading = useMemo(() => {
    if (testState.kind !== "success") return undefined;
    return testState.snapshot.readings[testState.snapshot.readings.length - 1];
  }, [testState]);

  const liveStatus = latest.sources.find(
    (source) =>
      source.id === "t1arc-live-glucose" ||
      source.id === "t1arc-librelinkup",
  );
  // A stored Libre password is not proof that a glucose source is usable.
  // Display/alert controls unlock only after the active source reports live.
  const glucoseSourceReady = Boolean(liveStatus?.isLive);

  async function testConnection() {
    if (!canTest || libreVerificationBusy.current) return;
    const credentials = {
      ...libreDraft.current,
      email: libreDraft.current.email.trim(),
    };
    const request = beginLibreVerification(
      libreVerificationGuard,
      credentials,
    );
    const abortController = new AbortController();
    activeLibreVerificationAbort.current?.abort();
    activeLibreVerificationAbort.current = abortController;
    libreDraft.current = credentials;
    activeLibreVerification.current = request.generation;
    libreVerificationBusy.current = true;
    setVerificationBusy(true);
    setTestState({ kind: "testing", stage: "checking" });
    try {
      const writeLease = await acquireLocalDataWriteLease();
      const candidate = await beginLibreLinkUpConnectionChange(writeLease);
      let sourceWriteLease: SourceConnectionWriteLease | undefined;
      const outcome = await runLibreVerification({
        request,
        verify: (signal) => verifyLibreLinkUp(credentials, signal, writeLease),
        commit: async (snapshot) => {
          sourceWriteLease = await commitVerifiedLibreLinkUp(
            credentials,
            snapshot,
            candidate,
          );
        },
        activate: async (snapshot) => {
          if (!sourceWriteLease) {
            throw new Error('The verified LibreLinkUp owner was not activated.');
          }
          await activateLibreSnapshot(
            snapshot,
            credentials,
            writeLease,
            sourceWriteLease,
          );
        },
        isCurrent: (candidate) =>
          libreScreenMounted.current &&
          isCurrentLibreVerification(
            libreVerificationGuard,
            candidate,
            libreDraft.current,
          ),
        onStage: (stage) => {
          if (
            libreScreenMounted.current &&
            isCurrentLibreVerification(
              libreVerificationGuard,
              request,
              libreDraft.current,
            )
          ) {
            setTestState({ kind: "testing", stage });
          }
        },
        signal: abortController.signal,
      });
      if (outcome.kind === "superseded") return;
      if (outcome.kind === "error") throw outcome.error;

      const snapshot = outcome.value;
      setSavedCredentials(credentials);
      setSaved(true);
      setEditing(false);
      setTestState({ kind: "success", snapshot, testedAt: Date.now() });
    } catch (error) {
      setTestState({
        kind: "error",
        error: libreSetupErrorForDisplay(error),
      });
    } finally {
      if (activeLibreVerification.current === request.generation) {
        activeLibreVerification.current = undefined;
        if (activeLibreVerificationAbort.current === abortController) {
          activeLibreVerificationAbort.current = undefined;
        }
        libreVerificationBusy.current = false;
        if (libreScreenMounted.current) setVerificationBusy(false);
      }
    }
  }

  function confirmClear() {
    if (libreVerificationBusy.current) return;
    Alert.alert(
      "Remove saved LibreLinkUp connection?",
      "This removes the saved LibreLinkUp sign-in. Glucose already collected stays secure on this phone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            void (async () => {
              await disableGlucoseDisplay().catch(() => undefined);
              await disconnectLibreLinkUpConnection();
              replaceLibreDraft(emptyLibreDraft(regionalDefaults.libreTopLevelDomain));
              setSavedCredentials(undefined);
              setSaved(false);
              setEditing(true);
              setLibreCredentialLoadState("ready");
              await setDataMode("live");
            })();
          },
        },
      ],
    );
  }

  const showChangedPersonalData = useCallback(async () => {
    await reloadSources();
  }, [reloadSources]);

  function resetConnectionUiAfterErase() {
    replaceLibreDraft(emptyLibreDraft(regionalDefaults.libreTopLevelDomain));
    setSavedCredentials(undefined);
    setSaved(false);
    setEditing(true);
  }

  function toggleSetting(setting: string) {
    setExpandedSetting((current) =>
      current === setting ? undefined : setting,
    );
  }

  function showSource(source: SourceJump) {
    setExpandedSetting(undefined);
    navigation.setParams(sourceSettingsRouteParams(source));
    requestAnimationFrame(() => {
      scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    });
  }

  const showSourceOverview = useCallback(() => {
    setExpandedSetting(undefined);
    navigation.setParams(sourceSettingsRouteParams());
    scrollViewRef.current?.scrollTo({ y: 0, animated: true });
  }, [navigation]);

  const closeSettings = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("Today");
  }, [navigation]);

  const handleSettingsBack = useCallback(() => {
    if (sourceSettingsBackTarget(activeSource) === "overview") {
      showSourceOverview();
      return;
    }
    closeSettings();
  }, [activeSource, closeSettings, showSourceOverview]);

  useAndroidBack(!tourOpen, handleSettingsBack);

  if (tourOpen) {
    return (
      <OnboardingScreen
        mode="replay"
        onComplete={() => setTourOpen(false)}
        onRequestClose={() => setTourOpen(false)}
      />
    );
  }

  return (
    <AppScreen
      title="Settings"
      refreshing={syncing}
      onRefresh={() => void refreshData()}
      scrollViewRef={scrollViewRef}
      trailing={
        <Pressable
          accessibilityLabel="Close settings"
          accessibilityRole="button"
          hitSlop={6}
          onPress={closeSettings}
          style={({ pressed }) => [
            styles.closeSettings,
            {
              backgroundColor: colors.surfaceElevated,
              borderColor: colors.surfaceBorder,
              borderRadius: radius.pill,
              opacity: pressed ? 0.68 : 1,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.textSecondary}
            name="close"
            size={24}
          />
        </Pressable>
      }
    >
      {activeSource ? (
        <SourceDetailHeader
          backLabel="All settings"
          guide={SOURCE_SETUP_GUIDES[activeSource]}
          onBack={showSourceOverview}
          source={activeSource}
        />
      ) : !activeSource ? (
        <View style={styles.overviewSections}>
          <RegionalSettingsCard />
          <SettingsDisclosure
            detail="Add the insulin-to-carb ratios already agreed in your care plan."
            expanded={expandedSetting === "overview-diabetes-profile"}
            icon="person-circle-outline"
            onToggle={() => toggleSetting("overview-diabetes-profile")}
            title="Diabetes profile"
          >
            <TarvisTreatmentProfileCard />
          </SettingsDisclosure>
          <SourceJumpGrid active={activeSource} onSelect={showSource} />
          <TourReplayCard onPress={() => setTourOpen(true)} />
          <SettingsDisclosure
            detail="Runs quietly in the background. Open only if something needs attention."
            expanded={expandedSetting === "overview-automation"}
            icon="sync-outline"
            onToggle={() => toggleSetting("overview-automation")}
            title="Automatic updates"
          >
            <AutomationStatusCard />
          </SettingsDisclosure>
        </View>
      ) : null}

      {activeSource === "libre" ? (
        <View style={styles.settingsSections}>
          {libreCredentialLoadState === "loading" ? (
            <SectionCard accessibilityLabel="Checking saved LibreLinkUp connection">
              <View style={styles.savedRow}>
                <ActivityIndicator color={colors.primary} />
                <View style={styles.savedCopy}>
                  <Text style={[styles.savedTitle, { color: colors.text }]}>
                    Checking connection
                  </Text>
                  <Text
                    style={[styles.savedEmail, { color: colors.textSecondary }]}
                  >
                    Reading the encrypted sign-in on this phone…
                  </Text>
                </View>
              </View>
            </SectionCard>
          ) : libreCredentialLoadState === "unavailable" ? (
            <SectionCard accessibilityLabel="Saved LibreLinkUp connection unavailable">
              <View style={styles.savedRow}>
                <View
                  style={[
                    styles.savedIcon,
                    { backgroundColor: `${colors.warning}18` },
                  ]}
                >
                  <Ionicons
                    accessibilityElementsHidden
                    color={colors.warning}
                    name="alert-circle-outline"
                    size={22}
                  />
                </View>
                <View style={styles.savedCopy}>
                  <Text style={[styles.savedTitle, { color: colors.text }]}>
                    Connection status unavailable
                  </Text>
                  <Text
                    style={[styles.savedEmail, { color: colors.textSecondary }]}
                  >
                    T1 Arc could not safely read the saved sign-in. Nothing was
                    changed.
                  </Text>
                </View>
              </View>
              <Pressable
                accessibilityLabel="Check saved LibreLinkUp connection again"
                accessibilityRole="button"
                onPress={() => void loadSavedLibreCredentials()}
                style={({ pressed }) => [
                  styles.primaryButton,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderRadius: radius.md,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.primary}
                  name="refresh-outline"
                  size={20}
                />
                <Text
                  style={[styles.primaryButtonText, { color: colors.primary }]}
                >
                  Try again
                </Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Remove unreadable LibreLinkUp connection"
                accessibilityRole="button"
                onPress={confirmClear}
                style={({ pressed }) => [
                  styles.primaryButton,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderRadius: radius.md,
                    marginTop: 8,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.danger}
                  name="trash-outline"
                  size={20}
                />
                <Text
                  style={[styles.primaryButtonText, { color: colors.danger }]}
                >
                  Remove unreadable connection
                </Text>
              </Pressable>
            </SectionCard>
          ) : (
            <>
              {saved && !editing ? (
                <SectionCard>
                  <View style={styles.savedRow}>
                    <View
                      style={[
                        styles.savedIcon,
                        { backgroundColor: `${colors.accent}18` },
                      ]}
                    >
                      <Ionicons
                        accessibilityElementsHidden
                        color={colors.accent}
                        name="lock-closed-outline"
                        size={22}
                      />
                    </View>
                    <View style={styles.savedCopy}>
                      <Text style={[styles.savedTitle, { color: colors.text }]}>
                        Sign-in saved
                      </Text>
                      <Text
                        style={[
                          styles.savedEmail,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {maskEmail(email)} · {savedCredentials?.topLevelDomain === "us" ? "US service" : "International service"}
                      </Text>
                    </View>
                  </View>
                  <Pressable
                    accessibilityLabel={savedLibreActionLabel}
                    accessibilityState={{
                      disabled: !canTest,
                    }}
                    accessibilityRole="button"
                    disabled={!canTest}
                    onPress={() => void testConnection()}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      {
                        backgroundColor: colors.surfaceMuted,
                        borderRadius: radius.md,
                      },
                      pressed && canTest && { opacity: 0.78 },
                    ]}
                  >
                    {verificationBusy ? (
                      <ActivityIndicator color={colors.primary} />
                    ) : (
                      <Ionicons
                        accessibilityElementsHidden
                        color={canTest ? colors.primary : colors.textTertiary}
                        name="refresh-outline"
                        size={20}
                      />
                    )}
                    <Text
                      style={[
                        styles.primaryButtonText,
                        {
                          color: canTest ? colors.primary : colors.textTertiary,
                        },
                      ]}
                    >
                      {savedLibreActionLabel}
                    </Text>
                  </Pressable>
                  <View style={styles.secondaryRow}>
                    <Pressable
                      accessibilityState={{ disabled: verificationBusy }}
                      accessibilityRole="button"
                      disabled={verificationBusy}
                      onPress={() => {
                        invalidateLibreVerification(
                          libreVerificationGuard,
                          libreDraft.current,
                        );
                        setTestState({ kind: "idle" });
                        setEditing(true);
                      }}
                      style={({ pressed }) => [
                        styles.secondaryButton,
                        { borderColor: colors.border, borderRadius: radius.md },
                        pressed && { backgroundColor: colors.surfaceMuted },
                        verificationBusy && { opacity: 0.5 },
                      ]}
                    >
                      <Text
                        style={[
                          styles.secondaryText,
                          { color: colors.primary },
                        ]}
                      >
                        Change account
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityState={{ disabled: verificationBusy }}
                      accessibilityRole="button"
                      disabled={verificationBusy}
                      onPress={confirmClear}
                      style={({ pressed }) => [
                        styles.secondaryButton,
                        { borderColor: colors.border, borderRadius: radius.md },
                        pressed && { backgroundColor: colors.surfaceMuted },
                        verificationBusy && { opacity: 0.5 },
                      ]}
                    >
                      <Text
                        style={[styles.secondaryText, { color: colors.danger }]}
                      >
                        Remove
                      </Text>
                    </Pressable>
                  </View>
                </SectionCard>
              ) : (
                <SectionCard>
                  <View style={styles.fieldGroup}>
                    <Text style={[styles.label, { color: colors.text }]}>
                      LibreLinkUp email
                    </Text>
                    <TextInput
                      accessibilityLabel="LibreLinkUp email"
                      autoCapitalize="none"
                      autoComplete="email"
                      autoCorrect={false}
                      editable={!verificationBusy}
                      keyboardType="email-address"
                      onChangeText={(value) =>
                        updateLibreDraft({ email: value })
                      }
                      placeholder="you@example.com"
                      placeholderTextColor={colors.textTertiary}
                      style={[
                        styles.input,
                        {
                          backgroundColor: colors.surfaceMuted,
                          borderColor: colors.border,
                          borderRadius: radius.md,
                          color: colors.text,
                        },
                      ]}
                      textContentType="emailAddress"
                      value={email}
                    />
                  </View>

                  <View style={styles.fieldGroup}>
                    <Text style={[styles.label, { color: colors.text }]}>Account service</Text>
                    <View accessibilityRole="radiogroup" style={styles.regionChips}>
                      {(["io", "us"] as const).map((value) => {
                        const active = libreTopLevelDomain === value;
                        return (
                          <Pressable
                            accessibilityRole="radio"
                            accessibilityState={{ checked: active, disabled: verificationBusy }}
                            disabled={verificationBusy}
                            key={value}
                            onPress={() => updateLibreDraft({ topLevelDomain: value })}
                            style={({ pressed }) => [
                              styles.regionChip,
                              {
                                backgroundColor: active ? `${colors.primary}1C` : colors.surfaceMuted,
                                borderColor: active ? colors.primary : colors.border,
                                borderRadius: radius.pill,
                                opacity: pressed ? 0.68 : 1,
                              },
                            ]}
                          >
                            <Text style={[styles.regionChipText, { color: active ? colors.primary : colors.textSecondary }]}>
                              {value === "us" ? "United States" : "International"}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Text style={[styles.fieldHelp, { color: colors.textTertiary }]}>Choose the service used by the LibreLinkUp account. T1 Arc follows Libre’s verified regional redirect after sign-in.</Text>
                  </View>

                  <View style={styles.fieldGroup}>
                    <Text style={[styles.label, { color: colors.text }]}>
                      LibreLinkUp password
                    </Text>
                    <View
                      style={[
                        styles.passwordRow,
                        {
                          backgroundColor: colors.surfaceMuted,
                          borderColor: colors.border,
                          borderRadius: radius.md,
                        },
                      ]}
                    >
                      <TextInput
                        accessibilityLabel="LibreLinkUp password"
                        autoCapitalize="none"
                        autoComplete="password"
                        autoCorrect={false}
                        editable={!verificationBusy}
                        onChangeText={(value) =>
                          updateLibreDraft({ password: value })
                        }
                        placeholder="Password"
                        placeholderTextColor={colors.textTertiary}
                        secureTextEntry={!passwordVisible}
                        style={[styles.passwordInput, { color: colors.text }]}
                        textContentType="password"
                        value={password}
                      />
                      <Pressable
                        accessibilityLabel={
                          passwordVisible ? "Hide password" : "Show password"
                        }
                        accessibilityRole="button"
                        accessibilityState={{ disabled: verificationBusy }}
                        disabled={verificationBusy}
                        hitSlop={8}
                        onPress={() =>
                          setPasswordVisible((visible) => !visible)
                        }
                        style={({ pressed }) => [
                          styles.eyeButton,
                          pressed && { opacity: 0.58 },
                          verificationBusy && { opacity: 0.5 },
                        ]}
                      >
                        <Ionicons
                          accessibilityElementsHidden
                          color={colors.textSecondary}
                          name={
                            passwordVisible ? "eye-off-outline" : "eye-outline"
                          }
                          size={22}
                        />
                      </Pressable>
                    </View>
                  </View>

                  <Pressable
                    accessibilityLabel={libreActionLabel}
                    accessibilityState={{
                      disabled: !canTest,
                    }}
                    accessibilityRole="button"
                    disabled={!canTest}
                    onPress={() => void testConnection()}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      {
                        backgroundColor: canTest
                          ? colors.primary
                          : colors.surfaceMuted,
                        borderRadius: radius.md,
                      },
                      pressed && canTest && { opacity: 0.78 },
                    ]}
                  >
                    {verificationBusy ? (
                      <ActivityIndicator color={colors.onPrimary} />
                    ) : (
                      <Ionicons
                        accessibilityElementsHidden
                        color={canTest ? colors.onPrimary : colors.textTertiary}
                        name="shield-checkmark-outline"
                        size={20}
                      />
                    )}
                    <Text
                      style={[
                        styles.primaryButtonText,
                        {
                          color: canTest
                            ? colors.onPrimary
                            : colors.textTertiary,
                        },
                      ]}
                    >
                      {libreActionLabel}
                    </Text>
                  </Pressable>
                  {saved ? (
                    <Pressable
                      accessibilityState={{ disabled: verificationBusy }}
                      accessibilityRole="button"
                      disabled={verificationBusy}
                      onPress={() => {
                        if (!savedCredentials) return;
                        replaceLibreDraft(savedCredentials);
                        setEditing(false);
                      }}
                      style={({ pressed }) => [
                        styles.cancelButton,
                        pressed && { opacity: 0.6 },
                        verificationBusy && { opacity: 0.5 },
                      ]}
                    >
                      <Text
                        style={[
                          styles.secondaryText,
                          { color: colors.textSecondary },
                        ]}
                      >
                        Cancel account change
                      </Text>
                    </Pressable>
                  ) : null}
                </SectionCard>
              )}

              {testState.kind === "success" && currentReading ? (
                <SectionCard
                  accessibilityLabel="LibreLinkUp connection verified"
                  style={[
                    styles.resultCard,
                    {
                      backgroundColor: colors.surfaceMuted,
                      borderColor: `${colors.accent}55`,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.resultIcon,
                      { backgroundColor: `${colors.accent}1E` },
                    ]}
                  >
                    <Ionicons
                      accessibilityElementsHidden
                      color={colors.accent}
                      name="checkmark"
                      size={22}
                    />
                  </View>
                  <View style={styles.resultCopy}>
                    <Text style={[styles.resultTitle, { color: colors.text }]}>
                      Connected and activated
                    </Text>
                    <Text
                      style={[styles.body, { color: colors.textSecondary }]}
                    >
                      Received {formatGlucose(currentReading.mmolL, regionalDefaults)} at{" "}
                      {formatTime(currentReading.timestamp)} (
                      {relativeAge(
                        currentReading.timestamp,
                        testState.testedAt,
                      )}
                      ).
                    </Text>
                    <Text style={[styles.meta, { color: colors.textTertiary }]}>
                      {formatRegionalNumber(
                        testState.snapshot.readings.length,
                        regionalDefaults.locale,
                        { maximumFractionDigits: 0 },
                      )} readings received ·
                      encrypted history enabled
                    </Text>
                    {(currentReading.timestampDiscrepancyMinutes ?? 0) > 5 ? (
                      <Text
                        style={[
                          styles.timestampWarning,
                          { color: colors.warning },
                        ]}
                      >
                        LibreLinkUp supplied factory and local timestamps that
                        differ by {currentReading.timestampDiscrepancyMinutes}{" "}
                        minutes. T1 Arc retained both for diagnosis.
                      </Text>
                    ) : null}
                  </View>
                </SectionCard>
              ) : null}

              {testState.kind === "error" ? (
                <SectionCard
                  accessibilityLabel="LibreLinkUp connection error"
                  style={[
                    styles.resultCard,
                    {
                      backgroundColor: colors.surfaceMuted,
                      borderColor: `${colors.danger}55`,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.resultIcon,
                      { backgroundColor: `${colors.danger}18` },
                    ]}
                  >
                    <Ionicons
                      accessibilityElementsHidden
                      color={colors.danger}
                      name="alert"
                      size={21}
                    />
                  </View>
                  <View style={styles.resultCopy}>
                    <Text style={[styles.resultTitle, { color: colors.text }]}>
                      Connection not verified
                    </Text>
                    <Text
                      style={[styles.body, { color: colors.textSecondary }]}
                    >
                      {testState.error.message}
                    </Text>
                  </View>
                </SectionCard>
              ) : null}
            </>
          )}
        </View>
      ) : null}

      {activeSource === "profile" ? (
        <View style={styles.settingsSections}>
          <TarvisTreatmentProfileCard />
        </View>
      ) : null}

      {activeSource === "nightscout" ? (
        <View style={styles.settingsSections}>
          <NightscoutSourceCard />
        </View>
      ) : null}

      {activeSource === "dexcom" ? (
        <View style={styles.settingsSections}>
          <DexcomShareSourceCard defaultRegion={regionalDefaults.dexcomRegion} />
          <SettingsDisclosure
            detail="Add older glucose from a Dexcom Clarity CSV if you need it."
            expanded={expandedSetting === "dexcom-history"}
            icon="time-outline"
            onToggle={() => toggleSetting("dexcom-history")}
            title="Older history (optional)"
          >
            <DexcomClarityImportCard />
          </SettingsDisclosure>
        </View>
      ) : null}

      {activeSource === "medtrum" ? (
        <View style={styles.settingsSections}>
          <MedtrumSourceCard defaultRegion={regionalDefaults.medtrumRegion} />
        </View>
      ) : null}

      {activeSource === "xdrip" ? (
        <View style={styles.settingsSections}>
          <XdripSourceCard />
        </View>
      ) : null}

      {activeSource === "display" ? (
        <View style={styles.settingsSections}>
          <SettingsDisclosure
            detail="Follow your phone, or choose a light or dark app theme."
            expanded={expandedSetting === "display-theme"}
            icon="contrast-outline"
            onToggle={() => toggleSetting("display-theme")}
            title="App appearance"
          >
            <ThemePreferenceCard />
          </SettingsDisclosure>
          <SettingsDisclosure
            detail="Choose where your current reading appears on this phone."
            expanded={expandedSetting === "display-phone"}
            icon="phone-portrait-outline"
            onToggle={() => toggleSetting("display-phone")}
            title="Phone and lock screen"
          >
            <GlucoseDisplayCard connected={glucoseSourceReady} />
          </SettingsDisclosure>
          <SettingsDisclosure
            detail="Set the alerts that deserve your attention."
            expanded={expandedSetting === "display-alerts"}
            icon="notifications-outline"
            onToggle={() => toggleSetting("display-alerts")}
            title="Glucose alerts"
          >
            <GlucoseAlertSettingsCard connected={glucoseSourceReady} />
          </SettingsDisclosure>
          <SettingsDisclosure
            detail="Keep a quiet glucose glance on your home screen."
            expanded={expandedSetting === "display-widget"}
            icon="grid-outline"
            onToggle={() => toggleSetting("display-widget")}
            title="Home screen widget"
          >
            <HomeGlucoseWidgetCard />
          </SettingsDisclosure>
          <SettingsDisclosure
            detail="Show current glucose and freshness on your wrist."
            expanded={expandedSetting === "display-wear"}
            icon="watch-outline"
            onToggle={() => toggleSetting("display-wear")}
            title="Wear OS"
          >
            <WearCompanionCard />
          </SettingsDisclosure>
        </View>
      ) : null}

      {activeSource === "notification" ? (
        <View style={styles.settingsSections}>
          <NotificationSourceCard onConnected={showChangedPersonalData} />
        </View>
      ) : null}

      {activeSource === "health" ? (
        <View style={styles.settingsSections}>
          <HealthConnectCard onDataChanged={showChangedPersonalData} />
          <SettingsDisclosure
            detail="Review the Health Connect entries available in T1 Arc."
            expanded={expandedSetting === "health-records"}
            icon="list-outline"
            onToggle={() => toggleSetting("health-records")}
            title="View imported data"
          >
            <HealthConnectRecordReview />
          </SettingsDisclosure>
        </View>
      ) : null}

      {activeSource === "glooko" ? (
        <View style={styles.settingsSections}>
          <GlookoImportCard />
        </View>
      ) : null}

      {activeSource === "hevy" ? (
        <View style={styles.settingsSections}>
          <HevySourceCard onDataChanged={showChangedPersonalData} />
        </View>
      ) : null}

      {activeSource === "strava" ? (
        <View style={styles.settingsSections}>
          <StravaSourceCard onOpenHealthConnect={() => showSource("health")} />
        </View>
      ) : null}

      {activeSource === "privacy" ? (
        <View style={styles.settingsSections}>
          <SettingsDisclosure
            detail="Only for a protected migration bundle from an earlier T1 Arc test installation."
            expanded={expandedSetting === "privacy-migration"}
            icon="swap-horizontal-outline"
            onToggle={() => toggleSetting("privacy-migration")}
            title="Earlier test-app migration"
          >
            <MaintainerMigrationCard onDataChanged={showChangedPersonalData} />
          </SettingsDisclosure>
          <SettingsDisclosure
            detail="Keep a protected copy of your data that you control."
            expanded={expandedSetting === "privacy-backup"}
            icon="lock-closed-outline"
            onToggle={() => toggleSetting("privacy-backup")}
            title="Encrypted backup"
          >
            <EncryptedBackupCard onDataChanged={showChangedPersonalData} />
          </SettingsDisclosure>
          <SettingsDisclosure
            detail="Inspect or remove personal data stored on this device."
            expanded={expandedSetting === "privacy-device"}
            icon="phone-portrait-outline"
            onToggle={() => toggleSetting("privacy-device")}
            title="Device data controls"
          >
            <LocalDataControlCard onErased={resetConnectionUiAfterErase} />
          </SettingsDisclosure>
        </View>
      ) : null}
    </AppScreen>
  );
}

function TourReplayCard({ onPress }: { onPress(): void }) {
  const { colors, radius } = useAppTheme();
  return (
    <View>
      <Text style={[styles.sourceGroupTitle, { color: colors.textSecondary }]}>
        Help & learning
      </Text>
      <SectionCard style={styles.tourReplayShell}>
        <Pressable
          accessibilityHint="Opens a five-step visual guide to the app."
          accessibilityRole="button"
          onPress={onPress}
          style={({ pressed }) => [
            styles.tourReplayButton,
            { opacity: pressed ? 0.66 : 1 },
          ]}
        >
          <View
            style={[
              styles.tourReplayIcon,
              {
                backgroundColor: `${colors.accent}18`,
                borderRadius: radius.md,
              },
            ]}
          >
            <Ionicons
              accessibilityElementsHidden
              color={colors.accent}
              name="map-outline"
              size={21}
            />
          </View>
          <View style={styles.tourReplayCopy}>
            <Text style={[styles.sourceJumpLabel, { color: colors.text }]}>
              Take the T1 Arc tour
            </Text>
            <Text
              style={[styles.sourceJumpDetail, { color: colors.textSecondary }]}
            >
              A quick guide to Today, logging, History, Health and Tarv1s.
            </Text>
          </View>
          <Ionicons
            accessibilityElementsHidden
            color={colors.textTertiary}
            name="chevron-forward"
            size={18}
          />
        </Pressable>
      </SectionCard>
    </View>
  );
}

function SettingsDisclosure({
  children,
  detail,
  expanded,
  icon,
  onToggle,
  title,
}: {
  children: ReactNode;
  detail: string;
  expanded: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  onToggle(): void;
  title: string;
}) {
  const { colors, radius } = useAppTheme();

  return (
    <View>
      <SectionCard style={styles.disclosureShell}>
        <Pressable
          accessibilityHint={
            expanded ? `Collapses ${title}` : `Expands ${title} settings`
          }
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={onToggle}
          style={({ pressed }) => [
            styles.disclosureTrigger,
            pressed && { opacity: 0.66 },
          ]}
        >
          <View
            accessibilityElementsHidden
            style={[
              styles.disclosureIcon,
              {
                backgroundColor: `${colors.primary}16`,
                borderRadius: radius.md,
              },
            ]}
          >
            <Ionicons color={colors.primary} name={icon} size={21} />
          </View>
          <View style={styles.disclosureCopy}>
            <Text style={[styles.disclosureTitle, { color: colors.text }]}>
              {title}
            </Text>
            <Text
              numberOfLines={expanded ? undefined : 1}
              style={[styles.disclosureDetail, { color: colors.textSecondary }]}
            >
              {detail}
            </Text>
          </View>
          <Ionicons
            accessibilityElementsHidden
            color={expanded ? colors.primary : colors.textTertiary}
            name={expanded ? "chevron-up" : "chevron-down"}
            size={21}
          />
        </Pressable>
      </SectionCard>
      {expanded ? (
        <View style={styles.disclosureContent}>{children}</View>
      ) : null}
    </View>
  );
}

function SourceDetailHeader({
  backLabel,
  guide,
  onBack,
  source,
}: {
  backLabel: string;
  guide?: (typeof SOURCE_SETUP_GUIDES)[SourceJump];
  onBack(): void;
  source: SourceJump;
}) {
  const { colors, radius } = useAppTheme();
  const item = SOURCE_MENU_ITEMS.find(
    (candidate) => candidate.source === source,
  )!;
  return (
    <View style={styles.detailHeader}>
      <Pressable
        accessibilityLabel={backLabel}
        accessibilityRole="button"
        onPress={onBack}
        style={({ pressed }) => [
          styles.backButton,
          {
            backgroundColor: colors.surfaceMuted,
            borderColor: colors.border,
            borderRadius: radius.pill,
            opacity: pressed ? 0.68 : 1,
          },
        ]}
      >
        <Ionicons
          accessibilityElementsHidden
          color={colors.primary}
          name="arrow-back"
          size={17}
        />
        <Text style={[styles.backText, { color: colors.primary }]}>
          {backLabel}
        </Text>
      </Pressable>
      <View style={styles.detailTitleRow}>
        <Text style={[styles.detailName, { color: colors.text }]}>
          {item.label}
        </Text>
        {guide ? <SourceSetupGuide key={source} {...guide} /> : null}
      </View>
    </View>
  );
}

function SourceJumpGrid({
  active,
  onSelect,
}: {
  active?: SourceJump;
  onSelect(source: SourceJump): void;
}) {
  const { colors, radius } = useAppTheme();
  return (
    <View style={styles.sourceJumpSections}>
      {SOURCE_MENU_SECTIONS.map((section) => (
        <View key={section.id}>
          <Text
            style={[styles.sourceGroupTitle, { color: colors.textSecondary }]}
          >
            {section.title}
          </Text>
          <View style={styles.sourceJumpGrid}>
            {section.items.map((item) => {
              const selected = active === item.source;
              return (
                <Pressable
                  key={item.source}
                  accessibilityLabel={
                    item.source === "glooko"
                      ? "Open Glooko connection"
                      : `Open ${item.label}`
                  }
                  accessibilityHint={`Opens ${item.label} controls.`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => onSelect(item.source)}
                  style={({ pressed }) => [
                    styles.sourceJump,
                    {
                      backgroundColor: selected
                        ? `${colors.primary}12`
                        : colors.surface,
                      borderColor: selected ? colors.primary : colors.border,
                      borderRadius: radius.md,
                      opacity: pressed ? 0.68 : 1,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.sourceJumpIcon,
                      {
                        backgroundColor: `${colors.primary}14`,
                        borderRadius: radius.sm,
                      },
                    ]}
                  >
                    <Ionicons
                      accessibilityElementsHidden
                      color={colors.primary}
                      name={item.icon}
                      size={19}
                    />
                  </View>
                  <View style={styles.sourceJumpCopy}>
                    <Text
                      style={[styles.sourceJumpLabel, { color: colors.text }]}
                    >
                      {item.label}
                    </Text>
                    <Text
                      style={[
                        styles.sourceJumpDetail,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {item.detail}
                    </Text>
                  </View>
                  <Ionicons
                    accessibilityElementsHidden
                    color={selected ? colors.primary : colors.textTertiary}
                    name={selected ? "checkmark-circle" : "chevron-forward"}
                    size={16}
                  />
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  closeSettings: {
    width: 44,
    height: 44,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  overviewSections: {
    marginTop: 18,
    gap: 22,
  },
  body: {
    fontSize: 13,
    lineHeight: 20,
    marginTop: 5,
  },
  sourceJumpGrid: {
    gap: 8,
  },
  sourceJumpSections: {
    gap: 20,
  },
  sourceGroupTitle: {
    marginBottom: 8,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  settingsSections: {
    marginTop: 18,
    gap: 10,
  },
  disclosureShell: {
    padding: 0,
    overflow: "hidden",
  },
  disclosureTrigger: {
    minHeight: 76,
    paddingHorizontal: 13,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  disclosureIcon: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  disclosureCopy: {
    flex: 1,
    minWidth: 0,
  },
  disclosureTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
  },
  disclosureDetail: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 1,
  },
  disclosureContent: {
    marginTop: 10,
    gap: 12,
  },
  detailHeader: {
    minHeight: 56,
    marginTop: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  backButton: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  backText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
  },
  detailName: {
    fontSize: 19,
    lineHeight: 25,
    fontWeight: "800",
    textAlign: "right",
  },
  detailTitleRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
  },
  sourceJump: {
    width: "100%",
    minHeight: 66,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sourceJumpIcon: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  sourceJumpCopy: {
    flex: 1,
    minWidth: 0,
  },
  tourReplayShell: {
    padding: 0,
    overflow: "hidden",
  },
  tourReplayButton: {
    minHeight: 74,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  tourReplayIcon: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  tourReplayCopy: {
    flex: 1,
    minWidth: 0,
  },
  sourceJumpLabel: {
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "800",
  },
  sourceJumpDetail: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  savedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  savedIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  savedCopy: {
    flex: 1,
  },
  savedTitle: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "700",
  },
  savedEmail: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  fieldGroup: {
    gap: 7,
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  regionChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  regionChip: {
    minHeight: 42,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  regionChipText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
  },
  fieldHelp: {
    fontSize: 10,
    lineHeight: 16,
  },
  input: {
    minHeight: 52,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  passwordRow: {
    minHeight: 52,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  passwordInput: {
    minHeight: 50,
    flex: 1,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  eyeButton: {
    width: 52,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButton: {
    minHeight: 52,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  primaryButtonText: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
  },
  secondaryRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  cancelButton: {
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  resultCard: {
    flexDirection: "row",
    gap: 12,
    marginTop: 12,
  },
  resultIcon: {
    width: 38,
    height: 38,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  resultCopy: {
    flex: 1,
  },
  resultTitle: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "800",
  },
  meta: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 5,
  },
  timestampWarning: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
    marginTop: 7,
  },
});
