import Ionicons from '@expo/vector-icons/Ionicons';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useRef, useState } from 'react';
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
} from 'react-native';

import DaymarkBackupCrypto from '../../modules/daymark-backup-crypto';
import {
  createHealthBackupFile,
  HEALTH_BACKUP_MIME,
  PreparedHealthBackupRestore,
  healthBackupFileName,
  isFilePickerCancellation,
  mergePreparedHealthBackup,
  readHealthBackupFile,
} from '@/data/backup/healthBackup';
import { formatDate, formatTime, toDateKey } from '@/domain/time';
import { useGlucoseAppearance } from '@/providers/GlucoseAppearanceProvider';
import { useAppTheme } from '@/theme/theme';

import { SectionCard } from './SectionCard';

type BusyState = 'idle' | 'exporting' | 'unlocking' | 'restoring';
type PassphraseMode = 'export' | 'restore';

interface SelectedBackup {
  name: string;
  uri: string;
}

interface Props {
  onDataChanged?(): Promise<void> | void;
}

function formatCount(value: number) {
  return new Intl.NumberFormat('en-GB').format(value);
}

export function EncryptedBackupCard({ onDataChanged }: Props) {
  const { colors, radius } = useAppTheme();
  const { reload: reloadGlucoseAppearance } = useGlucoseAppearance();
  const [busy, setBusy] = useState<BusyState>('idle');
  const [workingLabel, setWorkingLabel] = useState('');
  const [message, setMessage] = useState<
    { tone: 'success' | 'error'; text: string } | undefined
  >();
  const [passphraseMode, setPassphraseMode] =
    useState<PassphraseMode | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [passphraseVisible, setPassphraseVisible] = useState(false);
  const [passphraseError, setPassphraseError] = useState<string>();
  const [selectedBackup, setSelectedBackup] = useState<SelectedBackup>();
  const [preview, setPreview] = useState<PreparedHealthBackupRestore>();
  const previewRef = useRef<PreparedHealthBackupRestore | undefined>(
    undefined,
  );
  const confirmationInputRef = useRef<TextInput | null>(null);

  function clearPassphraseFields() {
    setPassphrase('');
    setConfirmation('');
    setPassphraseVisible(false);
    setPassphraseError(undefined);
  }

  function closePassphraseModal() {
    setPassphraseMode(null);
    clearPassphraseFields();
    if (!preview) setSelectedBackup(undefined);
  }

  function beginExport() {
    setMessage(undefined);
    setPassphraseMode('export');
    clearPassphraseFields();
  }

  async function beginRestore() {
    setMessage(undefined);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          HEALTH_BACKUP_MIME,
          'application/vnd.daymark.health-backup',
          'application/octet-stream',
          'application/zip',
          '*/*',
        ],
        copyToCacheDirectory: false,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      setSelectedBackup({ name: asset.name, uri: asset.uri });
      setPassphraseMode('restore');
      clearPassphraseFields();
    } catch (error) {
      setMessage({
        tone: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'A backup file could not be selected.',
      });
    }
  }

  async function saveEncryptedBackup(secret: string) {
    setBusy('exporting');
    setWorkingLabel('Preparing your encrypted backup…');
    setMessage(undefined);
    let plaintextUri: string | undefined;
    let encryptedUri: string | undefined;
    try {
      const prepared = await createHealthBackupFile();
      plaintextUri = prepared.file.uri;
      setWorkingLabel('Compressing and encrypting with your passphrase…');
      const encrypted = await DaymarkBackupCrypto.encryptJsonFileAsync(
        plaintextUri,
        secret,
      );
      encryptedUri = encrypted.uri;
      const fileName = healthBackupFileName(prepared.summary.createdAt);
      setWorkingLabel('Choose where to save the encrypted file…');
      const saved = await DaymarkBackupCrypto.saveTemporaryFileAsync(
        encrypted.uri,
        fileName,
        HEALTH_BACKUP_MIME,
      );
      if (saved.status === 'cancelled') return;
      setMessage({
        tone: 'success',
        text: `Complete encrypted backup saved as ${fileName}. It contains ${formatCount(
          prepared.summary.totalRecords,
        )} stored rows${
          prepared.summary.preferencesIncluded
            ? ' plus your portable preferences'
            : ''
        }.`,
      });
    } catch (error) {
      if (!isFilePickerCancellation(error)) {
        setMessage({
          tone: 'error',
          text:
            error instanceof Error
              ? error.message
              : 'The encrypted backup could not be saved.',
        });
      }
    } finally {
      if (plaintextUri) {
        const file = new File(plaintextUri);
        if (file.exists) {
          try {
            file.delete();
          } catch {
            // The cache sweeper is a final fallback for interrupted cleanup.
          }
        }
      }
      if (encryptedUri) {
        await DaymarkBackupCrypto.removeTemporaryFileAsync(encryptedUri).catch(
          () => false,
        );
      }
      setBusy('idle');
      setWorkingLabel('');
    }
  }

  async function unlockBackup(secret: string, selected: SelectedBackup) {
    setBusy('unlocking');
    setWorkingLabel('Unlocking and checking the backup…');
    setMessage(undefined);
    let decryptedUri: string | undefined;
    try {
      const decrypted = await DaymarkBackupCrypto.decryptJsonFileAsync(
        selected.uri,
        secret,
      );
      decryptedUri = decrypted.uri;
      const prepared = await readHealthBackupFile(decrypted.uri);
      if (prepared.kind === 'stream') {
        // The merge reads the validated container directly from this private
        // temporary file, so keep it until the user commits or cancels.
        decryptedUri = undefined;
      }
      previewRef.current = prepared;
      setPreview(prepared);
    } catch (error) {
      setPassphraseMode('restore');
      setSelectedBackup(selected);
      setPassphraseError(
        error instanceof Error
          ? error.message
          : 'The backup could not be unlocked.',
      );
    } finally {
      if (decryptedUri) {
        await DaymarkBackupCrypto.removeTemporaryFileAsync(decryptedUri).catch(
          () => false,
        );
      }
      setBusy('idle');
      setWorkingLabel('');
    }
  }

  function submitPassphrase() {
    const secret = passphrase;
    if (secret.length < 12) {
      setPassphraseError('Use at least 12 characters.');
      return;
    }
    if (passphraseMode === 'export' && secret !== confirmation) {
      setPassphraseError('The two passphrases do not match.');
      return;
    }
    const mode = passphraseMode;
    const selected = selectedBackup;
    setPassphraseMode(null);
    clearPassphraseFields();
    if (mode === 'export') {
      void saveEncryptedBackup(secret);
    } else if (mode === 'restore' && selected) {
      void unlockBackup(secret, selected);
    }
  }

  async function commitRestore() {
    const document = previewRef.current;
    if (!document) return;
    setBusy('restoring');
    setWorkingLabel('Merging records without deleting local data…');
    setMessage(undefined);
    try {
      const result = await mergePreparedHealthBackup(document);
      if (result.preferenceRestore === 'restored') {
        await reloadGlucoseAppearance();
      }
      await onDataChanged?.();
      const preferenceText =
        result.preferenceRestore === 'restored'
          ? ' Display, review and inactive alert preferences were restored.'
          : result.preferenceRestore === 'failed'
            ? ` Health records were restored, but preferences were not: ${
                result.preferenceWarning ?? 'the preference restore failed'
              }.`
            : '';
      setMessage({
        tone: result.preferenceRestore === 'failed' ? 'error' : 'success',
        text: result.inserted
          ? `${formatCount(result.inserted)} stored rows restored; ${formatCount(result.duplicates)} already existed.${preferenceText}`
          : result.preferenceRestore === 'restored'
            ? `All ${formatCount(result.duplicates)} stored rows already existed.${preferenceText}`
            : `Nothing changed; all ${formatCount(result.duplicates)} stored rows were already on this phone.${preferenceText}`,
      });
      if (document.kind === 'stream') {
        await DaymarkBackupCrypto.removeTemporaryFileAsync(
          document.sourceUri,
        ).catch(() => false);
      }
      previewRef.current = undefined;
      setPreview(undefined);
      setSelectedBackup(undefined);
    } catch (error) {
      setMessage({
        tone: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'The backup could not be merged into this phone.',
      });
    } finally {
      setBusy('idle');
      setWorkingLabel('');
    }
  }

  function cancelRestore() {
    const prepared = previewRef.current;
    if (prepared?.kind === 'stream') {
      void DaymarkBackupCrypto.removeTemporaryFileAsync(
        prepared.sourceUri,
      ).catch(() => false);
    }
    previewRef.current = undefined;
    setPreview(undefined);
    setSelectedBackup(undefined);
  }

  const working = busy !== 'idle';

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
              name="key-outline"
              size={23}
            />
          </View>
          <View style={styles.headerCopy}>
            <Text style={[styles.title, { color: colors.text }]}>
              Your encrypted backup
            </Text>
            <Text style={[styles.body, { color: colors.textSecondary }]}>
              Save a portable copy you control. Health history, saved reviews,
              retained source evidence, and non-secret display, review and
              alert preferences are compressed, then protected with your
              passphrase before leaving the app.
            </Text>
          </View>
        </View>

        <View
          style={[
            styles.privacyNote,
            {
              backgroundColor: colors.surfaceMuted,
              borderRadius: radius.md,
            },
          ]}
        >
          <Ionicons
            accessibilityElementsHidden
            color={colors.accent}
            name="shield-checkmark-outline"
            size={18}
          />
          <Text style={[styles.privacyText, { color: colors.textSecondary }]}>
            Your saved sign-ins are never included. Keep the backup passphrase
            safe because it cannot be recovered if you forget it.
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

        {preview ? (
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
              <View style={styles.previewCopy}>
                <Text style={[styles.previewTitle, { color: colors.text }]}>
                  Ready to restore
                </Text>
                <Text style={[styles.previewMeta, { color: colors.textSecondary }]}>
                  {selectedBackup?.name ?? 'Encrypted backup'} ·{' '}
                  {formatDate(toDateKey(preview.manifest.createdAt), {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}{' '}
                  at {formatTime(preview.manifest.createdAt)}
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
              <BackupMetric
                label="Glucose"
                value={preview.manifest.counts.glucose_readings}
              />
              <BackupMetric
                label="Insulin"
                value={
                  preview.manifest.counts.insulin_basal +
                  preview.manifest.counts.insulin_bolus
                }
              />
              <BackupMetric
                label="Food"
                value={preview.manifest.counts.food_logs}
              />
              <BackupMetric
                label="Recipes"
                value={preview.manifest.counts.food_recipes}
              />
              <BackupMetric
                label="Context"
                value={
                  preview.manifest.counts.context_events +
                  preview.manifest.counts.context_notes
                }
              />
              <BackupMetric
                label="Source files"
                value={preview.manifest.counts.import_source_payloads}
              />
              <BackupMetric
                label="Source events"
                value={preview.manifest.counts.notification_source_events}
              />
              <BackupMetric
                label="Reviews"
                value={preview.manifest.counts.insight_reports}
              />
              <BackupMetric
                label="Preferences"
                value={preview.manifest.preferences ? 'Included' : 'Not included'}
              />
              <BackupMetric
                label="Stored rows"
                value={preview.manifest.totalRecords}
              />
            </View>
            <Text style={[styles.mergeNote, { color: colors.textSecondary }]}>
              Restore only adds missing records. It does not erase or replace
              newer data already on this phone. Included display, review and
              alert-threshold preferences replace their matching settings;
              restored alerts stay off, and sign-ins, Android permissions, and
              active services never transfer.
            </Text>
            <View style={styles.previewActions}>
              <Pressable
                accessibilityRole="button"
                disabled={working}
                onPress={() => void commitRestore()}
                style={({ pressed }) => [
                  styles.restoreButton,
                  {
                    backgroundColor: colors.primary,
                    borderRadius: radius.md,
                  },
                  pressed && { opacity: 0.76 },
                ]}
              >
                <Text
                  style={[styles.primaryButtonText, { color: colors.onPrimary }]}
                >
                  Merge this backup
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={cancelRestore}
                style={({ pressed }) => [
                  styles.cancelButton,
                  pressed && { opacity: 0.58 },
                ]}
              >
                <Text style={[styles.secondaryText, { color: colors.textSecondary }]}>
                  Cancel
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {message ? (
          <View
            accessibilityLiveRegion={message.tone === 'error' ? 'assertive' : 'polite'}
            style={[
              styles.message,
              {
                backgroundColor:
                  message.tone === 'error'
                    ? `${colors.danger}10`
                    : `${colors.accent}12`,
                borderColor:
                  message.tone === 'error'
                    ? `${colors.danger}55`
                    : `${colors.accent}55`,
                borderRadius: radius.md,
              },
            ]}
          >
            <Ionicons
              accessibilityElementsHidden
              color={message.tone === 'error' ? colors.danger : colors.accent}
              name={
                message.tone === 'error'
                  ? 'alert-circle-outline'
                  : 'checkmark-circle-outline'
              }
              size={21}
            />
            <Text style={[styles.messageText, { color: colors.textSecondary }]}>
              {message.text}
            </Text>
          </View>
        ) : null}

        {!preview ? (
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              disabled={working}
              onPress={beginExport}
              style={({ pressed }) => [
                styles.primaryButton,
                {
                  backgroundColor: working
                    ? colors.surfaceMuted
                    : colors.primary,
                  borderRadius: radius.md,
                },
                pressed && !working && { opacity: 0.76 },
              ]}
            >
              <Ionicons
                accessibilityElementsHidden
                color={working ? colors.textTertiary : colors.onPrimary}
                name="download-outline"
                size={20}
              />
              <Text
                style={[
                  styles.primaryButtonText,
                  {
                    color: working
                      ? colors.textTertiary
                      : colors.onPrimary,
                  },
                ]}
              >
                Create encrypted backup
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={working}
              onPress={() => void beginRestore()}
              style={({ pressed }) => [
                styles.secondaryButton,
                {
                  borderColor: colors.border,
                  borderRadius: radius.md,
                },
                pressed && !working && { backgroundColor: colors.surfaceMuted },
              ]}
            >
              <Ionicons
                accessibilityElementsHidden
                color={working ? colors.textTertiary : colors.primary}
                name="push-outline"
                size={19}
              />
              <Text
                style={[
                  styles.secondaryText,
                  { color: working ? colors.textTertiary : colors.primary },
                ]}
              >
                Restore from backup
              </Text>
            </Pressable>
          </View>
        ) : null}
      </SectionCard>

      <Modal
        animationType="fade"
        onRequestClose={() => {
          if (Keyboard.isVisible()) {
            Keyboard.dismiss();
            return;
          }
          closePassphraseModal();
        }}
        statusBarTranslucent
        transparent
        visible={passphraseMode !== null}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'android' ? 16 : 0}
          style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}
        >
          <View
            accessibilityViewIsModal
            style={[
              styles.modalCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radius.xl,
              },
            ]}
          >
            <View style={styles.modalHeader}>
              <View>
                <Text style={[styles.modalEyebrow, { color: colors.accent }]}>
                  {passphraseMode === 'export'
                    ? 'PRIVATE BACKUP'
                    : 'UNLOCK BACKUP'}
                </Text>
                <Text style={[styles.modalTitle, { color: colors.text }]}>
                  {passphraseMode === 'export'
                    ? 'Choose a passphrase'
                    : 'Enter the passphrase'}
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Close passphrase"
                accessibilityRole="button"
                hitSlop={8}
                onPress={closePassphraseModal}
                style={({ pressed }) => [
                  styles.closeButton,
                  pressed && { opacity: 0.55 },
                ]}
              >
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.textSecondary}
                  name="close"
                  size={24}
                />
              </Pressable>
            </View>

            <Text style={[styles.modalBody, { color: colors.textSecondary }]}>
              {passphraseMode === 'export'
                ? 'Use at least 12 characters. It is never stored by the app and cannot be recovered.'
                : selectedBackup?.name ?? 'Selected encrypted health backup'}
            </Text>

            <View
              style={[
                styles.passwordRow,
                {
                  backgroundColor: colors.surfaceMuted,
                  borderColor: passphraseError ? colors.danger : colors.border,
                  borderRadius: radius.md,
                },
              ]}
            >
              <TextInput
                accessibilityLabel="Backup passphrase"
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                onChangeText={(value) => {
                  setPassphrase(value);
                  setPassphraseError(undefined);
                }}
                onSubmitEditing={
                  passphraseMode === 'restore'
                    ? submitPassphrase
                    : () => confirmationInputRef.current?.focus()
                }
                placeholder="Backup passphrase"
                placeholderTextColor={colors.textTertiary}
                returnKeyType={passphraseMode === 'restore' ? 'done' : 'next'}
                secureTextEntry={!passphraseVisible}
                style={[styles.passwordInput, { color: colors.text }]}
                value={passphrase}
              />
              <Pressable
                accessibilityLabel={
                  passphraseVisible ? 'Hide passphrase' : 'Show passphrase'
                }
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => setPassphraseVisible((visible) => !visible)}
                style={styles.eyeButton}
              >
                <Ionicons
                  accessibilityElementsHidden
                  color={colors.textSecondary}
                  name={passphraseVisible ? 'eye-off-outline' : 'eye-outline'}
                  size={22}
                />
              </Pressable>
            </View>

            {passphraseMode === 'export' ? (
              <TextInput
                ref={confirmationInputRef}
                accessibilityLabel="Confirm backup passphrase"
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={(value) => {
                  setConfirmation(value);
                  setPassphraseError(undefined);
                }}
                onSubmitEditing={submitPassphrase}
                placeholder="Repeat passphrase"
                placeholderTextColor={colors.textTertiary}
                returnKeyType="done"
                secureTextEntry={!passphraseVisible}
                style={[
                  styles.confirmInput,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderColor: passphraseError ? colors.danger : colors.border,
                    borderRadius: radius.md,
                    color: colors.text,
                  },
                ]}
                value={confirmation}
              />
            ) : null}

            {passphraseError ? (
              <Text
                accessibilityLiveRegion="assertive"
                style={[styles.passphraseError, { color: colors.danger }]}
              >
                {passphraseError}
              </Text>
            ) : null}

            <Pressable
              accessibilityRole="button"
              onPress={submitPassphrase}
              style={({ pressed }) => [
                styles.modalSubmit,
                {
                  backgroundColor: colors.primary,
                  borderRadius: radius.md,
                },
                pressed && { opacity: 0.76 },
              ]}
            >
              <Ionicons
                accessibilityElementsHidden
                color={colors.onPrimary}
                name={
                  passphraseMode === 'export'
                    ? 'lock-closed-outline'
                    : 'key-outline'
                }
                size={20}
              />
              <Text
                style={[styles.primaryButtonText, { color: colors.onPrimary }]}
              >
                {passphraseMode === 'export'
                  ? 'Choose where to save'
                  : 'Unlock and inspect'}
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

