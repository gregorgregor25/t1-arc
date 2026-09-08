import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { FACE_IDS } from '../storyboard.mjs';

test('every frame input has reviewed synthetic provenance and an exact hash', async () => {
  const manifest = JSON.parse(await readFile(new URL('../assets/provenance.json', import.meta.url)));
  assert.equal(manifest.personalData, false);
  const expected = ['tarv1s', 'today', 'history', 'health', 'food', ...FACE_IDS].map(id => `${id}.png`).sort();
  assert.deepEqual(manifest.files.map(file => file.file).sort(), expected);
  const present = (await readdir(new URL('../assets/', import.meta.url))).filter(file => file.endsWith('.png')).sort();
  assert.deepEqual(present, expected);
  for (const record of manifest.files) {
    const png = await readFile(new URL(`../assets/${record.file}`, import.meta.url));
    assert.equal(record.synthetic, true);
    assert.equal(png.length, record.bytes);
    assert.equal(createHash('sha256').update(png).digest('hex'), record.sha256);
    assert.equal(png.readUInt32BE(16), record.width);
    assert.equal(png.readUInt32BE(20), record.height);
    assert.ok(record.width >= 384);
  }
});
