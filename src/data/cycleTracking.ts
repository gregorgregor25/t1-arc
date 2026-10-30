import * as Crypto from 'expo-crypto';

import { chooseAutomaticHealthConnectSource } from '@/data/healthConnect/healthConnectSourcePolicy';
import { openT1ArcDatabase, withT1ArcSanitizedEraseTransaction } from '@/data/persistence/t1arcDatabase';
import {
  acquireLocalDataWriteLease,
  assertLocalDataWriteLeaseInTransaction,
  withLocalDataWriteLeaseTransaction,
} from '@/data/privacy/localDataWriteEpoch';
import {
  estimateNextPeriod,
  localCycleDate,
  mergeCyclePeriods,
  parseCycleDate,
  periodsOverlap,
  validatePeriodDates,
  type CycleDay,
  type CycleFlow,
  type CyclePeriod,
  type CycleSnapshot,
} from '@/domain/cycleTracking';

export type { CycleDate, CycleDay, CycleFlow, CyclePeriod, CycleSnapshot, NextPeriodEstimate } from '@/domain/cycleTracking';

interface PeriodRow {
  id: string;
  start_date: string;
  end_date: string | null;
}

interface DayRow {
  date: string;
  flow: CycleFlow | null;
  symptoms_json: string;
  notes: string | null;
}

interface ImportedRow {
  id: string;
  kind: 'menstruation_period' | 'menstruation_flow';
  start_ms: number;
  end_ms: number;
  payload_json: string;
  source_package: string;
  display_name: string | null;
}

interface CycleImportPreferenceRow {
  enabled: number;
  preferred_source_package: string | null;
}

export interface SaveCyclePeriodInput {
  id?: string;
  startDate: string;
  endDate?: string;
}

export interface SaveCycleDayInput {
  date: string;
  flow?: CycleFlow;
  symptoms?: string[];
  notes?: string;
}

function validateDay(input: SaveCycleDayInput) {
  parseCycleDate(input.date);
  if (input.date > localCycleDate(Date.now())) throw new Error('Future dates cannot be logged.');
  if (input.flow !== undefined && !(['spotting', 'light', 'medium', 'heavy'] as string[]).includes(input.flow)) {
    throw new Error('Choose a valid flow level.');
  }
  const symptoms = input.symptoms ?? [];
  if (!Array.isArray(symptoms) || symptoms.length > 20 || symptoms.some((item) => typeof item !== 'string' || !item.trim() || item.length > 80)) {
    throw new Error('Choose up to 20 short symptom labels.');
  }
  const uniqueSymptoms = [...new Set(symptoms.map((item) => item.trim()))];
  const notes = input.notes?.trim();
  if (notes && notes.length > 2_000) throw new Error('Keep notes below 2,000 characters.');
  return { symptoms: uniqueSymptoms, notes };
}

function manualPeriod(row: PeriodRow): CyclePeriod {
  return {
    id: row.id, startDate: row.start_date, endDate: row.end_date ?? undefined,
    source: 'manual', readOnly: false,
  };
}