function BackupMetric({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricValue, { color: colors.text }]}>
        {typeof value === 'number' ? formatCount(value) : value}
      </Text>
      <Text style={[styles.metricLabel, { color: colors.textTertiary }]}>
        {label}
      </Text>
    </View>
  );
}


const styles = StyleSheet.create({
  card: {
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    gap: 13,
  },
  icon: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    flex: 1,
  },
  title: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '800',
  },
  body: {
    fontSize: 13,
    lineHeight: 20,
    marginTop: 4,
  },
  privacyNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    padding: 13,
  },
  privacyText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 17,
  },
  progress: {
    minHeight: 58,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  progressText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  actions: {
    gap: 10,
  },
  primaryButton: {
    minHeight: 52,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  primaryButtonText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
  },
  secondaryButton: {
    minHeight: 50,
    borderWidth: 1,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondaryText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  message: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  messageText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  preview: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 13,
  },
  previewHeading: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  previewCopy: {
    flex: 1,
  },
  previewTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  previewMeta: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
  },
  metrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metric: {
    minWidth: '22%',
    flexGrow: 1,
  },
  metricValue: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '800',
  },
  metricLabel: {
    fontSize: 9,
    lineHeight: 13,
    textTransform: 'uppercase',
    letterSpacing: 0.55,
    fontWeight: '700',
  },
  mergeNote: {
    fontSize: 11,
    lineHeight: 17,
  },
  previewActions: {
    gap: 4,
  },
  restoreButton: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: 16,
  },
  modalCard: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
    paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  modalEyebrow: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  modalTitle: {
    fontSize: 22,
    lineHeight: 29,
    fontWeight: '800',
    marginTop: 3,
  },
  closeButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBody: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10,
    marginBottom: 16,
  },
  passwordRow: {
    minHeight: 52,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  passwordInput: {
    minHeight: 50,
    flex: 1,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  eyeButton: {
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmInput: {
    minHeight: 52,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 16,
    marginTop: 10,
  },
  passphraseError: {
    fontSize: 11,
    lineHeight: 17,
    fontWeight: '600',
    marginTop: 8,
  },
  modalSubmit: {
    minHeight: 52,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    marginTop: 16,
  },
});
