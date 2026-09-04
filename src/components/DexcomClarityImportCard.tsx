import Ionicons from "@expo/vector-icons/Ionicons";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  PreparedDexcomClarityImport,
  dexcomClarityImportSettingsFromRegionalDefaults,
  prepareDexcomClarityImport,
} from "@/data/import/dexcomClarityImport";
import type { DexcomClarityImportRegionalSettings } from "@/data/import/dexcomClarityCsv";
import { DexcomImportLifecycle } from "@/data/import/dexcomImportLifecycle";
import {
  ImportWriteResult,
  StoredImportSourceSummary,
} from "@/data/persistence/HealthRecordStore";
import { formatDate, relativeAge, toDateKey } from "@/domain/time";
import { formatRegionalNumber } from "@/domain/regionalFormat";
import { isIanaTimeZone } from "@/domain/regionalProfile";
import { useDataContext } from "@/providers/DataProvider";
import { useRegionalProfile } from "@/providers/RegionalProfileProvider";
import { useAppTheme } from "@/theme/theme";
import {
  acquireLocalDataWriteLease,
  isLocalDataWriteSupersededError,
  type LocalDataWriteLease,
} from '@/data/privacy/localDataWriteEpoch';

import { SectionCard } from "./SectionCard";

type ImportState =
  | { kind: "idle" }
  | { kind: "preparing" }
  | {
      kind: "preview";
      prepared: PreparedDexcomClarityImport;
      writeLease: LocalDataWriteLease;
    }
  | {
      kind: "importing";
      prepared: PreparedDexcomClarityImport;
      writeLease: LocalDataWriteLease;
    }
  | {
      kind: "success";
      preview: PreparedDexcomClarityImport["preview"];
      result: ImportWriteResult;
    }
  | { kind: "error"; message: string };

const DATE_ORDER_OPTIONS: {
  label: string;
  value: DexcomClarityImportRegionalSettings["dateOrder"];
}[] = [
  { label: "Day / month / year", value: "day-first" },
  { label: "Month / day / year", value: "month-first" },
];

function dateOrderLabel(
  dateOrder: DexcomClarityImportRegionalSettings["dateOrder"],
) {
  return dateOrder === "month-first"
    ? "Month / day / year"
    : "Day / month / year";
}

function dateRange(preview: { dataStart?: number; dataThrough?: number }) {
  if (preview.dataStart === undefined || preview.dataThrough === undefined) {
    return "No glucose range found";
  }
  const options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    year: "numeric",
  };
  return `${formatDate(toDateKey(preview.dataStart), options)} – ${formatDate(
    toDateKey(preview.dataThrough),
    options,
  )}`;
}

