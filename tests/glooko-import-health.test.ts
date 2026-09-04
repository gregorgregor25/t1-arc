import { describe, expect, it } from 'vitest';

import {
  automaticGlookoCgmTableHealthIssue,
  automaticGlookoInsulinTableHealthIssue,
  inspectAutomaticGlookoInsulinTables,
} from '@/data/glooko/glookoImportHealth';
import { parseGlookoTextFiles } from '@/data/import/glookoCsv';

function preview(
  recognisedFiles: {
    name: string;
    kind: 'cgm' | 'bolus' | 'basal' | 'daily-insulin';
    records: number;
    skippedRows: number;
    insulinRecords?: number;
    rejectedInsulinRows?: number;
  }[],
  extras: {
    retainedFiles?: { name: string; originalBytes: number }[];
    unrecognisedFiles?: { name: string; headers: string[] }[];
  } = {},
) {
  return {
    recognisedFiles,
    retainedFiles: extras.retainedFiles ?? [],
    unrecognisedFiles: extras.unrecognisedFiles ?? [],
  } as never;
}

const HEADER_ONLY_INSULIN = [
  {
    name: 'Insulin data/bolus_data_1.csv',
    kind: 'bolus' as const,
    records: 0,
    skippedRows: 0,
    insulinRecords: 0,
    rejectedInsulinRows: 0,
  },
  {
    name: 'Insulin data/basal_data_1.csv',
    kind: 'basal' as const,
    records: 0,
    skippedRows: 0,
    insulinRecords: 0,
    rejectedInsulinRows: 0,
  },
  {
    name: 'Insulin data/insulin_data_1.csv',
    kind: 'daily-insulin' as const,
    records: 0,
    skippedRows: 0,
    insulinRecords: 0,
    rejectedInsulinRows: 0,
  },
];

