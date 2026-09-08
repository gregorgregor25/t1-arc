import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  root,
  source,
  output,
  scriptFile,
  edition,
} from "./narration-paths.mjs";
assert.equal(edition, "privacy");
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const config = readJson(scriptFile);
const oldConfig = readJson(join(root, "narration", "script-mixed.json"));
assert.deepEqual(config.voiceSettings, oldConfig.voiceSettings);
assert.deepEqual(config.voices, oldConfig.voices);
assert.equal(config.cues.length, 1);
assert.equal(
  config.cues[0].phrases.map((phrase) => phrase.text).join(" "),
  "T1 Arc is open source. Your health history is stored on your phone. We don’t collect your health data.",
);
const captions = readJson(join(output, "captions.json"));
const oldCaptions = readJson(
  join(root, "out", "narration-mixed", "captions.json"),
);
assert.deepEqual(captions.slice(0, oldCaptions.length), oldCaptions);
assert.equal(
  captions
    .slice(oldCaptions.length)
    .map((caption) => caption.text)
    .join(" "),
  config.cues[0].phrases.map((phrase) => phrase.text).join(" "),
);
for (const [i, caption] of captions.entries()) {
  assert.ok(caption.startMs < caption.endMs);
  assert.ok(caption.startMs >= (captions[i - 1]?.endMs ?? 0));
  assert.ok(caption.endMs < 88000);
}
const mix = readJson(join(output, "mix-verification.json"));
assert.equal(mix.earlierMixSamplesUnchanged, true);
assert.equal(mix.earlierVoiceSamplesUnchanged, true);
assert.equal(mix.narrationSpeed, 1);
assert.equal(mix.musicSpeed, 1);
assert.equal(mix.voiceTimings.at(-1).start, 80.6);
assert.ok(mix.voiceTimings.at(-1).end < 88);
assert.deepEqual(
  mix.voiceTimings.slice(0, -1),
  readJson(join(root, "out", "narration-mixed", "audio-verification.json"))
    .timings,
);
for (const kind of ["", "mixed-"]) {
  const review = readJson(
    join(source, `speech-review-${kind}closing-privacy.json`),
  )[0];
  const normalized = review.transcript.toLowerCase().replace(/[^a-z0-9]/g, "");
  assert.equal(
    normalized,
    "t1arcisopensourceyourhealthhistoryisstoredonyourphonewedontcollectyourhealthdata",
  );
}
const protectedFiles = [
  [
    "out/T1-Arc-V4-full-landscape-4K.mp4",
    "20814b0a9b7a1bb109c0886453bd7c27930c1f5f1a29659cfdae713bccbdc4dc",
  ],
  [
    "out/T1-Arc-V4-full-portrait-4K.mp4",
    "7971ea8ccf14ac69b444502a7d6c32d2781892c5aed5f866f30a8cbf42d46ef9",
  ],
  [
    "out/narration/T1-Arc-landscape-George-AI-narration-review.mp4",
    "94a956e65825b8d37a5286753b0e6a714a8d4f06dbe879c5b03c45889e87e320",
  ],
  [
    "out/narration/T1-Arc-portrait-George-AI-narration-review.mp4",
    "8c7b5fb3b85b4d9edc36976bc3e3af69797714d9817087727bb8a3a32f938f02",
  ],
  [
    "out/narration-mixed/T1-Arc-landscape-4K-narration-and-music.mp4",
    "415254dd141a8922071dc6d73d02c692a82cae5a8f766b0c867e48c3a25e8712",
  ],
  [
    "out/narration-mixed/T1-Arc-portrait-4K-narration-and-music.mp4",
    "65d7bfcf0282f83871e713a58393854abd044c009ec9022f43428aa6e8bce3ad",
  ],
  [
    "out/narration-mixed/T1-Arc-landscape-sharing-narration-and-music.mp4",
    "7b30aa0f6d1916d4ce0dd06d0baca8af986414fd09657040ad47e2ffa5c37023",
  ],
  [
    "out/narration-mixed/T1-Arc-portrait-sharing-narration-and-music.mp4",
    "c5109a83841dc8f935a37ad56b25b5dc02422bbb88b3f3a7646fc37f261849ff",
  ],
];
for (const [file, hash] of protectedFiles)
  assert.equal(
    createHash("sha256")
      .update(readFileSync(join(root, file)))
      .digest("hex"),
    hash,
    `${file} changed`,
  );
for (const format of ["landscape", "portrait"]) {
  const reports = readJson(join(output, `${format}-video-verification.json`));
  assert.equal(reports.length, 2);
  for (const report of reports) {
    assert.equal(report.frames, 5400);
    assert.equal(report.fps, "60/1");
    assert.equal(report.duration, 90);
    assert.equal(report.completeDecode, "passed");
    assert.equal(report.earlier4800VideoBitstreamAndTimestampsUnchanged, true);
    assert.equal(report.embeddedCaptionsMatch, true);
    assert.ok(report.maximumTimestampError < 0.000002);
    assert.ok(Number(report.loudness.input_tp) < -1);
    assert.equal(
      createHash("sha256").update(readFileSync(report.file)).digest("hex"),
      report.sha256,
    );
  }
}
console.log(
  "PASS: privacy wording, same George settings, one new cue, natural timing, clean/mixed transcripts, earlier audio/captions and encoded video unchanged, four complete 4K60/sharing exports, eight preserved earlier videos.",
);
