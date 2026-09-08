import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { FACE_IDS } from './storyboard.mjs';

const phoneScreens = ['tarv1s', 'today', 'history', 'health', 'food'];
const files = [];
for (const id of [...phoneScreens, ...FACE_IDS]) {
  const png = await readFile(new URL(`assets/${id}.png`, import.meta.url));
  if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`Not a PNG: ${id}`);
  files.push({ file: `${id}.png`, width: png.readUInt32BE(16), height: png.readUInt32BE(20),
    bytes: png.length, sha256: createHash('sha256').update(png).digest('hex'),
    source: phoneScreens.includes(id) ? 'Android 17 emulator, isolated demo profile' : 'Wear OS 6 emulator, synthetic complication fixture',
    synthetic: true,
  });
}
await writeFile(new URL('assets/provenance.json', import.meta.url), JSON.stringify({
  capturedOn: '2026-09-07', phoneVersion: '1.7.1 (28), private-test candidate',
  watchFaceVersion: '0.3.0 (3), private-test candidate', personalData: false,
  method: 'Unmodified adb screencap PNGs mapped onto original procedural 3D geometry.',
  phoneData: 'Built-in example repository in a fresh emulator profile. No connected accounts or AI key.',
  foodData: 'Demo yoghurt bowl is a fictional custom food: 100 g, 24 g carbohydrate, 210 kcal, 12 g protein, 7 g fat. Not nutrition reference data.',
  watchData: 'Separate synthetic capture session, 6.8 mmol/L with current status. Times and step totals are not a live paired-device session.',
  aiContent: 'The real Tarv1s home screen is shown. No AI answer or medical outcome is fabricated.',
  files,
}, null, 2) + '\n');
console.log(`Recorded provenance and SHA-256 for ${files.length} synthetic screenshots.`);
