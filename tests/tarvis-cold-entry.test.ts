import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { resolveLiveTarvisLaunchContext, resolveTarvisDatasetOwnerIdentity, resolveTarvisLaunchContext } from '@/data/tarvis/conversationScope';
import type { InsightReport } from '@/domain/insights';

const ownerIdentity = resolveTarvisDatasetOwnerIdentity({ dataMode: 'live', localDataEpoch: 4, ownedSources: [] });
const request = { dataMode: 'live', isLatestCompletePeriod: true, now: Date.parse('2026-09-07T12:00:00Z'), ownerIdentity };

describe('live Tarv1s cold entry', () => {
  it('has the same owner scope before and after a report is available', () => {
    const early = resolveLiveTarvisLaunchContext(request);
    const later = resolveTarvisLaunchContext({ ...request, report: {} as InsightReport });
    expect(early).toEqual(later);
    expect(early?.scope).toMatchObject({ kind: 'live', ownerIdentity });
  });

  it.each([
    { dataMode: 'demo' },
    { isLatestCompletePeriod: false },
    { reviewId: 'saved-review' },
    { ownerIdentity: 'dataset-owner-unavailable-v1' },
  ])('does not manufacture a live scope for %j', (change) => {
    expect(resolveLiveTarvisLaunchContext({ ...request, ...change })).toBeUndefined();
  });

  it('keeps the privacy gate closed but paints a startup surface', () => {
    const gate = readFileSync('src/components/LocalDataEraseRecoveryGate.tsx', 'utf8');
    expect(gate).toContain('resumePendingLocalDataErase()');
    expect(gate).toContain('if (state.error) throw state.error');
    expect(gate).toContain('state.ready ? children : <AppStartupScreen />');
  });

  it('defers comparison loading and does not substitute invented empty evidence', () => {
    const screen = readFileSync('src/screens/InsightsScreen.tsx', 'utf8');
    expect(screen).toContain('useSavedInsightReports(prepareInsights)');
    expect(screen).toContain('comparisonEndDate !== latestCompleteDate');
    expect(screen).toContain('resolveLiveTarvisLaunchContext');
    expect(screen).not.toContain('if (activeReport && tarvisContext)');
    const chat = readFileSync('src/screens/TarvisScreen.tsx', 'utf8');
    expect(chat).toContain('loadDefaultReport()');
    expect(chat).toContain("plan.kind === 'model-evidence' && !rawEvidenceForQuestion");
  });

  it('keeps a themed surface while navigation resolves its initial link', () => {
    const navigator = readFileSync('src/navigation/AppNavigator.tsx', 'utf8');
    expect(navigator).toContain('fallback={<AppStartupScreen />}');
    const app = readFileSync('App.tsx', 'utf8');
    expect(app).toContain('backgroundColor: colors.background');
    expect(app).toContain('<AppSurface />');
  });
});
