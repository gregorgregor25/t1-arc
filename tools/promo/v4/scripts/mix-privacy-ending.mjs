import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { root, source, output, edition } from "./narration-paths.mjs";

assert.equal(edition, "privacy", "Set T1ARC_NARRATION_EDITION=privacy");
const previous = join(root, "out", "narration-mixed");
const oldMix = join(previous, "T1-Arc-voice-and-Signal-Drift-90s.wav");
const oldVoice = join(previous, "T1-Arc-George-British-AI-narration-90s.wav");
const closing = join(source, "closing-narration-90s.wav");
const cueReport = JSON.parse(
  readFileSync(join(source, "closing-audio-verification.json"), "utf8"),
);
const oldReport = JSON.parse(
  readFileSync(join(previous, "audio-verification.json"), "utf8"),
);
const cue = cueReport.timings[0];
assert.equal(cue.start, 80.6);
assert.ok(cue.end < 88);
const sound = join(output, "T1-Arc-voice-and-Signal-Drift-90s.wav");
const voice = join(output, "T1-Arc-George-British-AI-narration-90s.wav");
function run(binary, args) {
  return execFileSync(binary, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}
function ffmpeg(args) {
  return run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
}
function measure(file, start = 0, length = 90) {
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-ss",
      String(start),
      "-i",
      file,
      "-t",
      String(length),
      "-af",
      "loudnorm=I=-16:LRA=8:TP=-1.5:print_format=json",
      "-f",
      "null",
      "-",
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(result.status, 0);
  return JSON.parse(result.stderr.match(/\{\s*"input_i"[\s\S]*?\}/)[0]);
}
const duckStart = cue.start - 0.33,
  releaseEnd = cue.end + 1.12;
// The old final mix contains only music after 80s. Apply extra ducking to that
// tail so its original fade, EQ and musical position are retained exactly.
const db = `if(lt(t,${duckStart}),0,if(lt(t,${cue.start}),-10*(t-${duckStart})/.33,if(lt(t,${cue.end}),-10,if(lt(t,${releaseEnd}),-10*(1-(t-${cue.end})/1.12),0))))`;
ffmpeg([
  "-i",
  oldMix,
  "-i",
  closing,
  "-filter_complex",
  `[0:a]volume='pow(10,(${db})/20)':eval=frame[music];[1:a]pan=stereo|c0=0.70710678*c0|c1=0.70710678*c0[voice];[music][voice]amix=inputs=2:normalize=0,atrim=end=90[mix]`,
  "-map",
  "[mix]",
  "-ar",
  "48000",
  "-ac",
  "2",
  "-c:a",
  "pcm_s24le",
  sound,
]);
ffmpeg([
  "-i",
  oldVoice,
  "-i",
  closing,
  "-filter_complex",
  "[0:a][1:a]amix=inputs=2:normalize=0,atrim=end=90[voice]",
  "-map",
  "[voice]",
  "-ar",
  "48000",
  "-ac",
  "1",
  "-c:a",
  "pcm_s24le",
  voice,
]);
for (const [file, title] of [
  [sound, "T1 Arc privacy edition - George and Signal Drift"],
  [voice, "T1 Arc privacy edition - AI narration by George"],
]) {
  ffmpeg([
    "-i",
    file,
    "-c:a",
    "libmp3lame",
    "-b:a",
    "256k",
    "-metadata",
    `title=${title}`,
    file.replace(".wav", ".mp3"),
  ]);
}
function pcmPrefixHash(file) {
  return ffmpeg([
    "-i",
    file,
    "-t",
    "80",
    "-map",
    "0:a:0",
    "-c:a",
    "pcm_s24le",
    "-f",
    "hash",
    "-hash",
    "sha256",
    "-",
  ]).trim();
}
const unchangedMixPrefix = pcmPrefixHash(oldMix);
assert.equal(
  pcmPrefixHash(sound),
  unchangedMixPrefix,
  "Earlier mix samples changed",
);
assert.equal(
  pcmPrefixHash(voice),
  pcmPrefixHash(oldVoice),
  "Earlier narration samples changed",
);
const oldCaptions = JSON.parse(
  readFileSync(join(previous, "captions.json"), "utf8"),
);
const newCaptions = JSON.parse(
  readFileSync(join(source, "closing-captions.json"), "utf8"),
);
const captions = [...oldCaptions, ...newCaptions];
writeFileSync(join(output, "captions.json"), JSON.stringify(captions, null, 2));
function timestamp(ms, separator) {
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}${separator}${String(ms % 1000).padStart(3, "0")}`;
}
// Preserve the earlier subtitle files byte-for-byte, then append aligned cues.
const wrap = (text) =>
  text === "Your health history is stored on your phone."
    ? "Your health history is stored\non your phone."
    : text;
for (const extension of ["srt", "vtt"]) {
  const name = `T1-Arc-George-narration.${extension}`;
  const original = readFileSync(join(previous, name), "utf8").trimEnd();
  const addition = newCaptions
    .map(
      (caption, i) =>
        `${extension === "srt" ? `${oldCaptions.length + i + 1}\n` : ""}${timestamp(caption.startMs, extension === "srt" ? "," : ".")} --> ${timestamp(caption.endMs, extension === "srt" ? "," : ".")}\n${wrap(caption.text)}\n`,
    )
    .join("\n");
  writeFileSync(join(output, name), `${original}\n\n${addition}`);
}
const finalLoudness = measure(sound);
assert.ok(Number(finalLoudness.input_tp) < -1);
assert.ok(Math.abs(Number(finalLoudness.input_i) + 16) < 1);
const voiceTimings = [...oldReport.timings, cue];
const speechLevels = voiceTimings.map((timing) => ({
  id: timing.id,
  ...measure(voice, timing.start, timing.duration),
}));
const priorLevels = speechLevels
  .slice(0, -1)
  .map((level) => Number(level.input_i));
assert.ok(
  Number(speechLevels.at(-1).input_i) >= Math.min(...priorLevels) - 1 &&
    Number(speechLevels.at(-1).input_i) <= Math.max(...priorLevels) + 1,
  "Closing speech is outside earlier speech level range",
);
writeFileSync(
  join(output, "audio-verification.json"),
  JSON.stringify(
    {
      ...oldReport,
      timings: voiceTimings,
      spokenClipSeconds: oldReport.spokenClipSeconds + cue.duration,
      closing: cueReport,
      finalLoudness: measure(voice),
    },
    null,
    2,
  ),
);
writeFileSync(
  join(output, "mix-verification.json"),
  JSON.stringify(
    {
      durationSeconds: 90,
      sampleRate: 48000,
      channels: 2,
      voiceTimings,
      closingNarrationOnlyGenerated: true,
      narrationSpeed: 1,
      musicSpeed: 1,
      extraSoundEffects: false,
      originalMixFirst80SecondsPcmSha256: unchangedMixPrefix,
      earlierMixSamplesUnchanged: true,
      earlierVoiceSamplesUnchanged: true,
      earlierCaptionsUnchanged: true,
      duckDb: -10,
      duckStart,
      duckReleaseEnd: releaseEnd,
      musicFadeOutSeconds: [85.5, 90],
      finalLoudness,
      speechLevels,
      publication: "Local only, not published or transferred to a device.",
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    {
      output,
      finalLoudness,
      speechLevels: speechLevels.map((level) => ({
        id: level.id,
        lufs: level.input_i,
      })),
      unchangedMixPrefix,
    },
    null,
    2,
  ),
);
