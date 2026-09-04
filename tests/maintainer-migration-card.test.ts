import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  createMigrationArtifactCleaner,
  describeMaintainerMigrationError,
  describeMaintainerMigrationImport,
  validateMaintainerMigrationSelection,
} from "@/components/MaintainerMigrationCard";

vi.mock("@expo/vector-icons/Ionicons", () => ({
  default: Object.assign(() => null, { glyphMap: {} }),
}));
vi.mock("expo-document-picker", () => ({}));
vi.mock("react-native", () => ({
  ActivityIndicator: () => null,
  Keyboard: { dismiss: vi.fn() },
  KeyboardAvoidingView: () => null,
  Modal: () => null,
  Platform: { OS: "android" },
  Pressable: () => null,
  StyleSheet: {
    absoluteFill: {},
    create: <T>(styles: T) => styles,
    hairlineWidth: 1,
  },
  Text: () => null,
  TextInput: () => null,
  View: () => null,
}));
vi.mock("../modules/t1arc-backup-crypto", () => ({
  default: { removeTemporaryFileAsync: vi.fn() },
}));
vi.mock("@/data/backup/postCommitRefreshes", () => ({
  runBackupPostCommitRefreshes: vi.fn(async () => false),
}));
vi.mock("@/components/SectionCard", () => ({ SectionCard: () => null }));
vi.mock("@/data/migration/maintainerMigration", () => ({
  importMaintainerMigration: vi.fn(),
  readMaintainerMigrationFile: vi.fn(),
}));
vi.mock("@/domain/regionalFormat", () => ({
  formatRegionalNumber: (value: number) => String(value),
}));
vi.mock("@/domain/regionalProfileRuntime", () => ({
  getRuntimeRegionalDefaults: () => ({ locale: "en-GB" }),
}));
vi.mock("@/domain/time", () => ({
  formatDate: vi.fn(),
  formatTime: vi.fn(),
  toDateKey: vi.fn(),
}));
vi.mock("@/providers/GlucoseAppearanceProvider", () => ({
  useGlucoseAppearance: () => ({ reload: vi.fn() }),
}));
vi.mock("@/theme/theme", () => ({ useAppTheme: vi.fn() }));

describe("maintainer migration file boundary", () => {
  it("accepts only the dedicated migration extension", () => {
    expect(
      validateMaintainerMigrationSelection({
        name: "T1-Arc-migration-2026.T1ARC-MIGRATION",
        uri: "content://documents/migration",
      }),
    ).toEqual({
      name: "T1-Arc-migration-2026.T1ARC-MIGRATION",
      uri: "content://documents/migration",
    });
    expect(() =>
      validateMaintainerMigrationSelection({
        name: "ordinary-backup.t1arc",
        uri: "content://documents/backup",
      }),
    ).toThrow(/\.t1arc-migration/i);
    expect(() =>
      validateMaintainerMigrationSelection({
        name: "migration.t1arc-migration",
        uri: " ",
      }),
    ).toThrow(/unavailable/i);
  });

  it("releases each owned plaintext preview at most once", async () => {
    const remove = vi.fn(async () => true);
    const cleaner = createMigrationArtifactCleaner(remove);
    const prepared = {
      backup: { sourceUri: "file:///private/migration.container" },
    } as never;

    const first = cleaner.release(prepared);
    expect(cleaner.release(prepared)).toBe(first);
    await expect(first).resolves.toBe(true);
    await expect(cleaner.release(prepared)).resolves.toBe(true);
    expect(remove).toHaveBeenCalledOnce();
  });

  it("reports a committed import separately from a refresh warning", () => {
    expect(
      describeMaintainerMigrationImport({
        kind: "imported",
        counts: {} as never,
        totalRecords: 42,
        recordFingerprintSha256: "a".repeat(64),
        byTable: {} as never,
        preferences: "restored",
      }),
    ).toMatchObject({
      tone: "success",
      text: expect.stringContaining("42 stored rows were migrated exactly"),
    });
    expect(
      describeMaintainerMigrationImport(
        {
          kind: "already-imported",
          counts: {} as never,
          totalRecords: 42,
          recordFingerprintSha256: "a".repeat(64),
        },
        true,
      ),
    ).toMatchObject({
      tone: "warning",
      text: expect.stringContaining("safely stored"),
    });
  });

  it("never exposes native bridge or Java details in migration errors", () => {
    const nativeError = new Error(
      "Call to function 'T1ArcBackupCrypto.decryptMigrationFileAsync' has been rejected.\n" +
        "→ Caused by: java.lang.IllegalArgumentException: The migration bundle could not be unlocked. Check the passphrase and file.",
    );
    expect(describeMaintainerMigrationError(nativeError, "unlock")).toBe(
      "The migration bundle could not be unlocked. Check the passphrase and file.",
    );
    expect(
      describeMaintainerMigrationError(
        new Error("The backup contains an invalid private payload at /data/user/0/internal."),
        "unlock",
      ),
    ).toBe(
      "The migration bundle could not be validated. It may be damaged or incompatible with this version of T1 Arc.",
    );
    expect(
      describeMaintainerMigrationError(
        new Error("Migration import requires an empty T1 Arc data store."),
        "import",
      ),
    ).toBe(
      "This migration can only be applied to an empty T1 Arc data store.",
    );
    expect(
      describeMaintainerMigrationError(
        new Error("SQLiteException: /data/user/0/internal"),
        "import",
      ),
    ).toBe(
      "The validated migration could not be applied. No partial import was accepted.",
    );
  });

  it("uses the migration MIME, magic-aware decryptor and owned cleanup path", () => {
    const source = readFileSync(
      new URL("../src/components/MaintainerMigrationCard.tsx", import.meta.url),
      "utf8",
    );
    const picker = source.slice(
      source.indexOf("DocumentPicker.getDocumentAsync({"),
      source.indexOf("if (result.canceled)"),
    );
    expect(picker).toMatch(
      /type:\s*\[MAINTAINER_MIGRATION_MIME,\s*["']application\/octet-stream["']\]/,
    );
    expect(picker).not.toMatch(/\*\/\*|application\/zip/);
    expect(source).toMatch(/decryptMigrationFileAsync\(/);
    expect(source).toMatch(/readMaintainerMigrationFile\(decrypted\.uri\)/);
    expect(source).toMatch(/removeTemporaryFileAsync\(decryptedUri\)/);
    expect(source).toMatch(/importMaintainerMigration\(prepared\)/);
  });
});
