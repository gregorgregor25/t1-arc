import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const faces = ['meridian', 'chronograph', 'atelier', 'pace', 'summit'];
const xml = (id: string) => readFileSync('wear/watchface-' + id + '/src/main/res/raw/watchface.xml', 'utf8');

describe('five-face resource contract', () => {
  it('keeps generated resources reproducible and reviewable', () => {
    expect(() => execFileSync(process.execPath, ['scripts/generate-watch-face-resources.mjs', '--check'],
      { cwd: process.cwd(), stdio: 'pipe' })).not.toThrow();
    for (const id of faces.slice(2)) expect(xml(id).split('\n').length).toBeGreaterThan(50);
  });

  it.each(faces)('%s supplies units/freshness and never prints a fixed current status', (id) => {
    const source = xml(id);
    expect(source).toContain('T1ArcWatchFaceGlucoseComplicationService');
    expect(source).toContain('[COMPLICATION.TITLE]');
    // Value, arrow, units and freshness must be rendered by a single snapshot.
    // Independent value/status providers can briefly disagree during updates.
    expect(source.match(/T1ArcWatchFaceGlucoseComplicationService/g)).toHaveLength(1);
    expect(source).not.toContain('T1ArcOpticalGlucoseComplicationService');
    expect(source).not.toMatch(/>\s*CURRENT\s*</);
    expect(source).not.toMatch(/>\s*(mmol\/L|mg\/dL)\s*</);
    expect(source).toContain('mode="AMBIENT"');
  });

  it.each(faces)('%s has exactly one real picker image resource', (id) => {
    const info = readFileSync('wear/watchface-' + id + '/src/main/res/xml/watch_face_info.xml', 'utf8');
    const previews = [...info.matchAll(/<Preview\s+value="@drawable\/([a-z_]+)"\s*\/>/g)];
    expect(previews).toHaveLength(1);
    expect(existsSync('wear/watchface-' + id + '/src/main/res/drawable-nodpi/' + previews[0]![1] + '.png')).toBe(true);
  });

  it('separates accent customisation from health colours and turns off decorative layers in AOD', () => {
    for (const id of faces.slice(2)) {
      const source = xml(id);
      expect(source).toContain('ColorConfiguration id="accent"');
      expect(source).toContain('COMPLICATION.RANGED_VALUE_VALUE');
      expect(source).toContain('#FF69D5AC');
      expect(source).toContain('name="glucose_ambient"');
      expect(source).toContain('backgroundColor="#FF000000"');
      expect(source).not.toContain('HEART_RATE');
    }
  });

  it('keeps the complete Atelier hand sweep above the glucose window', () => {
    const layout = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
      "import { atelierLayout } from './wear/designs/atelier.mjs'; process.stdout.write(JSON.stringify(atelierLayout));"],
    { cwd: process.cwd(), encoding: 'utf8' }));
    expect(layout.centerY + Math.max(layout.hour, layout.minute, layout.second)).toBeLessThan(layout.glucoseY - 3);
  });

  it('uses one native Meridian clock with the watch clock preferences', () => {
    const source = xml('meridian');
    expect(source.match(/<TimeText /g)).toHaveLength(1);
    expect(source).toContain('hourFormat="SYNC_TO_DEVICE"');
    expect(source).toContain('<Variant mode="AMBIENT" target="y" value="28"/>');
  });

  it('keeps Chronograph analogue in ambient without the bitmap-clock midnight rendering path', () => {
    const source = xml('chronograph');
    const activeHands = source.split('name="active_hand_artwork"')[1]!.split('<!-- Minute-paced')[0]!;
    expect(activeHands).toContain('<Variant mode="AMBIENT" target="alpha" value="0"/>');
    expect(activeHands).toContain('resource="chronograph_hour_hand"');
    const ambientHands = source.split('name="ambient_hand_outlines"')[1]!.split('<ComplicationSlot')[0]!;
    expect(ambientHands).toContain('<Variant mode="AMBIENT" target="alpha" value="255"/>');
    expect(ambientHands).toContain('[HOUR_0_11_MINUTE] * 30');
    expect(ambientHands).toContain('[MINUTE] * 6');
    expect(ambientHands.match(/<Line /g)).toHaveLength(8);
    expect(ambientHands).not.toContain('[SECOND]');
    expect(ambientHands).not.toContain('<AnalogClock');
  });

  it('shows real synthetic screenshots in each unit and decimal format', () => {
    const preview = readFileSync('src/components/WatchFacePreview.tsx', 'utf8');
    expect(preview).not.toContain('react-native-svg');
    expect(preview).toContain('not live glucose');
    expect(preview).toContain('>EXAMPLE</Text>');
    for (const id of faces) {
      for (const format of ['mmol', 'comma', 'mgdl']) {
        const path = 'assets/watch-faces/' + id + '-' + format + '.png';
        expect(preview).toContain(path);
        expect(readFileSync(path).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      }
    }
  });

  it('does not draw an unlabelled fallback graph when its unit context is missing', () => {
    const provider = readFileSync('wear/companion/src/main/java/io/github/gregorgregor25/t1arc/wear/complication/T1ArcGraphComplicationService.kt', 'utf8');
    expect(provider).toContain('if (snapshot == null || history.isEmpty()) return NoDataComplicationData()');
  });

  it('ships exactly the new collection in the bundled catalog and release assets', () => {
    const generator = readFileSync('scripts/prepare-watch-face-catalog.mjs', 'utf8');
    expect(generator).toContain("['meridian', 'chronograph', 'atelier', 'pace', 'summit']");
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
    for (const id of faces) expect(workflow).toContain(':watchface-' + id + ':assembleRelease');
    expect(workflow).not.toContain('watchface-orbit');
    expect(workflow).not.toContain('T1-Arc-Orbit');
  });
});
