import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Wear tile graph launch', () => {
  it('exports the read-only graph destination required by the system tile renderer', () => {
    const manifest = readFileSync('wear/companion/src/main/AndroidManifest.xml', 'utf8');
    const activity = manifest.match(/<activity\s+android:name="\.GraphActivity"[\s\S]*?\/>/)?.[0];
    expect(activity).toContain('android:exported="true"');
    const tile = readFileSync('wear/companion/src/main/java/io/github/gregorgregor25/t1arc/wear/tile/T1ArcGlucoseTileService.kt', 'utf8');
    expect(tile).toContain('GraphActivity::class.java');
    const graph = readFileSync('wear/companion/src/main/java/io/github/gregorgregor25/t1arc/wear/GraphActivity.kt', 'utf8');
    // Launching displays the locally owned graph; external intents cannot import
    // records or choose a different dataset through this exported entry point.
    expect(graph).not.toMatch(/get\w*Extra|intent\.data|setResult\(/);
  });
});
