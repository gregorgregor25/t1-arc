import assert from 'node:assert/strict';

export const FPS = 30;
export const FORMATS = {
  landscape: { width: 1920, height: 1080, screen: { x: 1234, y: 76, width: 468, height: 920 } },
  portrait: { width: 1080, height: 1920, screen: { x: 206, y: 452, width: 668, height: 1314 } },
};
export function validateEdit(edit) {
  assert.equal(edit.approvedRealCaptures, true, 'Real captures require documented owner approval');
  assert.ok(Array.isArray(edit.scenes) && edit.scenes.length > 0);
  const ids = new Set();
  for (const scene of edit.scenes) {
    assert.match(scene.id, /^[a-z0-9-]+$/);
    assert.ok(!ids.has(scene.id), 'Unique scene ID'); ids.add(scene.id);
    assert.ok(Number.isFinite(scene.duration) && scene.duration > 0);
    assert.equal(Math.round(scene.duration * FPS), scene.duration * FPS);
    assert.ok(typeof scene.source === 'string' && scene.source.endsWith('.mp4'));
    assert.ok(Number.isFinite(scene.in) && scene.in >= 0);
    assert.ok(scene.title && scene.eyebrow && scene.provenance);
    assert.ok(!JSON.stringify([scene.title, scene.detail, scene.note, scene.quote]).includes('\u2014'), 'No editorial em dashes');
    assert.ok(!/demo data|example data/i.test(JSON.stringify(scene)), 'Do not mislabel real captures');
  }
  return edit;
}
export const durationOf = edit => edit.scenes.reduce((sum, scene) => sum + scene.duration, 0);
