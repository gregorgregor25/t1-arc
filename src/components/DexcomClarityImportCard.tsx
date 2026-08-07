import Ionicons from '@expo/vector-icons/Ionicons';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  PreparedDexcomClarityImport,
  prepareDexcomClarityImport,
} from '@/data/import/dexcomClarityImport';
import {
  ImportWriteResult,
  StoredImportSourceSummary,
} from '@/data/persistence/HealthRecordStore';
import {
  formatDate,
  relativeAge,
  toDateKey,
} from '@/domain/time';
import { useDataContext } from '@/providers/DataProvider';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';

type ImportState =
  | { kind: 'idle' }
  | { kind: 'preparing' }
  | { kind: 'preview'; prepared: PreparedDexcomClarityImport }
  | { kind: 'importing'; prepared: PreparedDexcomClarityImport }
  | {
      kind: 'success';
      preview: PreparedDexcomClarityImport['preview'];
      result: ImportWriteResult;
    }
  | { kind: 'error'; message: string };

function dateRange(
  preview: PreparedDexcomClarityImport['preview'],
) {
  if (
    preview.dataStart === undefined ||
    preview.dataThrough === undefined
  ) {
    return 'No glucose range found';
  }
  const options: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  };
  return `${formatDate(toDateKey(preview.dataStart), options)} – ${formatDate(
    toDateKey(preview.dataThrough),
    options,
  )}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DexcomClarityImportCard() {
  const { colors, radius } = useAppTheme();
  const {
    clearImportedDexcomData,
    getDexcomArchiveSummary,
    importDexcomData,
    revision,
  } = useDataContext();
  const [state, setState] = useState<ImportState>({ kind: 'idle' });
  const [summary, setSummary] = useState<StoredImportSourceSummary>();

  useEffect(() => {
    let active = true;
    void getDexcomArchiveSummary().then((next) => {
      if (active) setSummary(next);
    });
    return () => {
      active = false;
    };
  }, [getDexcomArchiveSummary, revision]);

  const busy = state.kind === 'preparing' || state.kind === 'importing';
  const prepared =
    state.kind === 'preview' || state.kind === 'importing'
      ? state.prepared
      : undefined;

  async function chooseExport() {
    setState({ kind: 'preparing' });
    let selectedBytes: Uint8Array | undefined;
    try {
      const selected = await DocumentPicker.getDocumentAsync({
        type: [
          'text/csv',
          'text/comma-separated-values',
          'application/csv',
          'application/octet-stream',
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (selected.canceled) {
        setState({ kind: 'idle' });
        return;
      }
      const asset = selected.assets[0];
      if (!asset) throw new Error('No Dexcom export was selected.');
      const cached = new File(asset.uri);
      try {
        const bytes = await cached.bytes();
        selectedBytes = bytes;
        setState({
          kind: 'preview',
          prepared: await prepareDexcomClarityImport(asset.name, bytes),
        });
        selectedBytes = undefined;
      } finally {
        try {
          if (cached.exists) cached.delete();
        } catch {
          // Android may already have released its temporary picker copy.
        }
      }
    } catch (error) {
      selectedBytes?.fill(0);
      setState({
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'The Dexcom export could not be read.',
      });
    }
  }

  async function commitImport() {
    if (!prepared) return;
    setState({ kind: 'importing', prepared });
    try {
      const result = await importDexcomData(prepared);
      prepared.sourcePayload.bytes.fill(0);
      setState({ kind: 'success', preview: prepared.preview, result });
      setSummary(await getDexcomArchiveSummary());
    } catch (error) {
      prepared.sourcePayload.bytes.fill(0);
      setState({
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'The encrypted Dexcom import did not complete.',
      });
    }
  }

  function discardPreview() {
    prepared?.sourcePayload.bytes.fill(0);
    setState({ kind: 'idle' });
  }

  function confirmClear() {
    Alert.alert(
      'Remove imported Dexcom history?',
      'This removes the normalised readings and retained encrypted Clarity CSV copies from this phone. Other glucose sources are not changed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setState({ kind: 'preparing' });
              try {
                await clearImportedDexcomData();
                setSummary(undefined);
                setState({ kind: 'idle' });
              } catch (error) {
                setState({
                  kind: 'error',
                  message:
                    error instanceof Error
                      ? error.message
                      : 'Dexcom history could not be removed.',
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
            Import the raw CSV you control. T1 Arc normalises glucose locally
            and keeps the original file encrypted on this phone.
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
              Encrypted history retained
            </Text>
            <Text style={[styles.statusBody, { color: colors.textSecondary }]}>
              {summary.archiveCount}{' '}
              {summary.archiveCount === 1 ? 'export' : 'exports'} ·{' '}
              {formatBytes(summary.totalBytes)}
              {summary.dataStart !== undefined &&
              summary.dataThrough !== undefined
                ? ` · ${dateRange({
                    glucose: [],
                    warnings: [],
                    skippedRows: 0,
                    duplicateRows: 0,
                    dataStart: summary.dataStart,
                    dataThrough: summary.dataThrough,
                  })}`
                : ''}
            </Text>
            {summary.latestStoredAt ? (
              <Text style={[styles.meta, { color: colors.textTertiary }]}>
                Last imported {relativeAge(summary.latestStoredAt)}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}

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
                {prepared.preview.glucose.length.toLocaleString('en-GB')}{' '}
                glucose readings ready
              </Text>
              <Text style={[styles.body, { color: colors.textSecondary }]}>
                {dateRange(prepared.preview)}
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
              accessibilityRole="button"
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
              <Text style={[styles.buttonText, { color: colors.textSecondary }]}>
                Cancel
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
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
              {state.kind === 'importing' ? (
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

      {state.kind === 'success' ? (
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
              ? 'This exact export was already stored. No readings were duplicated.'
              : `${state.result.insertedGlucose.toLocaleString('en-GB')} glucose readings added to your timeline.`}
          </Text>
        </View>
      ) : null}

      {state.kind === 'error' ? (
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
          accessibilityHint="Choose the raw CSV exported from Dexcom Clarity."
          accessibilityRole="button"
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
        This adds historical glucose, not a live Dexcom connection. A future
        official account connection requires Dexcom partner approval and a
        secure token service.
      </Text>

      {summary?.archiveCount ? (
        <Pressable
          accessibilityRole="button"
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
  header: { flexDirection: 'row', gap: 13, alignItems: 'flex-start' },
  icon: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: { flex: 1, gap: 5 },
  title: { fontSize: 18, lineHeight: 23, fontWeight: '800' },
  body: { fontSize: 14, lineHeight: 20 },
  statusPanel: {
    marginTop: 16,
    borderWidth: 1,
    padding: 13,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  statusCopy: { flex: 1, gap: 3 },
  statusTitle: { fontSize: 14, lineHeight: 19, fontWeight: '800' },
  statusBody: { fontSize: 13, lineHeight: 18 },
  meta: { fontSize: 12, lineHeight: 17 },
  preview: { marginTop: 16, borderWidth: 1, padding: 14, gap: 11 },
  previewHeading: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  previewCopy: { flex: 1, gap: 2 },
  previewTitle: { fontSize: 15, lineHeight: 20, fontWeight: '800' },
  warning: { fontSize: 12, lineHeight: 17 },
  actions: { flexDirection: 'row', gap: 9 },
  secondaryButton: {
    minHeight: 46,
    paddingHorizontal: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  importButton: {
    minHeight: 46,
    paddingHorizontal: 16,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 14, fontWeight: '800' },
  message: {
    marginTop: 14,
    padding: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  messageText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  chooseButton: {
    marginTop: 16,
    minHeight: 50,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  chooseText: { fontSize: 14, fontWeight: '800' },
  footnote: { marginTop: 11, fontSize: 12, lineHeight: 17 },
  removeButton: {
    minHeight: 44,
    marginTop: 8,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: { fontSize: 13, fontWeight: '700' },
});
