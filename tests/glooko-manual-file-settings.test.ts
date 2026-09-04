import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { strToU8 } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";

import { previewDateRange } from "@/data/import/glookoCsv";
import { prepareGlookoImport } from "@/data/import/glookoImport";
import {
  defaultGlookoManualFileSettings,
  snapshotGlookoImportRegionalSettings,
} from "@/data/import/glookoManualFileSettings";
import { DEFAULT_REGIONAL_PROFILE } from "@/domain/regionalProfile";
import { setRuntimeRegionalProfile } from "@/domain/regionalProfileRuntime";

vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digest: async () => new Uint8Array(32).buffer,
}));

const importCardSource = readFileSync(
  fileURLToPath(
    new URL("../src/components/GlookoImportCard.tsx", import.meta.url),
  ),
  "utf8",
);

afterEach(() => {
  setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE });
});

describe("manual Glooko file interpretation boundary", () => {
  it("keeps editable file settings outside the locked preview boundary", () => {
    expect(importCardSource).toContain(
      'accessibilityLabel="Glooko file export timezone"',
    );
    expect(importCardSource).toContain('accessibilityRole="radio"');
    expect(importCardSource).toContain("editable={!manualSettingsLocked}");
    expect(importCardSource).toContain(
      "const settings = snapshotGlookoImportRegionalSettings({",
    );
    expect(importCardSource).toContain(
      "const settings = prepared.preview.regionalSettings;",
    );
  });

  it("defaults from the active regional service contract and rejects invalid zones", () => {
    expect(
      defaultGlookoManualFileSettings({
        timeZone: "America/New_York",
        glookoRegion: "us",
      }),
    ).toEqual({
      timeZone: "America/New_York",
      dateOrder: "month-first",
    });
    expect(
      defaultGlookoManualFileSettings({
        timeZone: "Asia/Tokyo",
        glookoRegion: "eu",
      }),
    ).toEqual({ timeZone: "Asia/Tokyo", dateOrder: "day-first" });
    expect(() =>
      snapshotGlookoImportRegionalSettings({
        timeZone: "not/a-zone",
        dateOrder: "day-first",
      }),
    ).toThrow(/valid IANA timezone/i);
  });

  it("keeps a New York file preview on New York time after the runtime profile moves to Tokyo", async () => {
    const mutableSettings = {
      timeZone: "America/New_York",
      dateOrder: "month-first" as const,
    };
    const csv = [
      "Timestamp,Glucose Value (mg/dL),Trend",
      "12/31/2026 23:30:00,108,Flat",
    ].join("\n");

    const preparedPromise = prepareGlookoImport(
      "cgm_data_1.csv",
      strToU8(csv),
      Date.parse("2027-01-01T12:00:00Z"),
      mutableSettings,
    );
    mutableSettings.timeZone = "Asia/Tokyo";
    const prepared = await preparedPromise;

    setRuntimeRegionalProfile({
      ...DEFAULT_REGIONAL_PROFILE,
      region: "japan",
      countryCode: "JP",
      languageTag: "ja-JP",
      analysisTimeZone: "Asia/Tokyo",
      followDeviceTimeZone: false,
      clinicalJurisdiction: "JP",
    });

    expect(prepared.preview.regionalSettings).toEqual({
      timeZone: "America/New_York",
      dateOrder: "month-first",
    });
    expect(Object.isFrozen(prepared.preview.regionalSettings)).toBe(true);
    expect(prepared.preview.glucose[0]?.timestamp).toBe(
      Date.parse("2027-01-01T04:30:00Z"),
    );
    expect(previewDateRange(prepared.preview)).toEqual({
      start: "2026-12-31",
      end: "2026-12-31",
    });
    prepared.sourcePayload?.bytes.fill(0);
  });
});
