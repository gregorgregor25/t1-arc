import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import {
  createBackupPreviewArtifactCleaner,
  describeCommittedBackupRestore,
  describeEncryptedBackupError,
  describePortablePreferenceGroups,
} from "@/components/EncryptedBackupCard";
import { runBackupPostCommitRefreshes } from "@/data/backup/postCommitRefreshes";
import { DEFAULT_GLUCOSE_APPEARANCE } from "@/domain/glucoseAppearance";
import { validatePortablePreferences } from "@/domain/portablePreferences";

vi.mock("@expo/vector-icons/Ionicons", () => ({
  default: Object.assign(() => null, { glyphMap: {} }),
}));
vi.mock("expo-document-picker", () => ({}));
vi.mock("expo-file-system", () => ({ File: class {} }));
vi.mock("react-native", () => ({
  ActivityIndicator: () => null,
  Keyboard: { dismiss: vi.fn(), isVisible: () => false },
  KeyboardAvoidingView: () => null,
  Modal: () => null,
  Platform: { OS: "android" },
  Pressable: () => null,
  StyleSheet: { create: <T>(styles: T) => styles, hairlineWidth: 1 },
  Text: () => null,
  TextInput: () => null,
  View: () => null,
}));
vi.mock("../modules/t1arc-backup-crypto", () => ({
  default: { removeTemporaryFileAsync: vi.fn() },
}));
vi.mock("@/data/backup/healthBackup", () => ({
  createHealthBackupFile: vi.fn(),
  HEALTH_BACKUP_MIME: "application/vnd.t1arc.health-backup",
  healthBackupFileName: vi.fn(),
  isFilePickerCancellation: vi.fn(),
  mergePreparedHealthBackup: vi.fn(),
  readHealthBackupFile: vi.fn(),
}));
vi.mock("@/data/backup/backupStatus", () => ({
  recordSuccessfulBackupExport: vi.fn(),
}));
vi.mock("@/components/BackupCarePanel", () => ({ BackupCarePanel: () => null }));
vi.mock("@/domain/time", () => ({
  formatDate: vi.fn(),
  formatTime: vi.fn(),
  toDateKey: vi.fn(),
}));
vi.mock("@/providers/GlucoseAppearanceProvider", () => ({
  useGlucoseAppearance: () => ({ reload: vi.fn() }),
}));
vi.mock("@/theme/theme", () => ({ useAppTheme: vi.fn() }));
vi.mock("@/components/SectionCard", () => ({ SectionCard: () => null }));

function preferencePayload(version: 1 | 2 | 3 | 4) {
  return validatePortablePreferences({
    version,
    glucoseAppearance: DEFAULT_GLUCOSE_APPEARANCE,
    glanceableDisplay: {
      lockScreenVisible: false,
      aodPosition: "topRight",
      aodSize: "large",
    },
    insightReviews: { weeklyNotificationEnabled: true },
    ...(version >= 2
      ? {
          glucoseAlerts: {
            lowEnabled: true,
            lowThresholdMmolL: 3.7,
            highEnabled: true,
            highThresholdMmolL: 14,
            staleEnabled: true,
            repeatMinutes: 60,
          },
        }
      : {}),
    ...(version >= 3
      ? { themeMode: "dark", healthGoals: { dailyStepGoal: 8_500 } }
      : {}),
    ...(version >= 4 ? { treatmentProfile: null } : {}),
    ...(version >= 5
      ? {
          regionalProfile: {
            schemaVersion: 2,
            region: 'automatic',
            countryCode: 'automatic',
            languageTag: 'automatic',
            analysisTimeZone: 'automatic',
            followDeviceTimeZone: true,
            glucoseUnit: 'automatic',
            measurementSystem: 'automatic',
            energyUnit: 'automatic',
            clinicalJurisdiction: 'automatic',
          },
        }
      : {}),
  });
}

