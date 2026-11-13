import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { USAGE_REPORTING_COPY } from '@/domain/usageReportingCopy';

describe('usage reporting disclosure', () => {
  it('explains the default, the contents, storage and the off switch', () => {
    const hint = USAGE_REPORTING_COPY.settingHint;
    expect(USAGE_REPORTING_COPY.settingLabel).toBe('Share anonymous usage counts');
    expect(hint).toContain('On by default');
    expect(hint).toContain('No health records');
    expect(hint).toContain('not stored');
    expect(hint).toContain('Turning this off');
    expect(hint).toContain('deletes the local activity history');
  });

  it('is shown as a switch in Settings > Privacy, with no prompt or card elsewhere', () => {
    const sources = readFileSync('src/screens/SourcesScreen.tsx', 'utf8');
    const privacy = sources.slice(sources.indexOf('activeSource === "privacy"'));
    expect(privacy).toContain('<UsageReportingCard />');
    const card = readFileSync('src/components/UsageReportingCard.tsx', 'utf8');
    expect(card).toContain('<Switch');
    expect(card).toContain('setUsageConsentAsync');
    expect(card).not.toContain('Modal');
    expect(existsSync('src/components/UsageReportingPrompt.tsx')).toBe(false);
  });
});
