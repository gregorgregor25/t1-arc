import { afterEach, describe, expect, it } from 'vitest';

import { notificationIobEvidenceRows } from '@/components/notificationIobEvidencePresentation';
import { formatEvidenceClockWindowValue } from '@/domain/evidenceClockWindowChart';
import {
  DEFAULT_REGIONAL_PROFILE,
  resolveRegionalDefaults,
} from '@/domain/regionalProfile';
import { setRuntimeRegionalProfile } from '@/domain/regionalProfileRuntime';
import { timelineInspectorInsulinParts } from '@/domain/timelinePresentation';

afterEach(() => {
  setRuntimeRegionalProfile(DEFAULT_REGIONAL_PROFILE);
});

describe('regional domain presentation', () => {
  it('uses an explicitly supplied French locale in timeline insulin copy', () => {
    const regional = resolveRegionalDefaults({
      ...DEFAULT_REGIONAL_PROFILE,
      languageTag: 'fr-FR',
    });
    expect(
      timelineInspectorInsulinParts({
        basalRateUnitsPerHour: 1.25,
        bolusUnits: 2.5,
        regional,
        showBasal: true,
        showBolus: true,
      }),
    ).toEqual(['Basal 1,25 U/h', 'Bolus 2,5 U']);
  });

  it('uses the active German locale for chart labels and evidence rows', () => {
    setRuntimeRegionalProfile({
      ...DEFAULT_REGIONAL_PROFILE,
      languageTag: 'de-DE',
    });
    expect(formatEvidenceClockWindowValue(7.25, 'mmol/L')).toBe('7,3');
    expect(
      notificationIobEvidenceRows([
        {
          id: 'iob',
          sourceId: 'notification',
          packageName: 'example',
          sourceLabel: 'Pump',
          capturedAt: 123,
          iobUnits: 1.25,
          origin: 'local',
        } as never,
      ])[0]?.iobLabel,
    ).toBe('1,25 U IOB');
  });
});
