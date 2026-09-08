import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindTarvisEntryToOwner, createTarvisHealthEntry, createTarvisPeriodEntry } from '@/domain/tarvisEntry';
import { coordinateTarvisContextRequest, resolveSelectedContextAsOf } from '@/data/tarvis/contextRequestCoordinator';
import { coordinateTarvisRequest } from '@/data/tarvis/requestCoordinator';
import { resolveTarvisLaunchContext } from '@/data/tarvis/conversationScope';
import { createDemoRepository } from '@/data/demoRepository';
import { loadInsightReportForRanges } from '@/data/insights/loadInsightReport';
import { buildTarvisEvidencePacket, selectTarvisEvidencePacket } from '@/data/tarvis/evidencePacket';
import { buildSelectedHealthEvidencePacket } from '@/data/tarvis/selectedHealthEvidence';
import { localTarvisEvidenceFallback } from '@/data/tarvis/evidenceAnswerGuardrail';
import { buildHealthMetricSnapshot } from '@/data/healthConnect/healthMetricSnapshot';
import type { DiabetesRepository } from '@/data/contracts';
import type { TimelineData, TimeRange } from '@/domain/models';
import { DEFAULT_REGIONAL_PROFILE } from '@/domain/regionalProfile';
import { setRuntimeRegionalProfile } from '@/domain/regionalProfileRuntime';
import { dayRange } from '@/domain/time';
import { buildInsightComparisonRanges } from '@/domain/insightRanges';

const mocks = vi.hoisted(() => ({ health: vi.fn(), generation: vi.fn(), assertCurrent: vi.fn() }));
vi.mock('@/data/healthConnect/dailyHealthMetrics', () => ({ getDailyHealthMetricSnapshot: mocks.health }));
vi.mock('@/data/insights/insightReportRepository', () => ({
  acquireInsightInputGeneration: mocks.generation, assertInsightInputGenerationCurrent: mocks.assertCurrent,
}));

const owner = 'active-owner';
const asOf = Date.parse('2026-09-08T12:00:00Z');
const range = { start: Date.parse('2026-09-07T00:00:00Z'), end: Date.parse('2026-09-08T00:00:00Z') };
const entryFor = (selected: TimeRange = range, metric = 'Sleep') => bindTarvisEntryToOwner(createTarvisHealthEntry(selected, metric), owner);
const dataFor = (selected: TimeRange): TimelineData => ({
  range: selected, basal: [], boluses: [], sources: [],
  glucose: Array.from({ length: Math.ceil((selected.end - selected.start) / 300_000) }, (_, index) => ({ id: `g:${selected.start}:${index}`, timestamp: selected.start + index * 300_000,
    receivedAt: selected.start + index * 300_000, mmolL: 6, sourceId: 'cgm', quality: 'measured', trend: 'flat' })),
  context: [{ id: `sleep:${selected.start}`, kind: 'sleep', title: 'Recorded sleep', sourceId: 'hc', origin: 'imported',
    start: selected.start + 3_600_000, end: Math.min(selected.end, selected.start + 7 * 3_600_000), durationMinutes: 360 }],
});

beforeEach(() => {
  setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE, analysisTimeZone: 'Europe/London', followDeviceTimeZone: false, languageTag: 'en-GB' });
  vi.resetAllMocks();
  mocks.generation.mockResolvedValue(7);
  mocks.assertCurrent.mockResolvedValue(undefined);
  mocks.health.mockImplementation(async (selected: TimeRange) => buildHealthMetricSnapshot({ context: [], records: [{
    id: `heart:${selected.start}`, kind: 'resting_heart_rate', start: selected.start + 1, end: selected.start + 1,
    sourcePackage: 'health.source', sourceLabel: 'Selected health source', value: 62, unit: 'bpm',
  }] }, selected));
});
afterEach(() => setRuntimeRegionalProfile({ ...DEFAULT_REGIONAL_PROFILE }));

