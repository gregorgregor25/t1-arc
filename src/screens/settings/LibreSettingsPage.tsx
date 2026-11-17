import { Alert } from '@/components/appAlert';
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ConnectionHistoryCard } from '@/components/ConnectionHistoryCard';
import { SectionCard } from "@/components/SectionCard";
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

/**
 * Unsaved LibreLinkUp sign-in typed on this page, kept in memory by the
 * Settings screen so it survives moving between Settings pages (as it did
 * before the redesign). Never written to storage; cleared once the sign-in is
 * verified and saved, removed, or when Settings closes.
 */
export interface LibreDraftRetention {
  read(): LibreLinkUpCredentials | undefined;
  write(draft: LibreLinkUpCredentials | undefined): void;
}
export const LibreDraftRetentionContext = createContext<LibreDraftRetention | null>(null);

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

/**
 * LibreLinkUp sign-in. Mounted only while its page is open: leaving the page
 * cancels any check in progress, and opening it again reads the saved
 * sign-in from this phone.
 */
export function LibreSettingsPage() {
  const { colors, radius } = useAppTheme();
  const { activateLibreSnapshot, setDataMode } = useDataContext();
  const draftRetention = useContext(LibreDraftRetentionContext);
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
      const next = { ...libreDraft.current, ...update };
      draftRetention?.write(next);
      replaceLibreDraft(next);
    },
    [replaceLibreDraft, draftRetention],
  );

  const loadSavedLibreCredentials = useCallback(async () => {
    const request = ++libreCredentialRequest.current;
    setLibreCredentialLoadState("loading");
    try {
      const credentials = await loadLibreLinkUpCredentials();
      if (request !== libreCredentialRequest.current) return;
      const unsaved = draftRetention?.read();
      const draft =
        unsaved ?? credentials ?? emptyLibreDraft(regionalDefaults.libreTopLevelDomain);
      replaceLibreDraft(draft);
      setSavedCredentials(credentials);
      setSaved(credentials !== undefined);
      setEditing(unsaved !== undefined || credentials === undefined);
      setLibreCredentialLoadState("ready");
    } catch {
      if (request !== libreCredentialRequest.current) return;
      setLibreCredentialLoadState("unavailable");
    }
  }, [regionalDefaults.libreTopLevelDomain, replaceLibreDraft, draftRetention]);

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
      draftRetention?.write(undefined);
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
              draftRetention?.write(undefined);
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

  return (
    <>
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
                          borderColor: colors.controlBorder,
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
                        draftRetention?.write(undefined);
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
      <ConnectionHistoryCard />
    </>
  );
}

const styles = StyleSheet.create({
  body: {
    fontSize: 13,
    lineHeight: 20,
    marginTop: 5,
  },
  settingsSections: {
    marginTop: 18,
    gap: 10,
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
    minHeight: 44,
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
    fontSize: 12,
    lineHeight: 18,
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
