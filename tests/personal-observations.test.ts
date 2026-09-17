import { describe, expect, it } from 'vitest';
import { createManualContextEvent, manualContextDraftFromEvent, reviseManualContextEvent } from '@/data/manualContext';
import { presentPersonalObservation, validatePersonalObservation } from '@/domain/personalObservations';
import { selectNutritionSource } from '@/domain/nutritionSource';
import { summarizeHealthTrendContext } from '@/domain/healthTrendContext';
import { observedMealWindows } from '@/domain/insights';
import { hypoTreatmentReviews } from '@/domain/hypoTreatmentReview';
import { gmiSummary } from '@/domain/gmiSummary';
import { appendConnectionCheck, readConnectionHistory } from '@/domain/connectionHistory';
import { createManualInsulinDelivery, manualInsulinDraftFromDelivery, possibleImportedDoseOverlap } from '@/data/manualInsulin';
import { summarizeInsulinRange } from '@/domain/timelineInsulinSummary';
import { filterFoodDiaryMeals, summarizeFoodDiaryMeals } from '@/components/foodDiary/presentation';
import { buildDailyTimelineSummaries } from '@/domain/dailyTimelineSummary';
import { dayRange } from '@/domain/time';
import type { GlucoseReading, MealEvent, TimelineData } from '@/domain/models';

const start = Date.parse('2026-09-01T09:00:00+01:00');
const hypo = () => createManualContextEvent({ kind: 'hypo-treatment', timestamp: start, observation: { kind: 'hypo-treatment', food: 'Juice', quantity: 150, unit: 'ml', carbsGrams: 15 } }, { id: 'hypo', recordedAt: start });
const reading = (at: number, value = 7): GlucoseReading => ({ id: String(at), sourceId: 'cgm', timestamp: at, receivedAt: at, quality: 'measured', mmolL: value, trend: 'flat' });
const data = (context: TimelineData['context']): TimelineData => ({ range: { start: start - 600000, end: start + 3 * 3600000 }, glucose: Array.from({ length: 39 }, (_, i) => reading(start - 600000 + i * 300000)), context, basal: [], boluses: [], sources: [] });

describe('personal observations and nutrition', () => {
  it('keeps hypo identity editable, counts carbohydrate once, and excludes it from ordinary meal patterns', () => {
    const stored = hypo();
    const shown = presentPersonalObservation(stored);
    expect(shown).toMatchObject({ id: 'hypo', kind: 'meal', purpose: 'hypo-treatment', carbsGrams: 15 });
    const draft = manualContextDraftFromEvent(shown);
    expect(draft).toMatchObject({ kind: 'hypo-treatment' });
    expect(reviseManualContextEvent(shown, draft)).toMatchObject({ id: 'hypo', kind: 'note', observation: { carbsGrams: 15 } });
    const timeline = data([shown]);
    expect(summarizeHealthTrendContext(timeline.context, timeline.range).mealCarbsGrams).toBe(15);
    expect(observedMealWindows(timeline)).toEqual([]);
    expect(filterFoodDiaryMeals([shown as MealEvent], 'snack')).toEqual([]);
    expect(filterFoodDiaryMeals([shown as MealEvent], 'hypo-treatment')).toHaveLength(1);
    expect(summarizeFoodDiaryMeals([shown as MealEvent])['hypo-treatment']?.carbohydrateGrams).toBe(15);
    expect(hypoTreatmentReviews(timeline)[0]?.after?.timestamp).toBe(start + 15 * 60000);
    timeline.glucose = [reading(start), reading(start + 20 * 60000)];
    expect(hypoTreatmentReviews(timeline)[0]?.after).toBeUndefined();
  });
  it('uses one food source, always keeps hypo carbs, and retains excluded entries as read-only context', () => {
    const native: MealEvent = { id: 'native', sourceId: 't1arc-manual', origin: 'manual', kind: 'meal', title: 'Lunch', mealType: 'lunch', start, carbsGrams: 50 };
    const pump = { ...native, id: 'pump', sourceId: 'glooko-export', origin: 'imported' as const };
    const external = { ...native, id: 'external', sourceId: 'health-connect:example.food', origin: 'imported' as const, carbsGrams: 40 };
    const events = [native, pump, external, presentPersonalObservation(hypo())];
    const range = data([]).range;
    expect(summarizeHealthTrendContext(selectNutritionSource(events), range).mealCarbsGrams).toBe(65);
    const chosen = selectNutritionSource(events, external.sourceId);
    expect(summarizeHealthTrendContext(chosen, range).mealCarbsGrams).toBe(55);
    expect(chosen[1]).toMatchObject({ id: 'pump', kind: 'note', title: 'Pump carbohydrate entry' });
    expect(() => manualContextDraftFromEvent(chosen[0]!)).toThrow(/food diary/);
    expect(native.kind).toBe('meal');
  });
  it('marks the entire local day incomplete and carries that uncertainty into nutrient coverage', () => {
    const event = createManualContextEvent({ kind: 'food-incomplete', timestamp: start, observation: { kind: 'food-incomplete' } });
    const range = dayRange('2026-09-01');
    expect(event.start).toBe(range.start); expect(event.end).toBe(range.end);
    const summary = summarizeHealthTrendContext([event], { start: range.end - 3600000, end: range.end });
    expect(summary.foodLoggingIncomplete).toBe(true);
    expect(buildDailyTimelineSummaries(data([event]))[0]?.foodLoggingIncomplete).toBe(true);
    expect(summary.mealNutrientCoverage.carbsGrams.incompleteLogging).toBe(true);
  });
  it('validates lab units and rejects invalid map coordinates without changing actual results', () => {
    expect(validatePersonalObservation({ kind: 'lab-result', test: 'HbA1c', value: 48, unit: 'mmol/mol', laboratory: 'Clinic' })).toMatchObject({ value: 48, laboratory: 'Clinic' });
    expect(() => validatePersonalObservation({ kind: 'lab-result', test: 'HbA1c', value: 48, unit: '%' })).toThrow();
    expect(() => validatePersonalObservation({ kind: 'site-change', device: 'pump', location: { side: 'front', x: 1.5, y: 0.5 } })).toThrow();
    const event = createManualContextEvent({ kind: 'sensor-start', timestamp: start, sensorModelId: 'libre-2', location: { side: 'back', x: 0.3, y: 0.4, label: 'left arm' } });
    expect(manualContextDraftFromEvent(event)).toMatchObject({ kind: 'sensor-start', location: { label: 'left arm' } });
  });
});

