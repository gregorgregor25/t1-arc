import Ionicons from "@expo/vector-icons/Ionicons";
import * as DocumentPicker from "expo-document-picker";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import T1ArcBackupCrypto from "../../modules/t1arc-backup-crypto";
import { SectionCard } from "@/components/SectionCard";
import { type HealthMigrationImportResult } from "@/data/backup/healthBackup";
import { runBackupPostCommitRefreshes } from "@/data/backup/postCommitRefreshes";
import {
  importMaintainerMigration,
  type PreparedMaintainerMigration,
  readMaintainerMigrationFile,
} from "@/data/migration/maintainerMigration";
import {
  MAINTAINER_MIGRATION_EXTENSION,
  MAINTAINER_MIGRATION_MIME,
} from "@/data/migration/migrationFormat";
import { formatRegionalNumber } from "@/domain/regionalFormat";
import { getRuntimeRegionalDefaults } from "@/domain/regionalProfileRuntime";
import { formatDate, formatTime, toDateKey } from "@/domain/time";
import { useGlucoseAppearance } from "@/providers/GlucoseAppearanceProvider";
import { useAppTheme } from "@/theme/theme";

interface Props {
  onDataChanged?(): Promise<void> | void;
}

interface SelectedMigration {
  name: string;
  uri: string;
}

type BusyState = "idle" | "unlocking" | "importing";
type Message = { tone: "success" | "warning" | "error"; text: string };
type MigrationErrorStage = "selection" | "unlock" | "import";

function formatCount(value: number) {
  return formatRegionalNumber(value, getRuntimeRegionalDefaults().locale);
}

export function validateMaintainerMigrationSelection(selection: {
  name?: string | null;
  uri?: string | null;
}): SelectedMigration {
  const name = selection.name?.trim();
  const uri = selection.uri?.trim();
  if (!name || !uri) {
    throw new Error("The selected migration file is unavailable.");
  }
  if (!name.toLowerCase().endsWith(MAINTAINER_MIGRATION_EXTENSION)) {
    throw new Error(
      `Choose a T1 Arc ${MAINTAINER_MIGRATION_EXTENSION} migration file.`,
    );
  }
  return { name, uri };
}

export function createMigrationArtifactCleaner(
  removeTemporaryFile: (uri: string) => Promise<boolean>,
) {
  const cleanupByUri = new Map<string, Promise<boolean>>();
  return {
    release(prepared?: PreparedMaintainerMigration) {
      if (!prepared) return Promise.resolve(false);
      const uri = prepared.backup.sourceUri;
      const existing = cleanupByUri.get(uri);
      if (existing) return existing;
      const cleanup = Promise.resolve()
        .then(() => removeTemporaryFile(uri))
        .catch(() => false);
      cleanupByUri.set(uri, cleanup);
      return cleanup;
    },
  };
}

export function describeMaintainerMigrationError(
  error: unknown,
  stage: MigrationErrorStage,
) {
  const raw = error instanceof Error ? error.message.trim() : "";
  const normalized = raw.toLowerCase();
  if (
    stage === "selection" &&
    (raw === "The selected migration file is unavailable." ||
      raw.startsWith("Choose a T1 Arc "))
  ) {
    return raw;
  }
  if (
    stage === "unlock" &&
    (normalized.includes("could not be unlocked") ||
      normalized.includes("authenticated or unlocked"))
  ) {
    return "The migration bundle could not be unlocked. Check the passphrase and file.";
  }
  if (stage === "unlock") {
    return "The migration bundle could not be validated. It may be damaged or incompatible with this version of T1 Arc.";
  }
  if (
    stage === "import" &&
    normalized.includes("empty") &&
    normalized.includes("data store")
  ) {
    return "This migration can only be applied to an empty T1 Arc data store.";
  }
  if (stage === "import") {
    return "The validated migration could not be applied. No partial import was accepted.";
  }
  return "A migration file could not be selected.";
}