describe('automatic Glooko insulin-table health', () => {
  const supportedHeaderOnlyFiles = [
    {
      name: 'bolus_data_1.csv',
      text: 'Timestamp,Insulin delivered (U),Carbs input (g)',
    },
    {
      name: 'basal_data_1.csv',
      text: 'Timestamp,Duration (minutes),Rate,Insulin delivered (U)',
    },
    {
      name: 'insulin_data_1.csv',
      text: 'Timestamp,Total bolus (U),Total basal (U),Total insulin (U)',
    },
  ];

  it('accepts actual supported header-only files after parsing', () => {
    const parsed = parseGlookoTextFiles(supportedHeaderOnlyFiles);

    expect(parsed.unrecognisedFiles).toHaveLength(0);
    expect(automaticGlookoInsulinTableHealthIssue(parsed)).toBeUndefined();
  });

  it.each([
    ['bolus', 'bolus_data_1.csv', 'Timestamp,Renamed delivered amount'],
    ['basal', 'basal_data_1.csv', 'Timestamp,Renamed basal quantity'],
    ['daily-insulin', 'insulin_data_1.csv', 'Timestamp,Renamed daily dose'],
  ] as const)(
    'rejects a header-only %s file whose insulin columns were renamed',
    (kind, name, text) => {
      const parsed = parseGlookoTextFiles(
        supportedHeaderOnlyFiles.map((file) =>
          file.name === name ? { name, text } : file,
        ),
      );
      const issue = automaticGlookoInsulinTableHealthIssue(parsed);

      expect(parsed.unrecognisedFiles).toEqual([
        expect.objectContaining({ name }),
      ]);
      expect(issue).toMatchObject({
        code: 'insulin-table-unreadable',
        tables: [expect.objectContaining({ kind, status: 'unreadable' })],
      });
    },
  );

  it('accepts supported header-only insulin tables for a quiet window', () => {
    const input = preview([
      { name: 'cgm_data_1.csv', kind: 'cgm', records: 100, skippedRows: 0 },
      ...HEADER_ONLY_INSULIN,
    ]);

    expect(automaticGlookoInsulinTableHealthIssue(input)).toBeUndefined();
    expect(
      inspectAutomaticGlookoInsulinTables(input).map((table) => table.status),
    ).toEqual(['supported', 'supported', 'supported']);
  });

  it('does not let valid CGM rows mask missing insulin tables', () => {
    const issue = automaticGlookoInsulinTableHealthIssue(
      preview([
        { name: 'cgm_data_1.csv', kind: 'cgm', records: 100, skippedRows: 0 },
      ]),
    );

    expect(issue).toMatchObject({ code: 'insulin-table-missing' });
    expect(issue?.tables.map((table) => table.kind)).toEqual([
      'bolus',
      'basal',
      'daily-insulin',
    ]);
  });

  it('reports a named insulin file whose headers changed as unreadable', () => {
    const issue = automaticGlookoInsulinTableHealthIssue(
      preview(
        HEADER_ONLY_INSULIN.filter((file) => file.kind !== 'bolus'),
        {
          unrecognisedFiles: [
            {
              name: 'Insulin data/bolus_data_1.csv',
              headers: ['New timestamp', 'Changed dose'],
            },
          ],
        },
      ),
    );

    expect(issue).toMatchObject({ code: 'insulin-table-unreadable' });
    expect(issue?.tables.map((table) => table.kind)).toEqual(['bolus']);
  });

  it('reports a safety-retained insulin table as unreadable', () => {
    const issue = automaticGlookoInsulinTableHealthIssue(
      preview(
        HEADER_ONLY_INSULIN.filter((file) => file.kind !== 'basal'),
        {
          retainedFiles: [
            {
              name: 'Insulin data/basal_data_1.csv',
              originalBytes: 30_000_000,
            },
          ],
        },
      ),
    );

    expect(issue).toMatchObject({ code: 'insulin-table-unreadable' });
    expect(issue?.tables.map((table) => table.kind)).toEqual(['basal']);
  });

  it('detects rejected bolus doses even when carbohydrate context parsed', () => {
    const issue = automaticGlookoInsulinTableHealthIssue(
      preview([
        ...HEADER_ONLY_INSULIN.filter((file) => file.kind !== 'bolus'),
        {
          name: 'Insulin data/bolus_data_1.csv',
          kind: 'bolus',
          records: 4,
          skippedRows: 0,
          insulinRecords: 0,
          rejectedInsulinRows: 4,
        },
      ]),
    );

    expect(issue).toMatchObject({ code: 'insulin-table-rows-rejected' });
    expect(issue?.tables[0]).toMatchObject({
      kind: 'bolus',
      insulinRecords: 0,
      rejectedRows: 4,
    });
  });

  it('allows a table with accepted insulin rows and isolated rejected rows', () => {
    const input = preview([
      ...HEADER_ONLY_INSULIN.filter((file) => file.kind !== 'bolus'),
      {
        name: 'Insulin data/bolus_data_1.csv',
        kind: 'bolus',
        records: 3,
        skippedRows: 1,
        insulinRecords: 2,
        rejectedInsulinRows: 1,
      },
    ]);

    expect(automaticGlookoInsulinTableHealthIssue(input)).toBeUndefined();
  });

  it('does not let a valid numbered sibling mask an unrecognised sibling', () => {
    const issue = automaticGlookoInsulinTableHealthIssue(
      preview(
        [
          ...HEADER_ONLY_INSULIN.filter((file) => file.kind !== 'bolus'),
          {
            name: 'Insulin data/bolus_data_1.csv',
            kind: 'bolus',
            records: 2,
            skippedRows: 0,
            insulinRecords: 2,
            rejectedInsulinRows: 0,
          },
        ],
        {
          unrecognisedFiles: [
            {
              name: 'Insulin data/bolus_data_2.csv',
              headers: ['Changed timestamp', 'Changed dose'],
            },
          ],
        },
      ),
    );

    expect(issue).toMatchObject({ code: 'insulin-table-unreadable' });
    expect(issue?.tables[0]).toMatchObject({
      kind: 'bolus',
      status: 'unreadable',
      insulinRecords: 2,
    });
    expect(issue?.tables[0]?.files).toEqual([
      'Insulin data/bolus_data_1.csv',
      'Insulin data/bolus_data_2.csv',
    ]);
  });

  it('does not let a valid numbered sibling mask a retained sibling', () => {
    const issue = automaticGlookoInsulinTableHealthIssue(
      preview(
        [
          ...HEADER_ONLY_INSULIN.filter((file) => file.kind !== 'basal'),
          {
            name: 'Insulin data/basal_data_1.csv',
            kind: 'basal',
            records: 3,
            skippedRows: 0,
            insulinRecords: 3,
            rejectedInsulinRows: 0,
          },
        ],
        {
          retainedFiles: [
            {
              name: 'Insulin data/basal_data_2.csv',
              originalBytes: 30_000_000,
            },
          ],
        },
      ),
    );

    expect(issue).toMatchObject({ code: 'insulin-table-unreadable' });
    expect(issue?.tables[0]).toMatchObject({
      kind: 'basal',
      status: 'unreadable',
      insulinRecords: 3,
    });
  });

  it('does not let accepted rows mask an all-rejected numbered sibling', () => {
    const issue = automaticGlookoInsulinTableHealthIssue(
      preview([
        ...HEADER_ONLY_INSULIN.filter((file) => file.kind !== 'daily-insulin'),
        {
          name: 'Insulin data/insulin_data_1.csv',
          kind: 'daily-insulin',
          records: 2,
          skippedRows: 0,
          insulinRecords: 2,
          rejectedInsulinRows: 0,
        },
        {
          name: 'Insulin data/insulin_data_2.csv',
          kind: 'daily-insulin',
          records: 0,
          skippedRows: 4,
          insulinRecords: 0,
          rejectedInsulinRows: 4,
        },
      ]),
    );

    expect(issue).toMatchObject({ code: 'insulin-table-rows-rejected' });
    expect(issue?.tables[0]).toMatchObject({
      kind: 'daily-insulin',
      status: 'rows-rejected',
      insulinRecords: 2,
      rejectedRows: 4,
    });
  });
});