export function DexcomClarityImportCard() {
  const { colors, radius } = useAppTheme();
  const { defaults: regional } = useRegionalProfile();
  const {
    clearImportedDexcomData,
    getDexcomArchiveSummary,
    importDexcomData,
    revision,
  } = useDataContext();
  const profileImportSettings =
    dexcomClarityImportSettingsFromRegionalDefaults(regional);
  const [state, setState] = useState<ImportState>({ kind: "idle" });
  const [summary, setSummary] = useState<StoredImportSourceSummary>();
  const [dateOrder, setDateOrder] = useState(
    profileImportSettings.dateOrder,
  );
  const [importTimeZone, setImportTimeZone] = useState(
    profileImportSettings.timeZone,
  );
  const [lifecycle] = useState(() => new DexcomImportLifecycle());

  useEffect(() => {
    lifecycle.activate();
    return () => lifecycle.dispose();
  }, [lifecycle]);

  useEffect(() => {
    let active = true;
    void getDexcomArchiveSummary().then((next) => {
      if (active) setSummary(next);
    });
    return () => {
      active = false;
    };
  }, [getDexcomArchiveSummary, revision]);

  const busy = state.kind === "preparing" || state.kind === "importing";
  const prepared =
    state.kind === "preview" || state.kind === "importing"
      ? state.prepared
      : undefined;
  const writeLease =
    state.kind === 'preview' || state.kind === 'importing'
      ? state.writeLease
      : undefined;
  const settingsLocked = busy || Boolean(prepared);

  async function chooseExport() {
    const timeZone = importTimeZone.trim();
    if (!isIanaTimeZone(timeZone)) {
      setState({
        kind: "error",
        message:
          "Enter a valid IANA time zone, such as Europe/London, America/New_York or Asia/Tokyo.",
      });
      return;
    }
    const selectedImportSettings: DexcomClarityImportRegionalSettings = {
      dateOrder,
      timeZone,
    };
    const writeLease = await acquireLocalDataWriteLease();
    const generation = lifecycle.beginSelection();
    if (!lifecycle.isCurrent(generation)) return;
    setState({ kind: "preparing" });
    let selectedBytes: Uint8Array | undefined;
    try {
      const selected = await DocumentPicker.getDocumentAsync({
        type: [
          "text/csv",
          "text/comma-separated-values",
          "application/csv",
          "application/octet-stream",
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (selected.canceled) {
        if (lifecycle.isCurrent(generation)) setState({ kind: "idle" });
        return;
      }
      const asset = selected.assets[0];
      if (!asset) {
        if (!lifecycle.isCurrent(generation)) return;
        throw new Error("No Dexcom export was selected.");
      }
      const cached = new File(asset.uri);
      try {
        if (!lifecycle.isCurrent(generation)) return;
        const bytes = await cached.bytes();
        selectedBytes = bytes;
        if (!lifecycle.trackPreparation(bytes)) {
          selectedBytes = undefined;
          return;
        }
        if (!lifecycle.isCurrent(generation)) {
          lifecycle.release(bytes);
          selectedBytes = undefined;
          return;
        }
        const nextPrepared = await prepareDexcomClarityImport(
          asset.name,
          bytes,
          undefined,
          selectedImportSettings,
        );
        if (!lifecycle.isCurrent(generation)) {
          lifecycle.release(bytes);
          selectedBytes = undefined;
          return;
        }
        if (!lifecycle.retainPreview(bytes)) {
          selectedBytes = undefined;
          return;
        }
        selectedBytes = undefined;
        setState({ kind: "preview", prepared: nextPrepared, writeLease });
      } finally {
        try {
          if (cached.exists) cached.delete();
        } catch {
          // Android may already have released its temporary picker copy.
        }
      }
    } catch (error) {
      if (selectedBytes) lifecycle.release(selectedBytes);
      if (lifecycle.isCurrent(generation)) {
        setState({
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : "The Dexcom export could not be read.",
        });
      }
    }
  }

  async function commitImport() {
    if (
      !prepared ||
      !writeLease ||
      !lifecycle.beginImport(prepared.sourcePayload.bytes)
    ) {
      return;
    }
    setState({ kind: "importing", prepared, writeLease });
    let released = false;
    try {
      const result = await importDexcomData(prepared, writeLease);
      lifecycle.release(prepared.sourcePayload.bytes);
      released = true;
      if (!lifecycle.isMounted()) return;
      setState({ kind: "success", preview: prepared.preview, result });
      const nextSummary = await getDexcomArchiveSummary();
      if (lifecycle.isMounted()) setSummary(nextSummary);
    } catch (error) {
      if (isLocalDataWriteSupersededError(error)) {
        if (lifecycle.isMounted()) setState({ kind: 'idle' });
        return;
      }
      if (lifecycle.isMounted()) {
        setState({
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : "The encrypted Dexcom import did not complete.",
        });
      }
    } finally {
      if (!released) lifecycle.release(prepared.sourcePayload.bytes);
    }
  }

  function discardPreview() {
    if (prepared) lifecycle.release(prepared.sourcePayload.bytes);
    if (lifecycle.isMounted()) setState({ kind: "idle" });
  }

  function confirmClear() {
    Alert.alert(
      "Remove imported Dexcom history?",
      "This removes imported Dexcom readings and their saved files from this phone. Other glucose sources are not changed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            void (async () => {
              if (!lifecycle.isMounted()) return;
              setState({ kind: "preparing" });
              try {
                await clearImportedDexcomData();
                if (!lifecycle.isMounted()) return;
                setSummary(undefined);
                setState({ kind: "idle" });
              } catch (error) {
                if (!lifecycle.isMounted()) return;
                setState({
                  kind: "error",
                  message:
                    error instanceof Error
                      ? error.message
                      : "Dexcom history could not be removed.",
                });
              }
            })();
          },
        },
      ],
    );
  }

  return (
    <SectionCard>
      <View style={styles.header}>
        <View
          style={[
            styles.icon,
            {
              backgroundColor: `${colors.glucose}16`,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.glucose}
            name="analytics-outline"
            size={24}
          />
        </View>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: colors.text }]}>
            Dexcom Clarity history
          </Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            Optional older-history backfill from a downloaded Dexcom Clarity
            CSV.
          </Text>
        </View>
      </View>

      {summary?.archiveCount ? (
        <View
          style={[
            styles.statusPanel,
            {
              backgroundColor: `${colors.accent}0E`,
              borderColor: `${colors.accent}42`,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.accent}
            name="checkmark-circle"
            size={21}
          />
          <View style={styles.statusCopy}>
            <Text style={[styles.statusTitle, { color: colors.text }]}>
              History added
            </Text>
            <Text style={[styles.statusBody, { color: colors.textSecondary }]}>
              {summary.dataStart !== undefined &&
              summary.dataThrough !== undefined
                 ? dateRange({
                    dataStart: summary.dataStart,
                    dataThrough: summary.dataThrough,
                  })
                : "Dexcom history is available."}
            </Text>
            {summary.latestStoredAt ? (
              <Text style={[styles.meta, { color: colors.textTertiary }]}>
                Last imported {relativeAge(summary.latestStoredAt)}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}

      <View
        style={[
          styles.settingsPanel,
          {
            backgroundColor: colors.surfaceMuted,
            borderColor: colors.border,
            borderRadius: radius.md,
          },
        ]}
      >
        <Text style={[styles.settingsTitle, { color: colors.text }]}>
          Settings for this export
        </Text>
        <Text style={[styles.settingLabel, { color: colors.textSecondary }]}>
          DATE ORDER IN THE CSV
        </Text>
        <View
          accessibilityLabel="Dexcom Clarity export date order"
          accessibilityRole="radiogroup"
          style={styles.dateOrderOptions}
        >
          {DATE_ORDER_OPTIONS.map((option) => {
            const active = option.value === dateOrder;
            return (
              <Pressable
                accessibilityLabel={option.label}
                accessibilityRole="radio"
                accessibilityState={{
                  checked: active,
                  disabled: settingsLocked,
                }}
                disabled={settingsLocked}
                key={option.value}
                onPress={() => setDateOrder(option.value)}
                style={({ pressed }) => [
                  styles.dateOrderOption,
                  {
                    backgroundColor: active
                      ? `${colors.primary}1C`
                      : colors.surface,
                    borderColor: active ? colors.primary : colors.border,
                    borderRadius: radius.pill,
                    opacity: pressed || settingsLocked ? 0.66 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.dateOrderText,
                    {
                      color: active ? colors.primary : colors.textSecondary,
                    },
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[styles.settingLabel, { color: colors.textSecondary }]}>
          EXPORT TIME ZONE
        </Text>
        <TextInput
          accessibilityHint="Enter the IANA time zone used by dates and times in this Dexcom Clarity export."
          accessibilityLabel="Dexcom Clarity export time zone"
          accessibilityState={{ disabled: settingsLocked }}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!settingsLocked}
          onChangeText={setImportTimeZone}
          placeholder="America/New_York"
          placeholderTextColor={colors.textTertiary}
          style={[
            styles.timeZoneInput,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radius.md,
              color: colors.text,
              opacity: settingsLocked ? 0.72 : 1,
            },
          ]}
          value={importTimeZone}
        />
        <Text style={[styles.settingsHelp, { color: colors.textTertiary }]}>
          {prepared
            ? "These choices were used for this preview. Cancel the preview to change them."
            : "Started from your regional profile. Change either value when this Clarity account or export differs."}
        </Text>
      </View>

      {prepared ? (
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
          <View style={styles.previewHeading}>
            <Ionicons
              accessibilityElementsHidden
              color={colors.primary}
              name="document-text-outline"
              size={21}
            />
            <View style={styles.previewCopy}>
              <Text style={[styles.previewTitle, { color: colors.text }]}>
                {formatRegionalNumber(
                  prepared.preview.glucose.length,
                  regional.locale,
                )}{" "}
                glucose readings ready
              </Text>
              <Text style={[styles.body, { color: colors.textSecondary }]}>
                {dateRange(prepared.preview)}
              </Text>
              <Text style={[styles.previewMeta, { color: colors.textTertiary }]}>
                {dateOrderLabel(prepared.preview.regionalSettings.dateOrder)} ·{" "}
                {prepared.preview.regionalSettings.timeZone}
              </Text>
            </View>
          </View>
          {prepared.preview.warnings.map((warning) => (
            <Text
              key={warning}
              style={[styles.warning, { color: colors.warning }]}
            >
              {warning}
            </Text>
          ))}
          <View style={styles.actions}>
            <Pressable
              accessibilityLabel="Cancel Dexcom Clarity import"
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={discardPreview}
              style={({ pressed }) => [
                styles.secondaryButton,
                {
                  borderColor: colors.border,
                  borderRadius: radius.md,
                  opacity: pressed || busy ? 0.62 : 1,
                },
              ]}
            >
              <Text
                style={[styles.buttonText, { color: colors.textSecondary }]}
              >
                Cancel
              </Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Import Dexcom Clarity history privately"
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={() => void commitImport()}
              style={({ pressed }) => [
                styles.importButton,
                {
                  backgroundColor: colors.primary,
                  borderRadius: radius.md,
                  opacity: pressed || busy ? 0.68 : 1,
                },
              ]}
            >
              {state.kind === "importing" ? (
                <ActivityIndicator color={colors.onPrimary} size="small" />
              ) : (
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.onPrimary}
                  name="lock-closed-outline"
                  size={18}
                />
              )}
              <Text style={[styles.buttonText, { color: colors.onPrimary }]}>
                Import privately
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {state.kind === "success" ? (
        <View
          style={[
            styles.message,
            {
              backgroundColor: `${colors.accent}10`,
              borderColor: `${colors.accent}42`,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.accent}
            name="checkmark-circle"
            size={21}
          />
          <Text style={[styles.messageText, { color: colors.text }]}>
            {state.result.alreadyImported
              ? "This exact export was already stored. No readings were duplicated."
              : `${formatRegionalNumber(state.result.insertedGlucose, regional.locale)} glucose readings added to your timeline.`}
          </Text>
        </View>
      ) : null}

      {state.kind === "error" ? (
        <View
          style={[
            styles.message,
            {
              backgroundColor: `${colors.danger}0E`,
              borderColor: `${colors.danger}45`,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.danger}
            name="alert-circle-outline"
            size={21}
          />
          <Text style={[styles.messageText, { color: colors.text }]}>
            {state.message}
          </Text>
        </View>
      ) : null}

      {!prepared ? (
        <Pressable
          accessibilityLabel="Choose Dexcom Clarity CSV"
          accessibilityHint="Choose a file exported from Dexcom Clarity."
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() => void chooseExport()}
          style={({ pressed }) => [
            styles.chooseButton,
            {
              backgroundColor: colors.surfaceMuted,
              borderColor: colors.border,
              borderRadius: radius.md,
              opacity: pressed || busy ? 0.65 : 1,
            },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={colors.primary} size="small" />
          ) : (
            <Ionicons
              accessibilityElementsHidden
              color={colors.primary}
              name="folder-open-outline"
              size={20}
            />
          )}
          <Text style={[styles.chooseText, { color: colors.primary }]}>
            Choose Dexcom Clarity CSV
          </Text>
        </Pressable>
      ) : null}

      <Text style={[styles.footnote, { color: colors.textTertiary }]}>
        Clarity files add historical glucose only. They are not required for the
        Dexcom Share connection above and do not replace its current readings.
      </Text>

      {summary?.archiveCount ? (
        <Pressable
          accessibilityLabel="Remove imported Dexcom history"
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={confirmClear}
          style={({ pressed }) => [
            styles.removeButton,
            { opacity: pressed || busy ? 0.58 : 1 },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.danger}
            name="trash-outline"
            size={18}
          />
          <Text style={[styles.removeText, { color: colors.danger }]}>
            Remove imported Dexcom history
          </Text>
        </Pressable>
      ) : null}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", gap: 13, alignItems: "flex-start" },
  icon: {
    width: 46,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCopy: { flex: 1, gap: 5 },
  title: { fontSize: 18, lineHeight: 23, fontWeight: "800" },
  body: { fontSize: 14, lineHeight: 20 },
  statusPanel: {
    marginTop: 16,
    borderWidth: 1,
    padding: 13,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  statusCopy: { flex: 1, gap: 3 },
  statusTitle: { fontSize: 14, lineHeight: 19, fontWeight: "800" },
  statusBody: { fontSize: 13, lineHeight: 18 },
  meta: { fontSize: 12, lineHeight: 17 },
  settingsPanel: { marginTop: 16, borderWidth: 1, padding: 14 },
  settingsTitle: { fontSize: 14, lineHeight: 19, fontWeight: "800" },
  settingLabel: {
    fontSize: 10,
    lineHeight: 15,
    fontWeight: "800",
    marginTop: 12,
    marginBottom: 6,
  },
  dateOrderOptions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  dateOrderOption: {
    minHeight: 42,
    borderWidth: 1,
    justifyContent: "center",
    paddingHorizontal: 13,
  },
  dateOrderText: { fontSize: 11, lineHeight: 16, fontWeight: "800" },
  timeZoneInput: {
    minHeight: 50,
    borderWidth: 1,
    paddingHorizontal: 13,
    fontSize: 13,
  },
  settingsHelp: { fontSize: 10, lineHeight: 15, marginTop: 7 },
  preview: { marginTop: 16, borderWidth: 1, padding: 14, gap: 11 },
  previewHeading: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  previewCopy: { flex: 1, gap: 2 },
  previewTitle: { fontSize: 15, lineHeight: 20, fontWeight: "800" },
  previewMeta: { fontSize: 11, lineHeight: 16 },
  warning: { fontSize: 12, lineHeight: 17 },
  actions: { flexDirection: "row", gap: 9 },
  secondaryButton: {
    minHeight: 46,
    paddingHorizontal: 15,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  importButton: {
    minHeight: 46,
    paddingHorizontal: 16,
    flex: 1,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { fontSize: 14, fontWeight: "800" },
  message: {
    marginTop: 14,
    padding: 12,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
  },
  messageText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: "600" },
  chooseButton: {
    marginTop: 16,
    minHeight: 50,
    borderWidth: 1,
    flexDirection: "row",
    gap: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  chooseText: { fontSize: 14, fontWeight: "800" },
  footnote: { marginTop: 11, fontSize: 12, lineHeight: 17 },
  removeButton: {
    minHeight: 44,
    marginTop: 8,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  removeText: { fontSize: 13, fontWeight: "700" },
});
