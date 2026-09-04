import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';

const logger = readFileSync(
  fileURLToPath(new URL('../src/components/FoodLoggerCard.tsx', import.meta.url)),
  'utf8',
);

describe('food save interaction boundary', () => {
  it('does not open an encrypted writer transaction solely for React state', () => {
    expect(logger).not.toContain('withLocalDataWriteLeaseTransaction');
  });

  it('still verifies the privacy write epoch before acknowledging persistence', () => {
    expect(logger).toContain('assertLocalDataWriteLeaseCurrent(writeLease)');
    expect(logger.indexOf('await logFood(draft, writeLease)')).toBeLessThan(
      logger.lastIndexOf('assertLocalDataWriteLeaseCurrent(writeLease)'),
    );
  });
});
