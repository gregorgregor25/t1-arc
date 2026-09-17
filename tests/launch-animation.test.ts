import { describe, expect, it } from 'vitest';
import { launchFrame } from '@/domain/launchAnimation';

describe('cold-launch orbit presentation', () => {
  it('moves particles from behind the logo into the foreground before settling behind it', () => {
    expect(launchFrame(.01).particles.every(dot => !dot.front)).toBe(true);
    expect(launchFrame(.27).particles.every(dot => dot.front)).toBe(true);
    expect(launchFrame(.84).particles.every(dot => !dot.front)).toBe(true);
  });

  it('holds the completed arc stationary before fading to the actual app', () => {
    expect(launchFrame(.81).particles).toEqual(launchFrame(.90).particles);
    expect(launchFrame(.9).opacity).toBe(1);
    expect(launchFrame(1).opacity).toBe(0);
  });

  it('stays inside its drawing area with valid bounded alpha throughout the sequence', () => {
    for (let i = 0; i <= 100; i++) {
      for (const dot of launchFrame(i / 100).particles) {
        expect(dot.x - dot.radius).toBeGreaterThanOrEqual(0);
        expect(dot.x + dot.radius).toBeLessThanOrEqual(280);
        expect(dot.y - dot.radius).toBeGreaterThanOrEqual(0);
        expect(dot.y + dot.radius).toBeLessThanOrEqual(280);
        expect(dot.opacity).toBeGreaterThanOrEqual(0);
        expect(dot.opacity).toBeLessThanOrEqual(1);
      }
    }
  });
});
