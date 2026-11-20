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

  it('is shown as a switch in Settings > Privacy and in the tour setup step, with no separate prompt', () => {
    const sources = readFileSync('src/screens/settings/SettingsPages.tsx', 'utf8');
    const privacy = sources.slice(sources.indexOf('function BackupPrivacyPage'));
    expect(privacy).toContain('<UsageReportingCard />');
    // New users see the same switch, showing the stored choice, in the tour.
    const tour = readFileSync('src/screens/onboarding/TourSetupPanel.tsx', 'utf8');
    expect(tour).toContain('<UsageReportingCard />');
    const card = readFileSync('src/components/UsageReportingCard.tsx', 'utf8');
    expect(card).toContain('<Switch');
    expect(card).toContain('setUsageConsentAsync');
    expect(card).not.toContain('Modal');
    expect(existsSync('src/components/UsageReportingPrompt.tsx')).toBe(false);
  });
});
