import { describe, expect, it } from 'vitest';

import {
  evidenceRequestedPeriodLabel,
  evidenceTimeZoneLabel,
} from '@/domain/evidenceTimeZonePresentation';

describe('evidence timezone presentation', () => {
  it.each(['America/New_York', 'Asia/Tokyo'])(
    'shows the selected %s timezone without a London fallback',
    (timeZone) => {
      expect(evidenceTimeZoneLabel(timeZone)).toBe(timeZone);
      expect(evidenceRequestedPeriodLabel(timeZone)).toBe(
        `EXACT REQUESTED PERIOD · ${timeZone}`,
      );
    },
  );
});
