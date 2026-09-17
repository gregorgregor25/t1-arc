import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = '.render/food-refresh/food-source.mp4';
const heldFrame = '.render/food-refresh/selected.png';
const output = 'public/captures/food-refresh.mp4';
// Android records sparse VFR frames during still UI. Normalise BEFORE trimming,
// otherwise the last source frame's long duration can spill over an edit point.
const filter = '[0:v]fps=60,split=2[s0][s1];' +
  '[s0]trim=start_frame=0:end_frame=360,setpts=PTS-STARTPTS,pad=1080:2404:0:2:color=0x101117[a];' +
  '[s1]trim=start_frame=840:end_frame=1020,setpts=PTS-STARTPTS,pad=1080:2404:0:2:color=0x101117[b];' +
  '[1:v]trim=end_frame=300,setpts=PTS-STARTPTS,pad=1080:2404:0:2:color=0x101117[c];' +
  '[a][b][c]concat=n=3:v=1:a=0[v]';
if (!process.argv.includes('--manifest-only')) execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-loop', '1', '-framerate', '60', '-i', heldFrame, '-filter_complex', filter, '-map', '[v]', '-frames:v', '840', '-r', '60', '-c:v', 'libx264', '-threads', '4', '-preset', 'fast', '-crf', '16', '-pix_fmt', 'yuv420p', output], { cwd: root, stdio: 'inherit' });
const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', output], { cwd: root, encoding: 'utf8' })).streams[0];
assert.equal(Number(info.nb_frames), 840); assert.equal(Number(info.duration), 14);
assert.equal(info.width, 1080); assert.equal(info.height, 2404);
const sha = file => createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex');
writeFileSync(resolve(root, '.render/food-refresh/capture-provenance.json'), JSON.stringify({
  capturedAt: '2026-09-08', target: 'emulator-5554', androidUser: 12, appVersion: '1.7.1', appVersionCode: 28,
  originalDimensions: [1080, 2400], fittedDimensions: [1080, 2404], fitting: 'Two padding pixels top and bottom; no stretching or app-pixel alteration',
  syntheticProfile: true, food: 'Oats, raw', sourceProvider: 'USDA FoodData Central', mealSaved: false, draftDiscarded: true,
  edit: [{ outputSeconds: [0, 6], sourceSeconds: [0, 6] }, { outputSeconds: [6, 9], sourceSeconds: [14, 17] }, { outputSeconds: [9, 14], actualScreenshot: heldFrame }],
  note: 'Edited demonstration, not continuous interaction or a latency benchmark. Final still records an actual half-cup draft: 27.1g carbs,152kcal. No invented or AI-generated app frames.',
  source, sourceSha256: sha(source), heldFrame, heldFrameSha256: sha(heldFrame), output, outputSha256: sha(output),
  restored: { foregroundUser: 0, appTheme: 'system', nightMode: 'custom_bedtime', stylusHandwritingEnabled: null, rotation: 'free', fontScale: 1 },
}, null, 2));
