import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root, source, output, scriptFile, edition } from './narration-paths.mjs';

assert.equal(edition, 'mixed');
const script = JSON.parse(readFileSync(scriptFile, 'utf8'));
const captions = JSON.parse(readFileSync(join(output, 'captions.json'), 'utf8'));
const mix = JSON.parse(readFileSync(join(output, 'mix-verification.json'), 'utf8'));
assert.equal(script.cues.length, 7);
assert.equal(script.cues.some(cue => cue.id === 'closing'), false);
assert.equal(captions.map(cue => cue.text).join(' '), script.cues.flatMap(cue => cue.phrases.map(phrase => phrase.text)).join(' '));
for (const [index, caption] of captions.entries()) {
  assert.ok(caption.startMs < caption.endMs);
  assert.ok(caption.startMs >= (captions[index-1]?.endMs ?? 0));
  assert.ok(caption.endMs < 80000);
  assert.ok(caption.text.length <= 80);
}
for (const cue of mix.voiceTimings) assert.ok(cue.end <= cue.latestEnd);
assert.equal(mix.durationSeconds, 90);
assert.equal(mix.extraSoundEffects, false);
assert.equal(mix.musicSpeed, 1);
assert.equal(mix.channels, 2);
assert.ok(Number(mix.finalLoudness.input_tp) < -1);
assert.ok(Math.abs(Number(mix.finalLoudness.input_i) + 16) < 1);
const transcript = JSON.parse(readFileSync(join(source, 'speech-review-mixed.json'), 'utf8'));
assert.equal(transcript.length, 7);
assert.match(transcript.find(cue => cue.cue === 'answer').transcript, /6\.6|six point six/i);
assert.match(transcript.find(cue => cue.cue === 'answer').transcript, /not recommend treatment/i);
assert.match(transcript.find(cue => cue.cue === 'food').transcript, /before you save/i);
const originals = [
  ['out/T1-Arc-V4-full-landscape-4K.mp4', '20814b0a9b7a1bb109c0886453bd7c27930c1f5f1a29659cfdae713bccbdc4dc'],
  ['out/T1-Arc-V4-full-portrait-4K.mp4', '7971ea8ccf14ac69b444502a7d6c32d2781892c5aed5f866f30a8cbf42d46ef9'],
  ['out/narration/T1-Arc-landscape-George-AI-narration-review.mp4', '94a956e65825b8d37a5286753b0e6a714a8d4f06dbe879c5b03c45889e87e320'],
  ['out/narration/T1-Arc-portrait-George-AI-narration-review.mp4', '8c7b5fb3b85b4d9edc36976bc3e3af69797714d9817087727bb8a3a32f938f02'],
];
for (const [file, expected] of originals) assert.equal(createHash('sha256').update(readFileSync(join(root, file))).digest('hex'), expected, `${file} changed`);
for (const format of ['landscape', 'portrait']) {
  const reports = JSON.parse(readFileSync(join(output, `${format}-video-verification.json`), 'utf8'));
  assert.equal(reports.length, 2);
  for (const report of reports) {
    assert.equal(report.completeDecode, 'passed');
    assert.equal(report.frames, 5400);
    assert.equal(report.fps, '60/1');
    assert.ok(report.maximumTimestampError < .000002);
    assert.equal(report.selectableCaptions, true);
    assert.equal(createHash('sha256').update(readFileSync(report.file)).digest('hex'), report.sha256);
  }
}
console.log('PASS: approved script/captions, cue windows, mixed transcript checks, 90s stereo mix, levels, four verified final exports and four unchanged original videos.');