describe('production Health entry request coordination', () => {
  it('uses the current dataset clock for an explicit selection without changing ordinary review anchoring', () => {
    const entry = entryFor();
    const options = { entryContext: entry, question: entry.question, ownerIdentity: owner, selectionAsOf: asOf, fallbackAsOf: range.start - 1 };
    expect(resolveSelectedContextAsOf(options)).toBe(asOf);
    expect(resolveSelectedContextAsOf({ ...options, entryContext: undefined })).toBe(options.fallbackAsOf);
    expect(resolveSelectedContextAsOf({ ...options, question: 'What was my glucose yesterday?' })).toBe(options.fallbackAsOf);
    expect(resolveSelectedContextAsOf({ ...options, ownerIdentity: 'another-owner' })).toBe(options.fallbackAsOf);
    for (const selectionAsOf of [undefined, NaN, Infinity, 0, -1, asOf + 0.5, 8_640_000_000_000_000]) {
      expect(resolveSelectedContextAsOf({ ...options, selectionAsOf })).toBe(options.fallbackAsOf);
    }
    const period = bindTarvisEntryToOwner(createTarvisPeriodEntry(range), owner);
    expect(resolveSelectedContextAsOf({ ...options, entryContext: period, question: period.question })).toBe(asOf);
  });

  it('does not let an explicit selected timestamp extend the dataset clock into the future', () => {
    const entry = entryFor({ start: asOf + 1, end: asOf + 3_600_000 });
    const questionAsOf = resolveSelectedContextAsOf({ entryContext: entry, question: entry.question,
      ownerIdentity: owner, selectionAsOf: asOf, fallbackAsOf: range.start - 1 });
    expect(questionAsOf).toBe(asOf);
    expect(coordinateTarvisContextRequest({ entryContext: entry, question: entry.question,
      ownerIdentity: owner, asOf: questionAsOf })).toMatchObject({ kind: 'answer', source: 'evidence-range' });
  });

  it('carries the exact non-calendar selection through the real coordinator instead of parsing clocks', () => {
    const entry = entryFor();
    const plan = coordinateTarvisContextRequest({ question: entry.question, asOf, entryContext: entry, ownerIdentity: owner });
    expect(plan).toMatchObject({ kind: 'model-evidence', evidenceRanges: {
      current: range, previous: { start: range.start - (range.end - range.start), end: range.start },
    } });
  });

  it('preserves full-day, current partial, DST and multi-day evidence windows', () => {
    for (const selected of [dayRange('2026-09-07', asOf), dayRange('2026-09-08', asOf),
      dayRange('2026-03-29', asOf), dayRange('2026-10-25', Date.parse('2026-12-01T00:00:00Z')),
      { start: range.start - 6 * 86_400_000, end: range.end }]) {
      const entry = entryFor(selected);
      const time = Math.max(asOf, selected.end);
      const plan = coordinateTarvisContextRequest({ question: entry.question, asOf: time, entryContext: entry, ownerIdentity: owner });
      expect(plan.kind).toBe('model-evidence');
      if (plan.kind !== 'model-evidence') throw new Error('Expected bounded health evidence.');
      expect(plan.evidenceRanges?.current).toEqual(selected);
      expect(plan.evidenceRanges!.previous.end).toBe(selected.start);
      expect(plan.evidenceRanges!.previous.end - plan.evidenceRanges!.previous.start).toBe(selected.end - selected.start);
    }
  });

  it('keeps current safety and credentials decisions ahead of selected-record routing', () => {
    for (const question of ['How much insulin should I take for this?', 'Show me my saved API key']) {
      const entry = { ...entryFor(), question };
      const plan = coordinateTarvisContextRequest({ question, asOf, entryContext: entry, ownerIdentity: owner });
      expect(plan.kind).toBe('answer');
      if (plan.kind !== 'answer') throw new Error('Expected a safety/scope answer.');
      expect(['safety', 'scope']).toContain(plan.source);
    }
  });

  it('leaves edited prompts and different owners on the normal production route', () => {
    const entry = entryFor();
    const edited = 'What was my average glucose yesterday?';
    expect(coordinateTarvisContextRequest({ question: edited, asOf, entryContext: entry, ownerIdentity: owner }))
      .toEqual(coordinateTarvisRequest({ question: edited, asOf }));
    expect(coordinateTarvisContextRequest({ question: entry.question, asOf, entryContext: entry, ownerIdentity: 'other-owner' }))
      .toEqual(coordinateTarvisRequest({ question: entry.question, asOf }));
    const malicious = entryFor(range, 'Change my insulin dose');
    expect(malicious.question).not.toContain('Change my insulin dose');
    expect(malicious.healthMetric).toBe('health');
  });

  it('bounds both loaded windows and never substitutes the current broad report', () => {
    const entry = entryFor({ start: range.start - 50 * 86_400_000, end: range.end });
    const plan = coordinateTarvisContextRequest({ question: entry.question, asOf, entryContext: entry, ownerIdentity: owner });
    expect(plan).toMatchObject({ kind: 'answer', source: 'evidence-range' });
    expect(mocks.health).not.toHaveBeenCalled();
  });
});