function importedRecordDate(timestamp: number, payloadJson: string, offsetKey: 'startZoneOffsetSeconds' | 'endZoneOffsetSeconds'): string {
  let payload: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(payloadJson);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
  } catch { /* Retain the device-local fallback for older records. */ }
  const offset = payload[offsetKey] ?? payload.startZoneOffsetSeconds ?? payload.zoneOffsetSeconds;
  if (typeof offset === 'number' && Number.isInteger(offset) && Math.abs(offset) <= 18 * 3600) {
    const date = new Date(timestamp + offset * 1000);
    if (Number.isFinite(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return localCycleDate(timestamp);
}

function importedPeriod(row: ImportedRow): CyclePeriod | undefined {
  if (!Number.isFinite(row.start_ms) || !Number.isFinite(row.end_ms) || row.end_ms < row.start_ms) return undefined;
  const startDate = importedRecordDate(row.start_ms, row.payload_json, 'startZoneOffsetSeconds');
  if (startDate > localCycleDate(Date.now())) return undefined;
  // Health Connect period intervals end exclusively at the next midnight.
  const endDate = importedRecordDate(row.end_ms > row.start_ms ? row.end_ms - 1 : row.end_ms, row.payload_json, 'endZoneOffsetSeconds');
  try { validatePeriodDates(startDate, endDate); } catch { return undefined; }
  return {
    id: `hc:${row.id}`, startDate, endDate,
    source: 'health-connect', readOnly: true,
    sourceLabel: row.display_name ?? row.source_package,
  };
}

function importedDay(row: ImportedRow): CycleDay | undefined {
  if (row.start_ms > Date.now()) return undefined;
  let payload: unknown;
  try { payload = JSON.parse(row.payload_json); } catch { return undefined; }
  if (!payload || typeof payload !== 'object' || !('flow' in payload)) return undefined;
  const flowValue = (payload as { flow?: unknown }).flow;
  const flow: CycleFlow | undefined = flowValue === 1 ? 'light' : flowValue === 2 ? 'medium' : flowValue === 3 ? 'heavy' : undefined;
  if (!flow) return undefined;
  return { date: importedRecordDate(row.start_ms, row.payload_json, 'startZoneOffsetSeconds'), flow, flowSource: 'health-connect', symptoms: [], source: 'health-connect', readOnly: true };
}

/** Imported Health Connect rows are displayed read-only, with manual entries taking precedence. */
export async function loadCycleTracking(): Promise<CycleSnapshot> {
  const database = await openT1ArcDatabase();
  const [periodRows, dayRows, cyclePreference] = await Promise.all([
    database.getAllAsync<PeriodRow>('SELECT id, start_date, end_date FROM cycle_periods ORDER BY start_date DESC'),
    database.getAllAsync<DayRow>('SELECT date, flow, symptoms_json, notes FROM cycle_days ORDER BY date DESC'),
    database.getFirstAsync<CycleImportPreferenceRow>(
      `SELECT enabled, preferred_source_package FROM health_connect_preferences WHERE category = 'cycle'`,
    ),
  ]);
  const candidateRows = cyclePreference?.enabled === 1
    ? await database.getAllAsync<ImportedRow>(
      `SELECT h.id, h.kind, h.start_ms, h.end_ms, h.payload_json,
              h.source_package, s.display_name
         FROM health_connect_records h
         LEFT JOIN health_connect_sources s ON s.package_name = h.source_package
        WHERE h.kind IN ('menstruation_period', 'menstruation_flow')
        ORDER BY h.start_ms DESC`,
    ) : [];
  const sourceStats = new Map<string, { recordCount: number; dataThrough: number }>();
  for (const row of candidateRows) {
    const stats = sourceStats.get(row.source_package) ?? { recordCount: 0, dataThrough: 0 };
    stats.recordCount += 1;
    stats.dataThrough = Math.max(stats.dataThrough, row.end_ms);
    sourceStats.set(row.source_package, stats);
  }
  const chosenSource = cyclePreference?.preferred_source_package ??
    chooseAutomaticHealthConnectSource('cycle', [...sourceStats].map(([packageName, stats]) => ({ packageName, ...stats })))?.packageName;
  const importedRows = chosenSource
    ? candidateRows.filter((row) => row.source_package === chosenSource)
    : [];
  const manualPeriods = periodRows.map(manualPeriod);
  const periods = mergeCyclePeriods(manualPeriods, importedRows.filter((row) => row.kind === 'menstruation_period').flatMap((row) => {
    const period = importedPeriod(row);
    return period ? [period] : [];
  }));
  const days = dayRows.map((row): CycleDay => ({
    date: row.date,
    flow: row.flow ?? undefined,
    flowSource: row.flow ? 'manual' : undefined,
    symptoms: JSON.parse(row.symptoms_json) as string[],
    notes: row.notes ?? undefined,
    source: 'manual', readOnly: false,
  }));
  const manualDays = new Map(days.map((day) => [day.date, day]));
  const importedDates = new Set<string>();
  for (const row of importedRows) {
    if (row.kind !== 'menstruation_flow') continue;
    const day = importedDay(row);
    if (!day || importedDates.has(day.date)) continue;
    importedDates.add(day.date);
    const own = manualDays.get(day.date);
    if (own) {
      if (!own.flow) {
        own.flow = day.flow;
        own.flowSource = 'health-connect';
      }
    } else {
      days.push(day);
    }
  }
  days.sort((a, b) => b.date.localeCompare(a.date));
  return { periods, days, nextPeriodEstimate: estimateNextPeriod(periods, localCycleDate(Date.now())) };
}

export async function saveCyclePeriod(input: SaveCyclePeriodInput): Promise<string> {
  validatePeriodDates(input.startDate, input.endDate);
  if (input.startDate > localCycleDate(Date.now()) || (input.endDate && input.endDate > localCycleDate(Date.now()))) {
    throw new Error('Future dates cannot be logged.');
  }
  if (input.id !== undefined && (!/^[0-9a-f-]{36}$/i.test(input.id) || input.id.startsWith('hc:'))) {
    throw new Error('Only local period entries can be edited.');
  }
  const lease = await acquireLocalDataWriteLease();
  const id = input.id ?? Crypto.randomUUID();
  await withLocalDataWriteLeaseTransaction(lease, async (transaction) => {
    if (input.id) {
      const existing = await transaction.getFirstAsync<{ id: string }>('SELECT id FROM cycle_periods WHERE id = ?', id);
      if (!existing) throw new Error('The period entry was not found.');
    }
    const rows = await transaction.getAllAsync<PeriodRow>('SELECT id, start_date, end_date FROM cycle_periods WHERE id <> ?', id);
    if (rows.some((row) => periodsOverlap({ startDate: input.startDate, endDate: input.endDate }, manualPeriod(row)))) {
      throw new Error('This period overlaps another local period entry.');
    }
    const now = Date.now();
    await transaction.runAsync(
      `INSERT INTO cycle_periods (id, start_date, end_date, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET start_date = excluded.start_date,
         end_date = excluded.end_date, updated_at_ms = excluded.updated_at_ms`,
      id, input.startDate, input.endDate ?? null, now, now,
    );
  });
  return id;
}

export async function deleteCyclePeriod(id: string): Promise<void> {
  if (id.startsWith('hc:')) throw new Error('Health Connect entries are read-only.');
  const lease = await acquireLocalDataWriteLease();
  await withT1ArcSanitizedEraseTransaction(async (transaction) => {
    await assertLocalDataWriteLeaseInTransaction(transaction, lease);
    await transaction.runAsync('DELETE FROM cycle_periods WHERE id = ?', id);
  });
}

export async function saveCycleDay(input: SaveCycleDayInput): Promise<void> {
  const { symptoms, notes } = validateDay(input);
  const lease = await acquireLocalDataWriteLease();
  await withLocalDataWriteLeaseTransaction(lease, async (transaction) => {
    const now = Date.now();
    await transaction.runAsync(
      `INSERT INTO cycle_days (date, flow, symptoms_json, notes, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET flow = excluded.flow,
         symptoms_json = excluded.symptoms_json, notes = excluded.notes,
         updated_at_ms = excluded.updated_at_ms`,
      input.date, input.flow ?? null, JSON.stringify(symptoms), notes ?? null, now, now,
    );
  });
}

export async function deleteCycleDay(date: string): Promise<void> {
  parseCycleDate(date);
  const lease = await acquireLocalDataWriteLease();
  await withT1ArcSanitizedEraseTransaction(async (transaction) => {
    await assertLocalDataWriteLeaseInTransaction(transaction, lease);
    await transaction.runAsync('DELETE FROM cycle_days WHERE date = ?', date);
  });
}

/** Removes local entries; Health Connect records remain owned by their source. */
export async function clearManualCycleTracking(): Promise<void> {
  const lease = await acquireLocalDataWriteLease();
  await withT1ArcSanitizedEraseTransaction(async (transaction) => {
    await assertLocalDataWriteLeaseInTransaction(transaction, lease);
    await transaction.runAsync('DELETE FROM cycle_days');
    await transaction.runAsync('DELETE FROM cycle_periods');
  });
}
