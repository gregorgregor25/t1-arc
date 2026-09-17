import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { captureTarvisEntry, createTarvisComposerLifecycle } from '@/data/tarvis/composerLifecycle';
import { bindTarvisEntryToOwner, createTarvisPeriodEntry } from '@/domain/tarvisEntry';

const selection = () => bindTarvisEntryToOwner(createTarvisPeriodEntry({
  start: Date.parse('2026-09-07T10:00:00Z'), end: Date.parse('2026-09-07T11:00:00Z'),
}), 'owner-a');

describe('Tarv1s selected-context composer lifecycle', () => {
  it('captures a matching owned selection without retaining mutable navigation objects', () => {
    const entry = selection();
    const captured = captureTarvisEntry(entry, entry.question, 'owner-a');
    expect(captured).toEqual(entry);
    expect(captured).not.toBe(entry);
    expect(captured?.range).not.toBe(entry.range);
    entry.range.end += 60_000;
    expect(captured?.range.end).not.toBe(entry.range.end);
  });

  it('does not apply old context to a suggestion, edited draft or another owner', () => {
    const entry = selection();
    expect(captureTarvisEntry(entry, 'What does time in range mean?', 'owner-a')).toBeUndefined();
    expect(captureTarvisEntry(entry, `${entry.question} Also explain sleep.`, 'owner-a')).toBeUndefined();
    expect(captureTarvisEntry(entry, entry.question, 'owner-b')).toBeUndefined();
    expect(captureTarvisEntry(entry, entry.question, undefined)).toBeUndefined();
    expect(captureTarvisEntry({ ...entry, timeZone: 'Invalid/Zone' }, entry.question, 'owner-a')).toBeUndefined();
  });

  it('allows retry restoration only while the original composer remains unchanged', () => {
    const lifecycle = createTarvisComposerLifecycle();
    const first = lifecycle.beginRequest();
    expect(first.canRestoreDraft()).toBe(true);
    lifecycle.replaceDraft();
    expect(first.canRestoreDraft()).toBe(false);
    const second = lifecycle.beginRequest();
    expect(first.canRestoreDraft()).toBe(false);
    expect(second.canRestoreDraft()).toBe(true);
  });

  it('never overwrites a newer selected draft after an older request fails', async () => {
    const lifecycle = createTarvisComposerLifecycle();
    let draft = '';
    const first = lifecycle.beginRequest();
    const failure = Promise.resolve().then(() => {
      if (first.canRestoreDraft()) draft = 'old question';
    });
    draft = 'new selected period';
    lifecycle.replaceDraft();
    await failure;
    expect(draft).toBe('new selected period');
  });

  it('wires entry consumption before asynchronous work, not after completion', () => {
    // Static integration guard, not a substitute for rendered Android interaction checks.
    const screen = readFileSync(resolve('src/screens/TarvisScreen.tsx'), 'utf8');
    const send = screen.slice(screen.indexOf('async function sendQuestion('), screen.indexOf('  const compactHeader = (', screen.indexOf('async function sendQuestion(')));
    const clear = send.indexOf('onClearEntry?.()');
    expect(clear).toBeGreaterThan(send.indexOf('captureTarvisEntry('));
    expect(send).toContain('const selection = value === undefined');
    expect(clear).toBeLessThan(send.indexOf('await acquireLocalDataWriteLease()'));
    expect(send.match(/onClearEntry\?\.\(\)/g)).toHaveLength(1);
    expect(send).toContain('pendingClarification: startsNewThread ? undefined : pendingClarification');
    expect(send).toContain('entryContext: selection');
    expect(send).toContain('const questionAsOf = resolveSelectedContextAsOf({');
    expect(send).toContain('selectionAsOf, fallbackAsOf: liveData ? Date.now() : asOf');
    expect(send).toContain("plan.evidenceRanges && !loadReportForRange");
    expect(send).toContain('reportForQuestion.currentRange.start !== plan.evidenceRanges.current.start');
    expect(send).toContain("plan.kind === 'model-evidence' && plan.selectedHealthMetric");
    expect(send).toContain('buildSelectedHealthEvidencePacket(reportForQuestion, plan.selectedHealthMetric)');
    for (const [start, end] of [['function startNewConversation()', 'async function recoverCorruptConversation()'], ['function openConversationThread(', 'async function deleteConversationThread()']]) {
      expect(screen.slice(screen.indexOf(start!), screen.indexOf(end!))).toContain('onClearEntry?.()');
    }
  });

  it('consumes navigation once and clears context on explicit workspace/finding changes', () => {
    const screen = readFileSync(resolve('src/screens/InsightsScreen.tsx'), 'utf8');
    const entryEffect = screen.slice(screen.indexOf('const entry = route.params?.entry;'), screen.indexOf('const requestedRangeEnd'));
    expect(entryEffect.indexOf('navigation.setParams({ entry: undefined })')).toBeLessThan(entryEffect.indexOf('if (!isTarvisEntry(entry)'));
    for (const name of ['openTarvisForFinding', 'changeWorkspace']) {
      const body = screen.slice(screen.indexOf(`function ${name}(`)).split('\n  }')[0];
      expect(body).toContain('clearTarvisEntry()');
    }
    expect(screen).toContain('onRestoreEntry={restoreTarvisEntry}');
    expect(screen).toContain('loadInsightReportForRanges({');
    expect(screen).toContain('selectionAsOf={now}');
  });
});
