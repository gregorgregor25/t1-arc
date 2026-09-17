import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { atelier } from '../wear/designs/atelier.mjs';
import { pace } from '../wear/designs/pace.mjs';
import { summit } from '../wear/designs/summit.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const manifest = readFileSync(resolve(root, 'wear/watchface-meridian/src/main/AndroidManifest.xml'), 'utf8');
const build = readFileSync(resolve(root, 'wear/watchface-meridian/build.gradle'), 'utf8');
function readableXml(xml) {
  let depth = 0;
  return xml.replaceAll('><', '>\n<').trim().split('\n').map((line) => {
    const indentation = depth - (line.startsWith('</') ? 1 : 0);
    depth += (line.match(/<(?!!|\/|\?)[A-Za-z]/g) ?? []).length -
      (line.match(/\/>|<\/[A-Za-z]/g) ?? []).length;
    return '    '.repeat(Math.max(0, indentation)) + line;
  }).join('\n') + '\n';
}
function output(relative, value) {
  const target = resolve(root, relative);
  if (!target.startsWith(root + '/wear/') && !target.startsWith(root + '\\wear\\')) {
    throw new Error('Generated resource is outside wear/');
  }
  if (check) {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== value) throw new Error('Outdated generated file: ' + relative);
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, value, 'utf8');
  }
}
const named = { atelier, pace, summit };
for (const [id, design] of Object.entries(named)) {
  const base = 'wear/watchface-' + id;
  const name = id[0].toUpperCase() + id.slice(1);
  output(base + '/src/main/res/raw/watchface.xml', readableXml(design()));
  output(base + '/src/main/AndroidManifest.xml', manifest);
  output(base + '/build.gradle', build.replaceAll('meridian', id).replace("versionCode 2", "versionCode 3")
    .replace("versionName '0.2.0'", "versionName '0.3.0'") +
    (id === 'pace' ? '' : "\napply from: rootProject.file('../scripts/gradle/t1arc-watchface-artwork.gradle')\n"));
  output(base + '/src/main/res/values/strings.xml', '<resources>\n' +
    '    <string name="watch_face_name">T1 Arc ' + name + '</string>\n' +
    '    <string name="glucose_slot_label">T1 Arc glucose</string>\n' +
    '    <string name="graph_slot_label">Glucose history</string>\n' +
    '    <string name="secondary_slot_label">Secondary data</string>\n' +
    '    <string name="accent_label">Dial accent</string>\n' +
    '    <string name="accent_silver">Silver</string>\n' +
    '    <string name="accent_champagne">Champagne</string>\n' +
    '    <string name="accent_lime">Lime</string>\n' +
    '    <string name="accent_amber">Amber</string>\n</resources>\n');
  // Picker images are actual synthetic emulator captures, reviewed separately.
  output(base + '/src/main/res/xml/watch_face_info.xml', '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<WatchFaceInfo>\n    <Preview value="@drawable/' + id + '_picker_preview" />\n    <Category value="CATEGORY_HEALTH" />\n' +
    '    <AvailableInRetail value="false" />\n    <MultipleInstancesAllowed value="true" />\n' +
    '    <Editable value="true" />\n</WatchFaceInfo>\n');
}
console.log((check ? 'Checked' : 'Generated') + ' Atelier, Pace and Summit WFF resources.');
