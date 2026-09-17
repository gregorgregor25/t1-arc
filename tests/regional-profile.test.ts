import { describe, expect, it } from "vitest";

import {
  DEFAULT_REGIONAL_PROFILE,
  inferT1ArcRegion,
  isT1ArcRegionalProfile,
  migrateRegionalProfile,
  regionalProfileLabel,
  resolveRegionalDefaults,
} from "@/domain/regionalProfile";

describe("T1 Arc regional profile", () => {
  it.each([
    ["en-GB", "Europe/London", "europe"],
    ["de-DE", "Europe/Berlin", "europe"],
    ["en-US", "America/New_York", "us"],
    ["ja-JP", "Asia/Tokyo", "japan"],
    ["en-AU", "Australia/Sydney", "other"],
  ] as const)("maps %s and %s to %s", (locale, timeZone, expected) => {
    expect(inferT1ArcRegion(locale, timeZone)).toBe(expected);
  });

  it("keeps source services independent while deriving safe regional defaults", () => {
    const us = resolveRegionalDefaults(DEFAULT_REGIONAL_PROFILE, {
      locale: "en-US",
      timeZone: "America/Chicago",
    });
    expect(us).toMatchObject({
      region: "us",
      glucoseUnit: "mgDl",
      libreTopLevelDomain: "us",
      dexcomRegion: "us",
      medtrumRegion: "eu",
      glookoRegion: "us",
    });

    const france = resolveRegionalDefaults(DEFAULT_REGIONAL_PROFILE, {
      locale: "fr-FR",
      timeZone: "Europe/Paris",
    });
    expect(france).toMatchObject({
      region: "europe",
      glucoseUnit: "mmolL",
      libreTopLevelDomain: "io",
      dexcomRegion: "international",
      medtrumRegion: "fr",
      glookoRegion: "eu",
    });
  });

  it("allows an explicit region without silently changing an explicit unit", () => {
    expect(
      resolveRegionalDefaults(
        { ...DEFAULT_REGIONAL_PROFILE, region: "us", glucoseUnit: "mmolL" },
        { locale: "en-GB", timeZone: "Europe/London" },
      ),
    ).toMatchObject({ region: "us", glucoseUnit: "mmolL" });
  });

  it.each([
    ["europe", "mmolL", "io", "international", "eu", "United Kingdom"],
    ["us", "mgDl", "us", "us", "us", "United States"],
    ["japan", "mgDl", "io", "japan", "eu", "Japan"],
    ["other", "mmolL", "io", "international", "eu", "Other region"],
  ] as const)(
    "keeps the %s regional service contract explicit",
    (region, glucoseUnit, libre, dexcom, glooko, label) => {
      const defaults = resolveRegionalDefaults(
        { ...DEFAULT_REGIONAL_PROFILE, region, glucoseUnit: "automatic" },
        { locale: "en-GB", timeZone: "Europe/London" },
      );
      expect(defaults).toMatchObject({
        region,
        glucoseUnit,
        libreTopLevelDomain: libre,
        dexcomRegion: dexcom,
        glookoRegion: glooko,
      });
      expect(regionalProfileLabel(defaults)).toBe(label);
    },
  );

  it("does not silently change service geography when the device timezone changes during travel", () => {
    expect(inferT1ArcRegion("en-US", "Europe/London")).toBe("us");
    expect(inferT1ArcRegion("en-GB", "America/New_York")).toBe("europe");
  });

  it("rejects unknown or extra persisted fields", () => {
    expect(isT1ArcRegionalProfile(DEFAULT_REGIONAL_PROFILE)).toBe(true);
    expect(
      isT1ArcRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE, region: "moon" }),
    ).toBe(false);
    expect(
      isT1ArcRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE, secret: true }),
    ).toBe(false);
  });

  it("validates supported language tags when optional Hermes Intl APIs are absent", () => {
    const localeDescriptor = Object.getOwnPropertyDescriptor(Intl, "Locale");
    const canonicalLocalesDescriptor = Object.getOwnPropertyDescriptor(
      Intl,
      "getCanonicalLocales",
    );
    try {
      Object.defineProperty(Intl, "Locale", {
        configurable: true,
        value: undefined,
      });
      Object.defineProperty(Intl, "getCanonicalLocales", {
        configurable: true,
        value: undefined,
      });

      expect(
        isT1ArcRegionalProfile({
          ...DEFAULT_REGIONAL_PROFILE,
          languageTag: "ja-JP",
        }),
      ).toBe(true);
      expect(
        isT1ArcRegionalProfile({
          ...DEFAULT_REGIONAL_PROFILE,
          languageTag: "not a language tag",
        }),
      ).toBe(false);
    } finally {
      if (localeDescriptor) {
        Object.defineProperty(Intl, "Locale", localeDescriptor);
      } else {
        Reflect.deleteProperty(Intl, "Locale");
      }
      if (canonicalLocalesDescriptor) {
        Object.defineProperty(
          Intl,
          "getCanonicalLocales",
          canonicalLocalesDescriptor,
        );
      } else {
        Reflect.deleteProperty(Intl, "getCanonicalLocales");
      }
    }
  });

  it("migrates the original regional preference without changing its choices", () => {
    expect(
      migrateRegionalProfile({
        schemaVersion: 1,
        region: "us",
        glucoseUnit: "mmolL",
      }),
    ).toMatchObject({
      schemaVersion: 2,
      region: "us",
      glucoseUnit: "mmolL",
      countryCode: "automatic",
      measurementSystem: "automatic",
    });
  });
});