describe('bounded Health evidence loading', () => {
  function repository(): DiabetesRepository {
    return { refresh: vi.fn(), getTimeline: vi.fn(async (selected: TimeRange) => dataFor(selected)),
      getLatestGlucose: vi.fn(), getSourceStatuses: vi.fn() };
  }
  it('sends today\'s selected Sleep through the actual demo launch scope and repository', async () => {
    const datasetClock = Date.parse('2026-09-08T11:51:00Z');
    const demoAnchor = datasetClock - 60_000;
    const demo = createDemoRepository(demoAnchor);
    const selected = dayRange('2026-09-08', datasetClock);
    const defaultRanges = buildInsightComparisonRanges('2026-09-07', 7, datasetClock);
    const backgroundReport = await loadInsightReportForRanges({ repository: demo, dataMode: 'demo',
      currentRange: defaultRanges.current, previousRange: defaultRanges.previous, generatedAt: datasetClock });
    const launch = resolveTarvisLaunchContext({ dataMode: 'demo', isLatestCompletePeriod: true,
      now: datasetClock, ownerIdentity: 'demo-fixture-v1', report: backgroundReport });
    expect(launch.liveData).toBe(false);
    expect(launch.asOf).toBe(selected.start - 1);
    const entry = bindTarvisEntryToOwner(createTarvisHealthEntry(selected, 'Sleep'), 'demo-fixture-v1');
    const request = { entryContext: entry, question: entry.question, ownerIdentity: 'demo-fixture-v1' };
    // Regression: yesterday's unrelated review cannot be today's record cutoff.
    expect(coordinateTarvisContextRequest({ ...request, asOf: launch.asOf }))
      .toMatchObject({ kind: 'answer', source: 'evidence-range' });
    const questionAsOf = resolveSelectedContextAsOf({ ...request, selectionAsOf: datasetClock, fallbackAsOf: launch.asOf });
    const plan = coordinateTarvisContextRequest({ ...request, asOf: questionAsOf });
    if (plan.kind !== 'model-evidence' || !plan.evidenceRanges) throw new Error('Expected selected demo health evidence.');
    expect(plan.evidenceRanges.current).toEqual(selected);
    const selectedReport = await loadInsightReportForRanges({ repository: demo, dataMode: 'demo',
      currentRange: plan.evidenceRanges.current, previousRange: plan.evidenceRanges.previous, generatedAt: questionAsOf });
    const packet = selectTarvisEvidencePacket(entry.question, buildSelectedHealthEvidencePacket(selectedReport, entry.healthMetric!).packet);
    const local = localTarvisEvidenceFallback(packet);
    expect(selectedReport.ready).toBe(true);
    expect(packet.comparison.currentRange).toEqual(selected);
    expect(local.answer).toMatch(/sleep/i);
    expect(local.answer).toContain('6 h 33 min');
    expect(local.headline).toBe('Sleep in the selected period');
    expect(local.answer.startsWith('Sleep recorded in this period.')).toBe(true);
    expect(local.answer).not.toContain(selectedReport.summary);
    expect(local.answer).toContain('The preceding comparison period has no sleep record');
    expect(local.limitations.join(' ')).toContain('does not establish a relationship with glucose or a cause');
    expect(packet.requiredFindingIds).toContain('recorded-sleep-current-period');
    expect(local.evidenceIds.some(id => /sleep/.test(id))).toBe(true);
    const timeline = await demo.getTimeline(selected);
    expect(timeline.glucose.length).toBeGreaterThan(100);
    expect(timeline.glucose.every(reading => reading.timestamp <= demoAnchor - 3 * 60_000)).toBe(true);
    expect(mocks.health).not.toHaveBeenCalled();
    // No navigation entry means a normal historical/demo question stays anchored.
    expect(resolveSelectedContextAsOf({ question: 'What was my average glucose yesterday?',
      selectionAsOf: datasetClock, fallbackAsOf: launch.asOf })).toBe(launch.asOf);
  });

  it.each(['Sleep', 'Heart rate'])('loads actual %s and glucose evidence for the selected Send route', async (metric) => {
    const entry = entryFor(range, metric);
    const plan = coordinateTarvisContextRequest({ question: entry.question, asOf, entryContext: entry, ownerIdentity: owner });
    if (plan.kind !== 'model-evidence' || !plan.evidenceRanges) throw new Error('Expected selected health report.');
    const repo = repository();
    const report = await loadInsightReportForRanges({ repository: repo, dataMode: 'live',
      currentRange: plan.evidenceRanges.current, previousRange: plan.evidenceRanges.previous, generatedAt: asOf });
    const packet = selectTarvisEvidencePacket(entry.question, buildSelectedHealthEvidencePacket(report, entry.healthMetric!).packet);
    expect(packet.comparison.currentRange).toEqual(range);
    expect(repo.getTimeline).toHaveBeenNthCalledWith(1, range);
    expect(mocks.health).toHaveBeenNthCalledWith(1, range);
    expect(mocks.health).toHaveBeenNthCalledWith(2, plan.evidenceRanges.previous);
    expect(packet.evidence.some(item => item.recordCount > 0 && item.examples.some(example => example.id.startsWith(metric === 'Sleep' ? 'sleep:' : 'heart:')))).toBe(true);
    const localAnswer = localTarvisEvidenceFallback(packet);
    expect(localAnswer.headline).toBe(`${metric} in the selected period`);
    const selectedFinding = packet.findings.find(finding => packet.requiredFindingIds?.includes(finding.id))!;
    expect(localAnswer.answer.startsWith(`${selectedFinding.title}. ${selectedFinding.summary}`)).toBe(true);
    expect(localAnswer.answer).toMatch(metric === 'Sleep' ? /sleep/i : /62 bpm/);
    expect(localAnswer.evidenceIds.some(id => id.includes(metric === 'Sleep' ? 'sleep' : 'heart'))).toBe(true);
    expect(mocks.assertCurrent).toHaveBeenCalledWith(7);
    const ordinaryPacket = buildTarvisEvidencePacket(report).packet;
    expect(ordinaryPacket.comparison.headline).toBe(report.headline);
    expect(ordinaryPacket.comparison.summary).toContain(report.summary);
    expect(packet.evidence).toContainEqual(ordinaryPacket.evidence.find(item => item.id === selectedFinding.evidenceIds[0]));
  });

  it('keeps the explicitly selected metric through packet caps, topic filtering and the no-key fallback', async () => {
    const report = await loadInsightReportForRanges({ repository: repository(), dataMode: 'live', currentRange: range,
      previousRange: { start: range.start - 86_400_000, end: range.start }, generatedAt: asOf });
    const generic = report.findings.find(item => item.category === 'glucose')!;
    const rich = { ...report, findings: [...Array.from({ length: 25 }, (_, index) => ({ ...generic, id: `generic-${index}` })), ...report.findings] };
    const entry = entryFor(range, 'Heart rate');
    const lookup = buildSelectedHealthEvidencePacket(rich, entry.healthMetric!);
    const packet = selectTarvisEvidencePacket(entry.question, lookup.packet);
    expect(lookup.packet.findings.length).toBeLessThanOrEqual(18);
    expect(packet.findings.length).toBeLessThanOrEqual(10);
    expect(packet.requiredFindingIds).toContain('health-connect-heart-rate');
    const local = localTarvisEvidenceFallback(packet);
    expect(local.answer).toContain('62 bpm');
    expect(local.evidenceIds).toContain('current-heart-rate');
    expect(local.limitations.join(' ')).toMatch(/not a diagnosis|not proof/i);
  });

  it('never reads live Health Connect storage for demo datasets', async () => {
    await loadInsightReportForRanges({ repository: repository(), dataMode: 'demo', currentRange: range,
      previousRange: { start: range.start - 86_400_000, end: range.start }, generatedAt: asOf });
    expect(mocks.health).not.toHaveBeenCalled();
  });

  it.each([
    ['partial day', { start: Date.parse('2026-09-07T23:00:00Z'), end: asOf }],
    ['spring DST day', { start: Date.parse('2026-03-29T00:00:00Z'), end: Date.parse('2026-03-29T23:00:00Z') }],
    ['autumn DST day', { start: Date.parse('2026-10-24T23:00:00Z'), end: Date.parse('2026-10-26T00:00:00Z') }],
    ['multi-day', { start: range.start - 2 * 86_400_000, end: range.end }],
  ] as const)('keeps %s evidence exact through loading and packet selection', async (_, selected) => {
    const entry = entryFor(selected, 'Heart rate');
    const generatedAt = Math.max(asOf, selected.end);
    const plan = coordinateTarvisContextRequest({ question: entry.question, asOf: generatedAt, entryContext: entry, ownerIdentity: owner });
    if (plan.kind !== 'model-evidence' || !plan.evidenceRanges) throw new Error('Expected selected health report.');
    const report = await loadInsightReportForRanges({ repository: repository(), dataMode: 'live',
      currentRange: plan.evidenceRanges.current, previousRange: plan.evidenceRanges.previous, generatedAt });
    const packet = selectTarvisEvidencePacket(entry.question, buildTarvisEvidencePacket(report).packet);
    expect(report.ready).toBe(true);
    expect(packet.comparison.currentRange).toEqual(selected);
    expect(packet.findings.some(item => item.category === 'heart')).toBe(true);
    expect(packet.evidence.filter(item => item.id.startsWith('current-heart')).every(item =>
      item.range.start === selected.start && item.range.end === selected.end)).toBe(true);
  });

  it('retains baseline limitations for sparse partial-day glucose instead of inventing a relationship', async () => {
    const selected = { start: asOf - 30 * 60_000, end: asOf };
    const report = await loadInsightReportForRanges({ repository: repository(), dataMode: 'live', currentRange: selected,
      previousRange: { start: selected.start - 30 * 60_000, end: selected.start }, generatedAt: asOf });
    expect(report.currentRange).toEqual(selected);
    expect(report.ready).toBe(false);
    expect(report.findings.map(item => item.id)).toEqual(['baseline-limitation']);
    expect(report.current.restingHeartRateBpm).toBe(62);
  });

  it('rejects evidence changed during loading rather than combining different generations', async () => {
    mocks.assertCurrent.mockRejectedValueOnce(new Error('Input generation changed'));
    await expect(loadInsightReportForRanges({ repository: repository(), dataMode: 'live', currentRange: range,
      previousRange: { start: range.start - 86_400_000, end: range.start }, generatedAt: asOf })).rejects.toThrow('Input generation changed');
  });

  it('rejects future or empty ranges before accessing records', async () => {
    await expect(loadInsightReportForRanges({ repository: repository(), dataMode: 'live', currentRange: { ...range, end: asOf + 1 },
      previousRange: { start: range.start - 86_400_000, end: range.start }, generatedAt: asOf })).rejects.toThrow(/valid recorded period/);
    expect(mocks.health).not.toHaveBeenCalled();
    expect(mocks.generation).not.toHaveBeenCalled();
  });
});
