import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAPTERS, DURATION, FPS, FACE_IDS, FACE_NAMES, chapterAt, boundedTime, smooth } from '../storyboard.mjs';

test('the whole film has continuous, non-overlapping chapters', () => {
  assert.equal(CHAPTERS[0].start, 0);
  assert.equal(CHAPTERS.at(-1).end, DURATION);
  assert.equal(DURATION * FPS, 1380);
  CHAPTERS.forEach((chapter, index) => {
    assert.ok(chapter.end > chapter.start);
    if (index) assert.equal(chapter.start, CHAPTERS[index - 1].end);
    assert.equal(chapterAt(chapter.start).id, chapter.id);
    assert.equal(chapterAt(chapter.end - .001).id, chapter.id);
  });
});

test('the five-face collection excludes the retired design', () => {
  assert.deepEqual(FACE_IDS, ['meridian', 'chronograph', 'atelier', 'pace', 'summit']);
  assert.equal(new Set(FACE_NAMES).size, 5);
  assert.equal(FACE_NAMES.length, FACE_IDS.length);
});

test('out-of-range and invalid seek times are deterministic', () => {
  assert.equal(boundedTime(-100), 0);
  assert.equal(boundedTime(100), DURATION);
  for (const invalid of [NaN, Infinity, undefined, null]) assert.equal(boundedTime(invalid), 0);
  assert.equal(chapterAt(-1).id, 'tarv1s');
  assert.equal(chapterAt(NaN).id, 'tarv1s');
  assert.equal(chapterAt(DURATION).id, 'closing');
});

test('motion easing is bounded, monotonic and stationary at endpoints', () => {
  assert.equal(smooth(-1), 0);
  assert.equal(smooth(2), 1);
  let previous = 0;
  for (let i = 0; i <= 100; i++) {
    const next = smooth(i / 100);
    assert.ok(next >= previous && next <= 1);
    previous = next;
  }
  assert.ok(smooth(.0001) < .000001);
  assert.ok(1 - smooth(.9999) < .000001);
});

test('public captions retain BYOK and treatment boundaries without release claims', () => {
  const copy = JSON.stringify(CHAPTERS);
  assert.match(copy, /your own OpenAI key/);
  assert.match(copy, /not treatment instructions/);
  assert.match(copy, /Availability varies/);
  assert.doesNotMatch(copy, /\u2014|download now|available now|clinically proven|live AI response/i);
});
