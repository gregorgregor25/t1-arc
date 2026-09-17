import type {
  GlookoFileSummary,
  GlookoImportPreview,
} from '@/data/import/glookoCsv';
import { isGlookoCgmFileName } from '@/data/import/glookoCsv';

export const REQUIRED_GLOOKO_INSULIN_TABLES = [
  'bolus',
  'basal',
  'daily-insulin',
] as const;

export type GlookoInsulinTableKind =
  (typeof REQUIRED_GLOOKO_INSULIN_TABLES)[number];

export type GlookoInsulinTableHealthStatus =
  | 'supported'
  | 'missing'
  | 'unreadable'
  | 'rows-rejected';

export interface GlookoInsulinTableHealth {
  kind: GlookoInsulinTableKind;
  status: GlookoInsulinTableHealthStatus;
  files: string[];
  insulinRecords: number;
  rejectedRows: number;
}

export type GlookoInsulinTableHealthIssueCode =
  | 'insulin-table-missing'
  | 'insulin-table-unreadable'
  | 'insulin-table-rows-rejected';

export interface GlookoInsulinTableHealthIssue {
  code: GlookoInsulinTableHealthIssueCode;
  message: string;
  tables: GlookoInsulinTableHealth[];
}

type HealthPreview = Pick<
  GlookoImportPreview,
  'recognisedFiles' | 'retainedFiles' | 'unrecognisedFiles'
>;

export interface GlookoCgmTableHealthIssue {
  code: 'unsupported-archive' | 'rejected-archive-rows';
  message: string;
  files: string[];
}

/**
 * A Glooko account can legitimately have no CGM table, so absence is allowed.
 * Once a named CGM table is present, however, every numbered sibling must be
 * readable. Otherwise a healthy insulin table could make a stale glucose
 * import look successful after Glooko changes only its CGM schema.
 */
export function automaticGlookoCgmTableHealthIssue(
  preview: HealthPreview,
): GlookoCgmTableHealthIssue | undefined {
  const recognised = preview.recognisedFiles.filter(
    (file) => file.kind === 'cgm',
  );
  const unavailable = [
    ...preview.unrecognisedFiles.map((file) => file.name),
    ...preview.retainedFiles.map((file) => file.name),
  ].filter(isGlookoCgmFileName);
  if (unavailable.length) {
    return {
      code: 'unsupported-archive',
      message:
        'The Glooko export included CGM data that T1 Arc could not safely inspect. Automatic refresh remains off so an unreadable glucose table cannot appear current.',
      files: unavailable,
    };
  }

  const allRejected = recognised.filter(
    (file) => file.records === 0 && file.skippedRows > 0,
  );
  if (allRejected.length) {
    return {
      code: 'rejected-archive-rows',
      message:
        'Glooko returned CGM rows, but none of the rows in at least one CGM file could be read. Automatic refresh remains off because the glucose format may have changed.',
      files: allRejected.map((file) => file.name),
    };
  }
  return undefined;
}

function fileKind(name: string): GlookoInsulinTableKind | undefined {
  const lower = name.replace(/\\/g, '/').split('/').pop()!.toLowerCase();
  if (lower.includes('manual_insulin') || lower.includes('manual-insulin')) {
    return undefined;
  }
  if (lower.includes('bolus')) return 'bolus';
  if (lower.includes('basal')) return 'basal';
  if (lower.includes('insulin_data') || lower.includes('insulin-data')) {
    return 'daily-insulin';
  }
  return undefined;
}

function insulinRecords(file: GlookoFileSummary) {
  return file.insulinRecords ?? file.records;
}

function rejectedInsulinRows(file: GlookoFileSummary) {
  return file.rejectedInsulinRows ?? file.skippedRows;
}

/**
 * Checks the three insulin tables promised by Glooko's direct v3 ZIP export.
 * Header-only tables are healthy: a user can legitimately have no events in
 * a requested window. A named table with a changed schema, a safety-retained
 * table, or a table whose data rows all fail normalisation is not healthy.
 */
export function inspectAutomaticGlookoInsulinTables(
  preview: HealthPreview,
): GlookoInsulinTableHealth[] {
  return REQUIRED_GLOOKO_INSULIN_TABLES.map((kind) => {
    const recognised = preview.recognisedFiles.filter(
      (file) => file.kind === kind,
    );
    const unavailableNames = [
      ...preview.unrecognisedFiles.map((file) => file.name),
      ...preview.retainedFiles.map((file) => file.name),
    ].filter((name) => fileKind(name) === kind);
    const records = recognised.reduce(
      (total, file) => total + insulinRecords(file),
      0,
    );
    const rejectedRows = recognised.reduce(
      (total, file) => total + rejectedInsulinRows(file),
      0,
    );
    const files = [...recognised.map((file) => file.name), ...unavailableNames];
    const hasAllRejectedFile = recognised.some(
      (file) =>
        insulinRecords(file) === 0 && rejectedInsulinRows(file) > 0,
    );
    // Health is assessed per numbered source file before being summarised by
    // table kind. One readable sibling must never hide another sibling whose
    // schema was unreadable, whose bytes were safety-retained, or whose every
    // insulin row was rejected.
    const status: GlookoInsulinTableHealthStatus = unavailableNames.length
      ? 'unreadable'
      : hasAllRejectedFile
        ? 'rows-rejected'
        : recognised.length
          ? 'supported'
          : 'missing';
    return { kind, status, files, insulinRecords: records, rejectedRows };
  });
}

const TABLE_LABELS: Record<GlookoInsulinTableKind, string> = {
  bolus: 'bolus',
  basal: 'basal',
  'daily-insulin': 'daily insulin total',
};

function tableList(tables: readonly GlookoInsulinTableHealth[]) {
  return tables.map((table) => TABLE_LABELS[table.kind]).join(', ');
}

/** Returns the fail-closed issue that should pause automatic importing. */
export function automaticGlookoInsulinTableHealthIssue(
  preview: HealthPreview,
): GlookoInsulinTableHealthIssue | undefined {
  const tables = inspectAutomaticGlookoInsulinTables(preview);
  const rejected = tables.filter((table) => table.status === 'rows-rejected');
  if (rejected.length) {
    return {
      code: 'insulin-table-rows-rejected',
      message: `Glooko returned ${tableList(
        rejected,
      )} table rows, but none of those insulin rows could be read. Automatic refresh remains off because the insulin format may have changed.`,
      tables: rejected,
    };
  }
  const unreadable = tables.filter((table) => table.status === 'unreadable');
  if (unreadable.length) {
    return {
      code: 'insulin-table-unreadable',
      message: `The Glooko export included ${tableList(
        unreadable,
      )} data that T1 Arc could not safely inspect. Automatic refresh remains off so glucose data cannot hide an insulin-table problem.`,
      tables: unreadable,
    };
  }
  const missing = tables.filter((table) => table.status === 'missing');
  if (missing.length) {
    return {
      code: 'insulin-table-missing',
      message: `The Glooko v3 export did not include its expected ${tableList(
        missing,
      )} table${missing.length === 1 ? '' : 's'}. Automatic refresh remains off so a glucose-only export cannot appear fully healthy.`,
      tables: missing,
    };
  }
  return undefined;
}