export function describeMaintainerMigrationImport(
  result: HealthMigrationImportResult,
  refreshIncomplete = false,
): Message {
  const imported = result.kind === "imported";
  const base = imported
    ? `${formatCount(result.totalRecords)} stored rows were migrated exactly.`
    : `This exact ${formatCount(result.totalRecords)}-row migration was already applied.`;
  const preferences =
    imported && result.preferences === "restored"
      ? " Your portable regional, display, review and diabetes-profile preferences were restored."
      : "";
  const refresh = refreshIncomplete
    ? " The data is safely stored, but this screen could not fully refresh. Reopen T1 Arc to see every change."
    : "";
  return {
    tone: refreshIncomplete ? "warning" : "success",
    text: `${base}${preferences}${refresh}`,
  };
}

export function MaintainerMigrationCard({ onDataChanged }: Props) {
  const { colors, radius, setMode } = useAppTheme();
  const { reload: reloadGlucoseAppearance } = useGlucoseAppearance();
  const [busy, setBusy] = useState<BusyState>("idle");
  const [workingLabel, setWorkingLabel] = useState("");
  const [message, setMessage] = useState<Message>();
  const [selected, setSelected] = useState<SelectedMigration>();
  const [preview, setPreview] = useState<PreparedMaintainerMigration>();
  const [passphraseOpen, setPassphraseOpen] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [passphraseVisible, setPassphraseVisible] = useState(false);
  const [passphraseError, setPassphraseError] = useState<string>();
  const previewRef = useRef<PreparedMaintainerMigration | undefined>(undefined);
  const activeImportRef = useRef<PreparedMaintainerMigration | undefined>(
    undefined,
  );
  const mountedRef = useRef(true);
  const [artifactCleaner] = useState(() =>
    createMigrationArtifactCleaner((uri) =>
      T1ArcBackupCrypto.removeTemporaryFileAsync(uri),
    ),
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const prepared = previewRef.current;
      previewRef.current = undefined;
      if (!prepared || activeImportRef.current === prepared) return;
      void artifactCleaner.release(prepared);
    };
  }, [artifactCleaner]);

  function clearPassphrase() {
    setPassphrase("");
    setPassphraseVisible(false);
    setPassphraseError(undefined);
  }

  function closePassphrase() {
    if (busy !== "idle") return;
    setPassphraseOpen(false);
    setSelected(undefined);
    clearPassphrase();
  }

  async function chooseMigration() {
    setMessage(undefined);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [MAINTAINER_MIGRATION_MIME, "application/octet-stream"],
        copyToCacheDirectory: false,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      const chosen = validateMaintainerMigrationSelection(asset);
      setSelected(chosen);
      clearPassphrase();
      setPassphraseOpen(true);
    } catch (error) {
      setMessage({
        tone: "error",
        text: describeMaintainerMigrationError(error, "selection"),
      });
    }
  }

  async function unlockMigration(secret: string, chosen: SelectedMigration) {
    setBusy("unlocking");
    setWorkingLabel("Unlocking and validating the migration…");
    setMessage(undefined);
    let decryptedUri: string | undefined;
    try {
      const decrypted = await T1ArcBackupCrypto.decryptMigrationFileAsync(
        chosen.uri,
        secret,
      );
      decryptedUri = decrypted.uri;
      const prepared = await readMaintainerMigrationFile(decrypted.uri);
      decryptedUri = undefined;
      if (!mountedRef.current) {
        await artifactCleaner.release(prepared);
        return;
      }
      previewRef.current = prepared;
      setPreview(prepared);
    } catch (error) {
      if (mountedRef.current) {
        setSelected(chosen);
        setPassphraseError(
          describeMaintainerMigrationError(error, "unlock"),
        );
        setPassphraseOpen(true);
      }
    } finally {
      if (decryptedUri) {
        await T1ArcBackupCrypto.removeTemporaryFileAsync(decryptedUri).catch(
          () => false,
        );
      }
      if (mountedRef.current) {
        setBusy("idle");
        setWorkingLabel("");
      }
    }
  }

  function submitPassphrase() {
    if (!selected) return;
    if (passphrase.length < 12) {
      setPassphraseError(
        "Use the migration passphrase (at least 12 characters).",
      );
      return;
    }
    const chosen = selected;
    const secret = passphrase;
    setPassphraseOpen(false);
    clearPassphrase();
    void unlockMigration(secret, chosen);
  }

  async function commitMigration() {
    const prepared = previewRef.current;
    if (!prepared || activeImportRef.current || busy !== "idle") return;
    activeImportRef.current = prepared;
    setBusy("importing");
    setWorkingLabel("Migrating the validated records atomically…");
    setMessage(undefined);
    try {
      const result = await importMaintainerMigration(prepared);
      const refreshes: (() => Promise<unknown> | unknown)[] = [
        reloadGlucoseAppearance,
      ];
      const restoredTheme = prepared.backup.manifest.preferences?.themeMode;
      if (restoredTheme) refreshes.push(() => setMode(restoredTheme));
      if (onDataChanged) refreshes.push(onDataChanged);
      const refreshIncomplete = await runBackupPostCommitRefreshes(refreshes);
      if (mountedRef.current) {
        setMessage(
          describeMaintainerMigrationImport(result, refreshIncomplete),
        );
      }
    } catch (error) {
      if (mountedRef.current) {
        setMessage({
          tone: "error",
          text: describeMaintainerMigrationError(error, "import"),
        });
      }
    } finally {
      await artifactCleaner.release(prepared);
      if (previewRef.current === prepared) previewRef.current = undefined;
      activeImportRef.current = undefined;
      if (mountedRef.current) {
        setPreview(undefined);
        setSelected(undefined);
        setBusy("idle");
        setWorkingLabel("");
      }
    }
  }

  function cancelPreview() {
    if (busy !== "idle" || activeImportRef.current) return;
    const prepared = previewRef.current;
    previewRef.current = undefined;
    setPreview(undefined);
    setSelected(undefined);
    void artifactCleaner.release(prepared);
  }

  const manifest = preview?.backup.manifest;
  const working = busy !== "idle";

  return (
    <>
      <SectionCard style={styles.card}>
        <View style={styles.header}>
          <View
            style={[
              styles.icon,
              {
                backgroundColor: `${colors.accent}18`,
                borderRadius: radius.md,
              },
            ]}
          >
            <Ionicons
              accessibilityElementsHidden
              color={colors.accent}
              name="swap-horizontal-outline"
              size={23}
            />
          </View>
          <View style={styles.headerCopy}>
            <Text style={[styles.title, { color: colors.text }]}>
              Move data from an earlier T1 Arc test app
            </Text>
            <Text style={[styles.body, { color: colors.textSecondary }]}>
              Most people do not need this. Use the one-time encrypted
              migration bundle prepared from an earlier test installation.
              Import is allowed only into an empty T1 Arc data store and never
              overwrites existing history.
            </Text>
          </View>
        </View>

        <View
          style={[
            styles.notice,
            { backgroundColor: colors.surfaceMuted, borderRadius: radius.md },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.accent}
            name="shield-checkmark-outline"
            size={18}
          />
          <Text style={[styles.noticeText, { color: colors.textSecondary }]}>
            Provider passwords, session tokens, web cookies and Android
            permissions are excluded. Reconnect sources and approve device
            access after the records are verified.
          </Text>
        </View>

        {working ? (
          <View
            accessibilityLiveRegion="polite"
            style={[styles.progress, { borderColor: colors.border }]}
          >
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.progressText, { color: colors.textSecondary }]}>
              {workingLabel}
            </Text>
          </View>
        ) : null}

        {preview && manifest ? (
          <View
            style={[
              styles.preview,
              {
                backgroundColor: colors.surfaceMuted,
                borderColor: colors.border,
                borderRadius: radius.md,
              },
            ]}
          >
            <View style={styles.previewHeader}>
              <View style={styles.headerCopy}>
                <Text style={[styles.previewTitle, { color: colors.text }]}>
                  Validated and ready
                </Text>
                <Text style={[styles.meta, { color: colors.textSecondary }]}>
                  {selected?.name ?? "Encrypted migration"} ·{" "}
                  {formatDate(toDateKey(manifest.createdAt), {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}{" "}
                  at {formatTime(manifest.createdAt)}
                </Text>
              </View>
              <Ionicons
                accessibilityElementsHidden
                color={colors.accent}
                name="checkmark-circle-outline"
                size={25}
              />
            </View>

            <View style={styles.metrics}>
              <MigrationMetric label="All rows" value={manifest.totalRecords} />
              <MigrationMetric
                label="Glucose"
                value={manifest.counts.glucose_readings}
              />
              <MigrationMetric
                label="Insulin"
                value={
                  manifest.counts.insulin_basal +
                  manifest.counts.insulin_bolus +
                  manifest.counts.insulin_daily_totals
                }
              />
              <MigrationMetric
                label="Food"
                value={
                  manifest.counts.food_catalog_cache +
                  manifest.counts.food_logs +
                  manifest.counts.food_log_items +
                  manifest.counts.food_recipes +
                  manifest.counts.food_recipe_items
                }
              />
              <MigrationMetric
                label="Workouts"
                value={manifest.counts.hevy_workouts}
              />
              <MigrationMetric
                label="Reviews"
                value={manifest.counts.insight_reports}
              />
              <MigrationMetric
                label="Context"
                value={
                  manifest.counts.context_events + manifest.counts.context_notes
                }
              />
              <MigrationMetric
                label="Health"
                value={manifest.counts.health_connect_records}
              />
              <MigrationMetric
                label="Tarv1s"
                value={manifest.counts.portable_app_state}
              />
            </View>

            <Text style={[styles.fingerprint, { color: colors.textTertiary }]}>
              Record fingerprint{" "}
              {preview.recordFingerprint.sha256.slice(0, 16)}… · source{" "}
              {preview.metadata.sourceContainerSha256.slice(0, 16)}… · schema{" "}
              {preview.metadata.sourceBackupVersion}
            </Text>
            <Text style={[styles.confirmation, { color: colors.textSecondary }]}>
              Confirm only after the row counts look right. T1 Arc will verify
              every final table count and remember this exact bundle so it
              cannot be applied twice.
            </Text>

            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => void commitMigration()}
                style={({ pressed }) => [
                  styles.primaryButton,
                  {
                    backgroundColor: colors.primary,
                    borderRadius: radius.md,
                    opacity: pressed ? 0.76 : 1,
                  },
                ]}
              >
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.onPrimary}
                  name="checkmark-outline"
                  size={19}
                />
                <Text style={[styles.primaryText, { color: colors.onPrimary }]}>
                  Import this migration
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={cancelPreview}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  { borderColor: colors.border, opacity: pressed ? 0.62 : 1 },
                ]}
              >
                <Text
                  style={[
                    styles.secondaryText,
                    { color: colors.textSecondary },
                  ]}
                >
                  Cancel and remove preview
                </Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            disabled={working}
            onPress={() => void chooseMigration()}
            style={({ pressed }) => [
              styles.primaryButton,
              {
                backgroundColor: colors.primary,
                borderRadius: radius.md,
                opacity: working ? 0.48 : pressed ? 0.76 : 1,
              },
            ]}
          >
            <Ionicons
              accessibilityElementsHidden
              color={colors.onPrimary}
              name="document-lock-outline"
              size={19}
            />
            <Text style={[styles.primaryText, { color: colors.onPrimary }]}>
              Choose encrypted migration
            </Text>
          </Pressable>
        )}

        {message ? (
          <View
            accessibilityLiveRegion="polite"
            style={[
              styles.message,
              {
                borderColor:
                  message.tone === "error"
                    ? colors.danger
                    : message.tone === "warning"
                      ? colors.warning
                      : colors.accent,
                borderRadius: radius.md,
              },
            ]}
          >
            <Text style={[styles.messageText, { color: colors.textSecondary }]}>
              {message.text}
            </Text>
          </View>
        ) : null}
      </SectionCard>

      <Modal
        animationType="fade"
        onRequestClose={closePassphrase}
        transparent
        visible={passphraseOpen}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalRoot}
        >
          <Pressable
            accessibilityLabel="Close migration passphrase"
            accessibilityRole="button"
            onPress={() => {
              Keyboard.dismiss();
              closePassphrase();
            }}
            style={[
              styles.scrim,
              { backgroundColor: "rgba(5, 10, 18, 0.62)" },
            ]}
          />
          <View
            accessibilityViewIsModal
            style={[
              styles.modalCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radius.lg,
              },
            ]}
          >
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Unlock migration
            </Text>
            <Text style={[styles.body, { color: colors.textSecondary }]}>
              Enter the passphrase used when this one-time bundle was created.
              It stays only in memory while the file is checked.
            </Text>
            <View
              style={[
                styles.passphraseRow,
                {
                  borderColor: passphraseError ? colors.danger : colors.border,
                  borderRadius: radius.md,
                },
              ]}
            >
              <TextInput
                accessibilityLabel="Migration passphrase"
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect={false}
                onChangeText={(value) => {
                  setPassphrase(value);
                  setPassphraseError(undefined);
                }}
                onSubmitEditing={submitPassphrase}
                placeholder="Passphrase"
                placeholderTextColor={colors.textTertiary}
                secureTextEntry={!passphraseVisible}
                style={[styles.passphraseInput, { color: colors.text }]}
                value={passphrase}
              />
              <Pressable
                accessibilityLabel={
                  passphraseVisible ? "Hide passphrase" : "Show passphrase"
                }
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => setPassphraseVisible((visible) => !visible)}
                style={({ pressed }) => [
                  styles.eyeButton,
                  { opacity: pressed ? 0.55 : 1 },
                ]}
              >
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.textSecondary}
                  name={passphraseVisible ? "eye-off-outline" : "eye-outline"}
                  size={21}
                />
              </Pressable>
            </View>
            {passphraseError ? (
              <Text style={[styles.errorText, { color: colors.danger }]}>
                {passphraseError}
              </Text>
            ) : null}
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                onPress={closePassphrase}
                style={({ pressed }) => [
                  styles.modalSecondary,
                  { opacity: pressed ? 0.58 : 1 },
                ]}
              >
                <Text
                  style={[
                    styles.secondaryText,
                    { color: colors.textSecondary },
                  ]}
                >
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={submitPassphrase}
                style={({ pressed }) => [
                  styles.modalPrimary,
                  {
                    backgroundColor: colors.primary,
                    borderRadius: radius.md,
                    opacity: pressed ? 0.76 : 1,
                  },
                ]}
              >
                <Text style={[styles.primaryText, { color: colors.onPrimary }]}>
                  Unlock and check
                </Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