describe('automatic Glooko CGM-table health', () => {
  it('allows a pump-only export with no CGM table', () => {
    expect(
      automaticGlookoCgmTableHealthIssue(preview(HEADER_ONLY_INSULIN)),
    ).toBeUndefined();
  });

  it('accepts a supported header-only CGM table for a quiet window', () => {
    expect(
      automaticGlookoCgmTableHealthIssue(
        preview([
          ...HEADER_ONLY_INSULIN,
          { name: 'cgm_data_1.csv', kind: 'cgm', records: 0, skippedRows: 0 },
        ]),
      ),
    ).toBeUndefined();
  });

  it('does not let a readable CGM sibling mask an unreadable sibling', () => {
    const issue = automaticGlookoCgmTableHealthIssue(
      preview(
        [
          ...HEADER_ONLY_INSULIN,
          { name: 'cgm_data_1.csv', kind: 'cgm', records: 20, skippedRows: 0 },
        ],
        {
          unrecognisedFiles: [
            { name: 'cgm_data_2.csv', headers: ['Changed time', 'Changed value'] },
          ],
        },
      ),
    );

    expect(issue).toEqual({
      code: 'unsupported-archive',
      message: expect.stringContaining('CGM data'),
      files: ['cgm_data_2.csv'],
    });
  });

  it('rejects a safety-retained named CGM table', () => {
    expect(
      automaticGlookoCgmTableHealthIssue(
        preview(HEADER_ONLY_INSULIN, {
          retainedFiles: [
            { name: 'cgm_data_1.csv', originalBytes: 60_000_000 },
          ],
        }),
      ),
    ).toMatchObject({ code: 'unsupported-archive' });
  });

  it('rejects each CGM sibling whose data rows all fail normalisation', () => {
    const issue = automaticGlookoCgmTableHealthIssue(
      preview([
        ...HEADER_ONLY_INSULIN,
        { name: 'cgm_data_1.csv', kind: 'cgm', records: 4, skippedRows: 0 },
        { name: 'cgm_data_2.csv', kind: 'cgm', records: 0, skippedRows: 3 },
      ]),
    );

    expect(issue).toMatchObject({
      code: 'rejected-archive-rows',
      files: ['cgm_data_2.csv'],
    });
  });
});