describe('visible GMI and connection evidence', () => {
  it('uses the canonical GMI formula and differentiates sparse data from a representative fortnight', () => {
    const range = { start, end: start + 14 * 86400000 };
    const readings = Array.from({ length: 14 * 288 }, (_, i) => reading(start + i * 300000, 7));
    const summary = gmiSummary(readings, range);
    expect(summary.percent).toBeCloseTo(6.32, 1);
    expect(summary.mmolMol).toBe(46);
    expect(summary.representative).toBe(true);
    expect(gmiSummary(readings.slice(0, 20), range).representative).toBe(false);
    expect(gmiSummary([], range).percent).toBeNull();
  });
  it('retains transitions, bounds history, and never stores arbitrary error content', () => {
    let stored = appendConnectionCheck(undefined, { at: start, outcome: 'failed', reason: 'network' });
    stored = appendConnectionCheck(stored, { at: start + 60000, outcome: 'failed', reason: 'network' });
    expect(readConnectionHistory(stored)).toHaveLength(1);
    stored = appendConnectionCheck(stored, { at: start + 120000, outcome: 'no-new-reading', measurementAt: start - 3600000 });
    stored = appendConnectionCheck(stored, { at: start + 180000, outcome: 'new-reading', measurementAt: start + 180000 });
    expect(readConnectionHistory(stored).map(item => item.outcome)).toEqual(['failed', 'no-new-reading', 'new-reading']);
    expect(readConnectionHistory(JSON.stringify([{ at: start, outcome: 'failed', reason: 'password-secret', message: 'secret' }]))).toEqual([{ at: start, outcome: 'failed' }]);
    expect(readConnectionHistory(appendConnectionCheck(stored, { at: start + 8 * 86400000, outcome: 'new-reading' }))).toHaveLength(1);
  });
});

it('adds only confirmed extra injections to pump daily totals and flags possible duplicates separately', () => {
  const range = dayRange('2026-09-01');
  const manual = createManualInsulinDelivery({ timestamp: start, units: 3, insulinType: 'rapid-acting' });
  const extra = createManualInsulinDelivery({ timestamp: start, units: 3, insulinType: 'rapid-acting', additionalToPump: true });
  const imported = { id: 'pump-dose', sourceId: 'glooko-export', timestamp: start, units: 3 };
  const totals = [{ id: 'daily', sourceId: 'glooko-export', dateKey: '2026-09-01', timestamp: range.end - 1, basalUnits: 20, bolusUnits: 10, totalUnits: 30 }];
  expect(summarizeInsulinRange([], [extra, imported], range, totals).stats.totalUnits).toBe(33);
  expect(summarizeInsulinRange([], [manual, imported], range, totals).stats.totalUnits).toBe(30);
  expect(summarizeInsulinRange([], [extra, imported], range).stats.totalUnits).toBe(6);
  const extraBasal = createManualInsulinDelivery({ timestamp: start, units: 5, insulinType: 'long-acting', additionalToPump: true });
  expect(summarizeInsulinRange([], [extraBasal, imported], range, totals).stats).toMatchObject({ basalUnits: 25, bolusUnits: 10, totalUnits: 35 });
  expect(summarizeInsulinRange([], [extraBasal, imported], range).stats).toMatchObject({ basalUnits: 5, bolusUnits: 3, totalUnits: 8 });
  expect(manualInsulinDraftFromDelivery(extra).additionalToPump).toBe(true);
  expect(possibleImportedDoseOverlap(manual, [manual, imported])).toBe(true);
  expect(possibleImportedDoseOverlap(extra, [extra, imported])).toBe(false);
});
