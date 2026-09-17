import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');
}

describe('regional number presentation source contract', () => {
  it('does not use device-default formatting for audited visible UI numbers', () => {
    const audited = [
      'src/screens/TarvisScreen.tsx',
      'src/components/HealthMetricRecordList.tsx',
      'src/components/EvidenceQueryChart.tsx',
      'src/components/RecordList.tsx',
    ];

    for (const path of audited) {
      const text = source(path);
      expect(text, path).not.toContain('.toFixed(');
      expect(text, path).not.toMatch(/\.toLocaleString\(\s*\)/);
    }
  });

  it('routes local Tarv1s answer and evidence numbers through regional helpers', () => {
    const audited = [
      'src/data/tarvis/directAnswerPresentation.ts',
      'src/data/tarvis/evidencePresentation.ts',
      'src/data/tarvis/localGlucoseAnswer.ts',
      'src/data/tarvis/localGlucoseRangeAnswer.ts',
      'src/data/tarvis/localPersonalDataAnswer.ts',
      'src/data/tarvis/plannedGlucoseEpisodeEvidence.ts',
      'src/data/tarvis/retrospectiveEventReview.ts',
    ];

    for (const path of audited) {
      const text = source(path);
      expect(text, path).not.toContain('.toFixed(');
      expect(text, path).not.toMatch(/\.toLocaleString\(\s*\)/);
      expect(text, path).toMatch(/formatTarvis(?:Fixed)?Number/);
    }
  });

  it('keeps the remaining audited visible summaries off toFixed and default locale', () => {
    const audited = [
      'src/components/DailySummaryCard.tsx',
      'src/components/HealthMetricCards.tsx',
      'src/components/InsulinEventList.tsx',
      'src/components/MetabolicSummaryCard.tsx',
      'src/components/NightscoutSourceCard.tsx',
      'src/components/TodayGlanceCard.tsx',
      'src/components/notificationIobEvidencePresentation.ts',
      'src/data/manualContext.ts',
      'src/domain/evidenceQueryChart.ts',
      'src/domain/insulinSummaryPresentation.ts',
      'src/domain/timelinePresentation.ts',
    ];

    for (const path of audited) {
      const text = source(path);
      expect(text, path).not.toContain('.toFixed(');
      expect(text, path).not.toMatch(/\.toLocaleString\(\s*\)/);
    }
  });
});