function MigrationMetric({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricValue, { color: colors.text }]}>
        {formatCount(value)}
      </Text>
      <Text style={[styles.metricLabel, { color: colors.textTertiary }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 16 },
  header: { flexDirection: "row", gap: 12 },
  icon: {
    alignItems: "center",
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  headerCopy: { flex: 1, gap: 5 },
  title: { fontSize: 17, fontWeight: "800" },
  body: { fontSize: 13, lineHeight: 19 },
  notice: { flexDirection: "row", gap: 9, padding: 12 },
  noticeText: { flex: 1, fontSize: 12, lineHeight: 18 },
  progress: {
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 10,
    paddingTop: 14,
  },
  progressText: { flex: 1, fontSize: 13 },
  preview: { borderWidth: StyleSheet.hairlineWidth, gap: 14, padding: 14 },
  previewHeader: { flexDirection: "row", gap: 10 },
  previewTitle: { fontSize: 15, fontWeight: "800" },
  meta: { fontSize: 12, lineHeight: 17 },
  metrics: { flexDirection: "row", flexWrap: "wrap", rowGap: 12 },
  metric: { width: "33.333%" },
  metricValue: { fontSize: 15, fontWeight: "800" },
  metricLabel: { fontSize: 11, marginTop: 2 },
  fingerprint: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 11,
  },
  confirmation: { fontSize: 12, lineHeight: 18 },
  actions: { gap: 9 },
  primaryButton: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: 14,
  },
  primaryText: { fontSize: 14, fontWeight: "800" },
  secondaryButton: {
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 14,
  },
  secondaryText: { fontSize: 13, fontWeight: "700" },
  message: { borderWidth: StyleSheet.hairlineWidth, padding: 12 },
  messageText: { fontSize: 12, lineHeight: 18 },
  modalRoot: { flex: 1, justifyContent: "center", padding: 20 },
  scrim: { ...StyleSheet.absoluteFill },
  modalCard: { borderWidth: StyleSheet.hairlineWidth, gap: 13, padding: 18 },
  modalTitle: { fontSize: 20, fontWeight: "900" },
  passphraseRow: {
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 48,
  },
  passphraseInput: { flex: 1, fontSize: 15, paddingHorizontal: 13 },
  eyeButton: { alignItems: "center", justifyContent: "center", padding: 12 },
  errorText: { fontSize: 12, lineHeight: 17 },
  modalActions: { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  modalSecondary: {
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 12,
  },
  modalPrimary: {
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 16,
  },
});
