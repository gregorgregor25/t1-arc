import { describe, expect, it } from 'vitest';
import {
  contextNoteDisplayTitle,
  legacyContextNoteGlucoseMmolL,
} from '@/domain/contextNotes';

import {
  formatDistance,
  formatEnergy,
  formatGlucose,
  formatHeight,
  formatRegionalFixedNumber,
  formatRegionalNumber,
  formatTemperature,
  formatWeight,
  formatVolumeLitres,
} from '@/domain/regionalFormat';

const metric = {
  locale: 'en-GB',
  glucoseUnit: 'mmolL' as const,
  measurementSystem: 'metric' as const,
  energyUnit: 'kcal' as const,
};

const us = {
  locale: 'en-US',
  glucoseUnit: 'mgDl' as const,
  measurementSystem: 'imperial' as const,
  energyUnit: 'kcal' as const,
};

describe('regional display formatting', () => {
  it('keeps canonical glucose in mmol/L while presenting the selected unit', () => {
    expect(formatGlucose(7.25, metric)).toBe('7.3 mmol/L');
    expect(formatGlucose(7.25, us)).toBe('131 mg/dL');
  });

  it('re-presents canonical imported meter checks after a region change', () => {
    const event = {
      id: 'meter-1',
      sourceId: 'glooko-export',
      origin: 'imported' as const,
      kind: 'note' as const,
      start: 0,
      title: 'Blood glucose check',
      category: 'other' as const,
      glucoseMmolL: 7,
    };
    expect(contextNoteDisplayTitle(event, metric)).toBe(
      'Blood glucose check · 7.0 mmol/L',
    );
    expect(contextNoteDisplayTitle(event, us)).toBe(
      'Blood glucose check · 126 mg/dL',
    );
  });

  it('recovers canonical glucose from legacy localized meter-note titles', () => {
    expect(
      legacyContextNoteGlucoseMmolL('Blood glucose check · 7,0 mmol/L'),
    ).toBe(7);
    expect(
      legacyContextNoteGlucoseMmolL('Blood glucose check · ١٢٦ mg/dL'),
    ).toBeCloseTo(7, 1);
    expect(legacyContextNoteGlucoseMmolL('Ordinary note · 7 mmol/L')).toBeUndefined();
  });

  it('converts metric measurements for imperial presentation', () => {
    expect(formatWeight(80, metric)).toBe('80 kg');
    expect(formatWeight(80, us)).toBe('176.37 lb');
    expect(formatDistance(5_000, metric)).toBe('5 km');
    expect(formatDistance(5_000, us)).toBe('3.11 mi');
    expect(formatTemperature(20, metric)).toBe('20 °C');
    expect(formatTemperature(20, us)).toBe('68 °F');
    expect(formatHeight(1.78, metric)).toBe('178 cm');
    expect(formatHeight(1.78, us)).toBe('5 ft 10 in');
    expect(formatHeight(1.78, { ...us, locale: 'ar-EG' })).toBe(
      '٥ ft ١٠ in',
    );
    expect(formatVolumeLitres(2, us)).toBe('67.63 fl oz');
  });

  it('supports kJ presentation without changing stored kcal', () => {
    expect(formatEnergy(500, { ...metric, energyUnit: 'kJ' })).toBe('2,092 kJ');
  });

  it('never formats more than two decimal places', () => {
    expect(
      formatRegionalNumber(1.23456, 'en-GB', { maximumFractionDigits: 10 }),
    ).toBe('1.23');
  });

  it('keeps fixed presentation precision while using the selected locale', () => {
    expect(formatRegionalFixedNumber(1234.5, 'fr-FR', 2)).toBe('1\u202f234,50');
    expect(formatRegionalFixedNumber(1234.5, 'de-DE', 1)).toBe('1.234,5');
    expect(formatRegionalFixedNumber(12.6, 'fr-FR', 0)).toBe('13');
  });
});
