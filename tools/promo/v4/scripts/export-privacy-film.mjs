import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { root, source, output, edition } from "./narration-paths.mjs";

assert.equal(edition, "privacy", "Set T1ARC_NARRATION_EDITION=privacy");
const format = process.argv[2];
assert.ok(["landscape", "portrait"].includes(format));
const size = format === "landscape" ? [3840, 2160] : [2160, 3840];
const ending = join(source, `closing-${format}.mp4`);
const sound = join(output, "T1-Arc-voice-and-Signal-Drift-90s.wav");
const captions = join(output, "T1-Arc-George-narration.srt");
function run(binary, args) {
  return execFileSync(binary, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}
function ffmpeg(args) {
  return run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
}
function probe(file, args = ["-show_streams", "-show_format"]) {
  return JSON.parse(
    run("ffprobe", ["-v", "error", ...args, "-of", "json", file]),
  );
}
function packets(file) {
  return probe(file, [
    "-select_streams",
    "v:0",
    "-show_packets",
    "-show_entries",
    "packet=pts_time,dts_time",
  ]).packets;
}
function prefixBitstreamHash(file) {
  // MP4 concatenation repeats SPS/PPS headers at keyframes. Compare both streams
  // in the same Annex-B representation, including all those decoding headers.
  return ffmpeg([
    "-i",
    file,
    "-map",
    "0:v:0",
    "-frames:v",
    "4800",
    "-c:v",
    "copy",
    "-bsf:v",
    "h264_mp4toannexb",
    "-f",
    "hash",
    "-hash",
    "sha256",
    "-",
  ]).trim();
}
const reports = [];
for (const quality of ["4K", "sharing"]) {
  const dimensions = quality === "4K" ? size : size.map((value) => value / 2);
  const original = join(
    root,
    "out",
    "narration-mixed",
    `T1-Arc-${format}-${quality}-narration-and-music.mp4`,
  );
  const file = join(output, `T1-Arc-${format}-${quality}-privacy.mp4`);
  if (!(quality === "4K" && process.argv.includes("--reuse-master"))) {
    const originalInfo = probe(original).streams.find(
      (stream) => stream.codec_type === "video",
    );
    const keyframes = probe(original, [
      "-select_streams",
      "v:0",
      "-skip_frame",
      "nokey",
      "-read_intervals",
      "78%81",
      "-show_frames",
      "-show_entries",
      "frame=pts_time",
    ]).frames;
    assert.ok(
      keyframes.some((frame) => Number(frame.pts_time) === 80),
      "Safe exact 80s video splice requires a keyframe",
    );
    const timescale = Number(originalInfo.time_base.split("/")[1]);
    const prefix = join(source, `${format}-${quality}-prefix.mp4`);
    const tail = join(source, `${format}-${quality}-tail.mp4`);
    console.log(`Preserving ${format} ${quality} first 4,800 encoded frames`);
    ffmpeg([
      "-i",
      original,
      "-map",
      "0:v:0",
      "-frames:v",
      "4800",
      "-c:v",
      "copy",
      "-map_metadata",
      "-1",
      "-video_track_timescale",
      String(timescale),
      prefix,
    ]);
    const prefixInfo = probe(prefix).streams[0];
    assert.equal(Number(prefixInfo.nb_frames), 4800);
    assert.equal(Number(prefixInfo.duration), 80);
    console.log(`Encoding ${format} ${quality} ten-second replacement`);
    ffmpeg([
      "-i",
      ending,
      "-map",
      "0:v:0",
      "-vf",
      `scale=${dimensions[0]}:${dimensions[1]}:flags=lanczos:in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p,setsar=1`,
      "-r",
      "60",
      "-fps_mode:v",
      "cfr",
      "-frames:v",
      "600",
      "-c:v",
      "libx264",
      "-threads",
      "4",
      "-preset",
      "fast",
      "-crf",
      quality === "4K" ? "17" : "19",
      "-color_range",
      "tv",
      "-colorspace",
      "bt709",
      "-color_trc",
      "bt709",
      "-color_primaries",
      "bt709",
      "-video_track_timescale",
      String(timescale),
      "-map_metadata",
      "-1",
      tail,
    ]);
    const list = join(source, `${format}-${quality}-concat.txt`);
    writeFileSync(
      list,
      `file '${prefix.replaceAll("\\", "/").replaceAll("'", "'\\''")}'\nfile '${tail.replaceAll("\\", "/").replaceAll("'", "'\\''")}'\n`,
    );
    ffmpeg([
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      list,
      "-i",
      sound,
      "-i",
      captions,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-map",
      "2:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "320k",
      "-ar",
      "48000",
      "-c:s",
      "mov_text",
      "-disposition:s:0",
      "0",
      "-map_metadata",
      "-1",
      "-metadata:s:s:0",
      "language=eng",
      "-metadata:s:s:0",
      "title=English narration",
      "-metadata",
      "title=T1 Arc - privacy edition - George AI narration - Signal Drift",
      "-metadata",
      "comment=Local review. AI narration: George / elevenlabs.io. Owner-supplied Signal Drift.",
      "-t",
      "90",
      "-video_track_timescale",
      String(timescale),
      "-movflags",
      "+faststart",
      file,
    ]);
  }
  console.log(`Verifying complete ${format} ${quality} export`);
  const info = probe(file),
    video = info.streams.find((stream) => stream.codec_type === "video");
  const audio = info.streams.find((stream) => stream.codec_type === "audio");
  const subtitle = info.streams.find(
    (stream) => stream.codec_type === "subtitle",
  );
  assert.equal(video.width, dimensions[0]);
  assert.equal(video.height, dimensions[1]);
  assert.equal(Number(video.nb_frames), 5400);
  assert.equal(video.avg_frame_rate, "60/1");
  assert.equal(Number(video.duration), 90);
  assert.equal(audio.channels, 2);
  assert.equal(audio.sample_rate, "48000");
  assert.equal(Number(audio.duration), 90);
  assert.equal(Number(audio.start_time), 0);
  assert.equal(subtitle?.codec_name, "mov_text");
  ffmpeg([
    "-xerror",
    "-err_detect",
    "explode",
    "-i",
    file,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0",
    "-f",
    "null",
    "-",
  ]);
  const frames = probe(file, [
    "-select_streams",
    "v:0",
    "-show_frames",
    "-show_entries",
    "frame=best_effort_timestamp_time",
  ]).frames;
  const maximumTimestampError = Math.max(
    ...frames.map((frame, index) =>
      Math.abs(Number(frame.best_effort_timestamp_time) - index / 60),
    ),
  );
  assert.equal(frames.length, 5400);
  assert.ok(maximumTimestampError < 0.000002);
  // Check compressed picture data and both timestamps, not merely visual similarity.
  assert.deepEqual(
    packets(file).slice(0, 4800),
    packets(original).slice(0, 4800),
    "Earlier video payload/timing changed",
  );
  const originalPrefixBitstreamSha256 = prefixBitstreamHash(original);
  assert.equal(
    prefixBitstreamHash(file),
    originalPrefixBitstreamSha256,
    "Earlier compressed video changed",
  );
  const analysis = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-i",
      file,
      "-map",
      "0:a:0",
      "-af",
      "loudnorm=I=-16:LRA=8:TP=-1.5:print_format=json",
      "-f",
      "null",
      "-",
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  assert.equal(analysis.status, 0);
  const loudness = JSON.parse(
    analysis.stderr.match(/\{\s*"input_i"[\s\S]*?\}/)[0],
  );
  assert.ok(Number(loudness.input_tp) < -1);
  assert.ok(Math.abs(Number(loudness.input_i) + 16) < 1);
  const extracted = join(source, `${format}-${quality}-embedded.srt`);
  ffmpeg(["-i", file, "-map", "0:s:0", extracted]);
  assert.equal(
    readFileSync(extracted, "utf8").replaceAll("\r\n", "\n").trim(),
    readFileSync(captions, "utf8").replaceAll("\r\n", "\n").trim(),
    "Embedded subtitle text/timing changed",
  );
  reports.push({
    file,
    width: video.width,
    height: video.height,
    fps: video.avg_frame_rate,
    frames: frames.length,
    duration: 90,
    maximumTimestampError,
    earlier4800VideoBitstreamAndTimestampsUnchanged: true,
    originalPrefixBitstreamSha256,
    completeDecode: "passed",
    stereoAudio: true,
    sampleRate: 48000,
    loudness,
    selectableCaptions: true,
    embeddedCaptionsMatch: true,
    sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
  });
  if (quality === "4K")
    ffmpeg([
      "-ss",
      "88",
      "-i",
      file,
      "-frames:v",
      "1",
      join(output, `T1-Arc-${format}-privacy-poster.png`),
    ]);
  else
    ffmpeg([
      "-i",
      file,
      "-vf",
      `fps=1/6,scale=${format === "landscape" ? "384:216" : "216:384"},tile=5x3`,
      "-frames:v",
      "1",
      join(source, `${format}-filmstrip.jpg`),
    ]);
}
writeFileSync(
  join(output, `${format}-video-verification.json`),
  JSON.stringify(reports, null, 2),
);
console.log(JSON.stringify(reports, null, 2));
