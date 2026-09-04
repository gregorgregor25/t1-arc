import { describe, expect, it } from "vitest";

import {
  collectEvidenceRecordIds,
  evidenceRequestKey,
  evidenceResolutionValue,
  evidenceSnapshotForRequest,
  nextEvidenceVisibleCount,
  shouldShowEvidencePagination,
} from "@/components/evidenceResolutionPresentation";

describe('evidence record resolution presentation', () => {
  it('counts privacy-safe notification IOB records as real resolved evidence IDs', () => {
    expect(
      collectEvidenceRecordIds({
        timelineIds: ['glucose-1'],
        healthMetricIds: ['health-1'],
        sourceRecordIds: ['source-1'],
        notificationIobIds: ['notification-observation:v2:native:123'],
      }),
    ).toEqual(
      new Set([
        'glucose-1',
        'health-1',
        'source-1',
        'notification-observation:v2:native:123',
      ]),
    );
  });

  it('advances an IOB-only evidence request far enough to resolve the 101st ID', () => {
    const ids = Array.from({ length: 101 }, (_, index) => `iob-${index + 1}`);
    const firstVisible = 100;
    const nextVisible = nextEvidenceVisibleCount(firstVisible, ids.length);
    const identity = {
      dataMode: 'live',
      evidenceId: 'notification-iob',
      purpose: 'records' as const,
      range: { start: 10, end: 20 },
      revision: 1,
    };

    expect(nextVisible).toBe(101);
    expect(ids.slice(0, nextVisible)).toContain('iob-101');
    expect(
      evidenceRequestKey({ ...identity, recordIds: ids.slice(0, nextVisible) }),
    ).not.toBe(
      evidenceRequestKey({ ...identity, recordIds: ids.slice(0, firstVisible) }),
    );
  });

  it('owns pagination generically for mixed live evidence without duplicating a complete demo timeline control', () => {
    expect(
      shouldShowEvidencePagination({
        dataMode: 'live',
        hasReferencedTimelineRecords: true,
        totalCount: 101,
        visibleCount: 100,
      }),
    ).toBe(true);
    expect(
      shouldShowEvidencePagination({
        dataMode: 'demo',
        hasReferencedTimelineRecords: true,
        totalCount: 101,
        visibleCount: 100,
      }),
    ).toBe(false);
    expect(
      shouldShowEvidencePagination({
        dataMode: 'demo',
        hasReferencedTimelineRecords: false,
        totalCount: 101,
        visibleCount: 100,
      }),
    ).toBe(true);
  });

  it('does not claim zero records while resolution is still running', () => {
    expect(evidenceResolutionValue(undefined)).toBe("Checking");
  });

  it('shows the real resolved count once known', () => {
    expect(evidenceResolutionValue({ resolved: 0 })).toBe("0");
    expect(evidenceResolutionValue({ resolved: 12 })).toBe("12");
  });

  it('distinguishes a failed check from a confirmed zero', () => {
    expect(evidenceResolutionValue(undefined, true)).toBe("Unavailable");
  });

  it("changes request ownership for every evidence and range input", () => {
    const base = {
      dataMode: "live",
      evidenceId: "evidence-a",
      purpose: "records" as const,
      range: { start: 10, end: 20 },
      recordIds: ["one", "two"],
      revision: 3,
    };
    const key = evidenceRequestKey(base);

    expect(evidenceRequestKey({ ...base, evidenceId: "evidence-b" })).not.toBe(
      key,
    );
    expect(
      evidenceRequestKey({ ...base, range: { start: 11, end: 20 } }),
    ).not.toBe(key);
    expect(evidenceRequestKey({ ...base, recordIds: ["one"] })).not.toBe(key);
    expect(evidenceRequestKey({ ...base, dataMode: "demo" })).not.toBe(key);
    expect(evidenceRequestKey({ ...base, revision: 4 })).not.toBe(key);
    expect(evidenceRequestKey({ ...base, purpose: "visual" })).not.toBe(key);
  });

  it("hides a completed snapshot synchronously for a new key or repository", () => {
    const firstRepository = {};
    const secondRepository = {};
    const snapshot = {
      key: "evidence-a:10:20",
      owner: firstRepository,
      value: { resolved: 12 },
    };

    expect(
      evidenceSnapshotForRequest(
        snapshot,
        "evidence-a:10:20",
        firstRepository,
      ),
    ).toEqual({ resolved: 12 });
    expect(
      evidenceSnapshotForRequest(
        snapshot,
        "evidence-b:10:20",
        firstRepository,
      ),
    ).toBeUndefined();
    expect(
      evidenceSnapshotForRequest(
        snapshot,
        "evidence-a:10:20",
        secondRepository,
      ),
    ).toBeUndefined();
    expect(
      evidenceSnapshotForRequest(undefined, undefined, firstRepository),
    ).toBeUndefined();
  });
});