describe("encrypted backup preview cleanup", () => {
  it("does not offer provider sign-in passwords as backup passphrases", () => {
    const source = readFileSync("src/components/EncryptedBackupCard.tsx", "utf8");
    const inputs = source.match(/<TextInput[\s\S]*?\/>/g) ?? [];
    const passphrases = inputs.filter((input) => /accessibilityLabel="(?:Confirm b|B)ackup passphrase"/.test(input));
    expect(passphrases).toHaveLength(2);
    for (const input of passphrases) {
      expect(input).toContain('autoComplete="off"');
      expect(input).toContain('importantForAutofill="no"');
      expect(input).toContain('secureTextEntry={!passphraseVisible}');
    }
  });

  it("releases each retained decrypted artifact at most once", async () => {
    const remove = vi.fn(async () => true);
    const cleaner = createBackupPreviewArtifactCleaner(remove);
    const preview = {
      kind: "stream" as const,
      manifest: {} as never,
      sourceVersion: 16,
      sourceUri: "file:///private/decrypted-backup.json",
    };

    const first = cleaner.release(preview);
    const concurrent = cleaner.release(preview);

    expect(concurrent).toBe(first);
    await expect(first).resolves.toBe(true);
    await expect(cleaner.release(preview)).resolves.toBe(true);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(preview.sourceUri);
  });

  it("does not try to remove an in-memory legacy preview", async () => {
    const remove = vi.fn(async () => true);
    const cleaner = createBackupPreviewArtifactCleaner(remove);

    await expect(
      cleaner.release({
        kind: "legacy",
        manifest: {} as never,
        document: {} as never,
      }),
    ).resolves.toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it("makes cleanup best-effort without scheduling a double-delete retry", async () => {
    const remove = vi.fn(async () => {
      throw new Error("already gone");
    });
    const cleaner = createBackupPreviewArtifactCleaner(remove);
    const preview = {
      kind: "stream" as const,
      manifest: {} as never,
      sourceVersion: 16,
      sourceUri: "file:///private/interrupted-preview.json",
    };

    await expect(cleaner.release(preview)).resolves.toBe(false);
    await expect(cleaner.release(preview)).resolves.toBe(false);
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe("encrypted backup error boundary", () => {
  it("never exposes native bridge, Java or private-path details", () => {
    const nativeUnlock = new Error(
      "Call to function 'T1ArcBackupCrypto.decryptJsonFileAsync' has been rejected.\n" +
        "→ Caused by: java.lang.IllegalArgumentException: The health backup could not be unlocked. Check the passphrase and file.",
    );

    expect(describeEncryptedBackupError(nativeUnlock, "unlock")).toBe(
      "The backup could not be unlocked. Check the passphrase and file.",
    );
    expect(
      describeEncryptedBackupError(
        new Error("Invalid backup frame at /data/user/0/private/container.json"),
        "unlock",
      ),
    ).toBe(
      "The backup could not be validated. It may be damaged or incompatible with this version of T1 Arc.",
    );
    expect(
      describeEncryptedBackupError(
        new Error("SecurityException: /data/user/0/private/cache"),
        "selection",
      ),
    ).toBe("A backup file could not be selected. Try again.");
    expect(
      describeEncryptedBackupError(
        new Error("SQLiteException: /data/user/0/private/database"),
        "restore",
      ),
    ).toBe(
      "The validated backup could not be merged. No existing data was removed.",
    );
  });

  it("describes export failure without claiming plaintext was retained", () => {
    expect(
      describeEncryptedBackupError(
        new Error("Native encryptJsonFileAsync failed"),
        "export",
      ),
    ).toBe(
      "The encrypted backup could not be created. No unencrypted backup was left behind.",
    );
  });
});

describe("committed encrypted backup restore reporting", () => {
  const result = {
    attempted: 5,
    inserted: 3,
    duplicates: 2,
    byTable: {},
    preferenceRestore: "restored" as const,
  };

  it("keeps running refresh callbacks and reports a post-commit warning", async () => {
    const appearance = vi.fn(async () => {
      throw new Error("provider refresh failed");
    });
    const data = vi.fn(async () => undefined);

    await expect(
      runBackupPostCommitRefreshes([appearance, data]),
    ).resolves.toBe(true);
    expect(appearance).toHaveBeenCalledOnce();
    expect(data).toHaveBeenCalledOnce();

    const message = describeCommittedBackupRestore(result as never, true);
    expect(message.tone).toBe("warning");
    expect(message.text).toContain("3 stored rows restored");
    expect(message.text).toContain("safely on this phone");
    expect(message.text).toContain("Reopen T1 Arc");
  });

  it("reports a completed merge as success when refreshes finish", () => {
    expect(
      describeCommittedBackupRestore(
        result as never,
        false,
        preferencePayload(3),
      ),
    ).toMatchObject({
      tone: "success",
      text: expect.stringContaining("theme"),
    });
  });

  it("reports only the preference groups present in legacy backups", () => {
    const version1 = preferencePayload(1);
    const version2 = preferencePayload(2);

    expect(describePortablePreferenceGroups(version1)).toEqual([
      "glucose appearance",
      "glanceable display",
      "review reminders",
    ]);
    expect(describePortablePreferenceGroups(version2)).toEqual([
      "glucose appearance",
      "glanceable display",
      "review reminders",
      "inactive alerts",
    ]);

    const firstMessage = describeCommittedBackupRestore(
      result as never,
      false,
      version1,
    ).text;
    expect(firstMessage).not.toMatch(/theme|health goal|alerts/i);

    const secondMessage = describeCommittedBackupRestore(
      result as never,
      false,
      version2,
    ).text;
    expect(secondMessage).toContain("inactive alerts");
    expect(secondMessage).not.toMatch(/theme|health goal/i);
  });

  it("reports failed preference restoration as partial, not wholesale failure", () => {
    const message = describeCommittedBackupRestore({
      ...result,
      preferenceRestore: "failed",
      preferenceWarning: "Secure storage was unavailable",
    } as never);

    expect(message.tone).toBe("warning");
    expect(message.text).toContain("3 stored rows restored");
    expect(message.text).toContain("Some preferences could not be restored");
  });
});
