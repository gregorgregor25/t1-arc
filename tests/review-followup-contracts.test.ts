import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifyTarvisSafety } from '@/data/tarvis/safety';

describe('review follow-up UI contracts', () => {
  it('gives custom serving amounts their own row above the wrapping unit choices', () => {
    const food = readFileSync('src/components/FoodLoggerCard.tsx', 'utf8');
    expect(food).toContain('<View style={styles.customServingField}>');
    expect(food).toContain('accessibilityLabel="Custom food serving unit"');
    const servingLayout = food.match(/customServingRow: \{([^}]+)\}/)?.[1];
    expect(servingLayout).toBeDefined();
    expect(servingLayout).not.toContain('flexDirection: "row"');
    expect(servingLayout).not.toContain('alignItems: "flex-end"');
  });
  it('marks treatment boundaries as boundaries, not conclusions supported by records', () => {
    const result = classifyTarvisSafety('How much insulin should I take?');
    expect(result.kind).toBe('treatment-advice');
    if (result.kind === 'allow') throw new Error('Unsafe request was allowed');
    expect(result.answer.responseKind).toBe('safety-boundary');
    expect(result.answer.evidenceIds).toEqual([]);
    const screen = readFileSync('src/screens/TarvisScreen.tsx', 'utf8');
    expect(screen).toContain(
      "exchange.answer.responseKind !== 'safety-boundary'",
    );
  });
  it('keeps the focused regional heading once while retaining the standalone card heading', () => {
    expect(readFileSync('src/screens/SourcesScreen.tsx', 'utf8')).toContain(
      '<RegionalSettingsCard showHeading={false} />',
    );
    expect(
      readFileSync('src/components/RegionalSettingsCard.tsx', 'utf8'),
    ).toContain('showHeading = true');
  });
  it('acknowledges imported records without awaiting derived Insights generation', () => {
    const provider = readFileSync('src/providers/DataProvider.tsx', 'utf8');
    for (const [start, end] of [
      ['importGlookoData', 'importGlookoReport'],
      ['importGlookoReport', 'importDexcomData'],
      ['importDexcomData', 'importXdrip'],
    ]) {
      const begin = provider.indexOf(`const ${start} =`);
      const finish = provider.indexOf(`const ${end}`, begin + 1);
      const callback = provider.slice(
        begin,
        finish > begin ? finish : provider.indexOf('\n  const ', begin + 1),
      );
      expect(callback).toContain('requestPostCommitInsightRefresh(writeLease');
      expect(callback).not.toContain('await generateInsightReviewIfDue');
    }
  });
});
