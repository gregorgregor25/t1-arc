import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('optional metric personalisation affordances', () => {
  it('keeps editing opt-in with a recoverable all-hidden health view', () => {
    const today = readFileSync('src/components/TodayGlanceCard.tsx', 'utf8');
    const health = readFileSync('src/components/HealthMetricCards.tsx', 'utf8');
    expect(today).toContain('useState(false)');
    expect(today).toContain('Edit your at a glance priorities');
    expect(health).toContain('useState(false)');
    expect(health).toContain('Your records are still here');
    expect(health).toContain('Show all sections');
    expect(health).toContain('hiddenHealthMetrics: []');
  });

  it('provides visible reorder controls, screen-reader states, reduced motion and Android back', () => {
    const sheet = readFileSync('src/components/MetricPreferencesSheet.tsx', 'utf8');
    expect(sheet).toContain('onRequestClose={onClose}');
    expect(sheet).toContain('Cancel display changes');
    expect(sheet).toContain('useReducedMotion');
    expect(sheet).toContain('accessibilityRole="checkbox"');
    expect(sheet).toContain('accessibilityState={{ checked, disabled: saving }}');
    expect(sheet).toContain('minWidth: 48');
    expect(sheet).toContain('minHeight: 48');
    expect(sheet).toContain('arrow-up');
    expect(sheet).toContain('arrow-down');
    expect(sheet).toContain('Save choices');
  });
});
