import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// No generation service, account configuration or credentials are loaded here.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, '.render', 'food-refresh');
const output = join(root, 'out', 'food-refresh');
const previous = join(root, 'out', 'narration-privacy');
const format = process.argv[2];
assert.ok(['landscape', 'portrait'].includes(format));
mkdirSync(output, { recursive: true });
const run = (bin, args) => execFileSync(bin, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const ffmpeg = (args) => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
const probe = (file, args = ['-show_streams', '-show_format']) => JSON.parse(run('ffprobe', ['-v', 'error', ...args, '-of', 'json', file]));
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
function previousExports(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = join(directory, entry.name);
    if (file === output) return [];
    return entry.isDirectory() ? previousExports(file) : entry.name.endsWith('.mp4') ? [file] : [];
  });
}
const oldFiles = previousExports(join(root, 'out'));
const oldHashes = Object.fromEntries(oldFiles.map(file => [file, sha(file)]));
const dimensions = format === 'landscape' ? [3840, 2160] : [2160, 3840];
const soundHash = (file) => ffmpeg(['-i', file, '-map', '0:a:0', '-c:a', 'copy', '-f', 'hash', '-hash', 'sha256', '-']).trim();
const pictureHash = (file, start, count) => ffmpeg([
  ...(start ? ['-ss', String(start)] : []), '-i', file, '-map', '0:v:0', '-frames:v', String(count), '-c:v', 'copy', '-bsf:v', 'h264_mp4toannexb', '-f', 'hash', '-hash', 'sha256', '-',
]).trim();
const frameTimes = file => probe(file, ['-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time']).frames;
const reports = [];

function verify(file, original, size, quality) {
  console.log(`Full decode and timeline verification: ${format} ${quality}`);
  const info = probe(file);
  const video = info.streams.find(s => s.codec_type === 'video');
  const audio = info.streams.find(s => s.codec_type === 'audio');
  assert.equal(video.width, size[0]); assert.equal(video.height, size[1]);
  assert.equal(Number(video.nb_frames), 5400); assert.equal(video.avg_frame_rate, '60/1');
  assert.equal(Number(video.duration), 90); assert.equal(Number(audio.duration), 90);
  assert.equal(Number(audio.start_time), 0); assert.equal(audio.channels, 2); assert.equal(audio.sample_rate, '48000');
  ffmpeg(['-xerror', '-err_detect', 'explode', '-i', file, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-']);
  const frames = frameTimes(file);
  assert.equal(frames.length, 5400);
  const maximumTimestampError = Math.max(...frames.map((frame, i) => Math.abs(Number(frame.best_effort_timestamp_time) - i / 60)));
  assert.ok(maximumTimestampError < 0.000002);
  const compressedAudioSha256 = soundHash(file);
  assert.equal(compressedAudioSha256, soundHash(original), 'George and music AAC payload must remain identical');
  const extracted = join(source, `${format}-${quality}-embedded.srt`);
  ffmpeg(['-i', file, '-map', '0:s:0', extracted]);
  assert.equal(readFileSync(extracted, 'utf8').replaceAll('\r\n', '\n').trim(), readFileSync(join(previous, 'T1-Arc-George-narration.srt'), 'utf8').replaceAll('\r\n', '\n').trim());
  const unchanged = quality !== 'web';
  if (unchanged) {
    assert.equal(pictureHash(file, 0, 3960), pictureHash(original, 0, 3960), '0–66s compressed video changed');
    assert.equal(pictureHash(file, 80, 600), pictureHash(original, 80, 600), '80–90s compressed closing changed');
  }
  if (quality === 'web') assert.ok(statSync(file).size < 10_000_000, 'GitHub copy must be below decimal10MB');
  return { file, width: video.width, height: video.height, duration: 90, frames: frames.length, fps: 60, completeDecode: 'passed', maximumTimestampError, compressedAudioUnchanged: true, compressedAudioSha256, captionsUnchanged: true, outsideFoodSceneCompressedVideoUnchanged: unchanged, bytes: statSync(file).size, sha256: sha(file) };
}

for (const quality of ['4K', 'sharing']) {
  const size = quality === '4K' ? dimensions : dimensions.map(v => v / 2);
  const original = join(previous, `T1-Arc-${format}-${quality}-privacy.mp4`);
  const file = join(output, `T1-Arc-${format}-${quality}-food-refresh.mp4`);
  if (!process.argv.includes('--verify-only')) {
    const originalVideo = probe(original).streams.find(s => s.codec_type === 'video');
    const timescale = originalVideo.time_base.split('/')[1];
    const keys = probe(original, ['-select_streams', 'v:0', '-skip_frame', 'nokey', '-show_frames', '-show_entries', 'frame=pts_time']).frames;
    for (const boundary of [66, 80]) assert.ok(keys.some(frame => Number(frame.pts_time) === boundary), `No exact keyframe at ${boundary}s`);
    const prefix = join(source, `${format}-${quality}-prefix.mp4`);
    const replacement = join(source, `${format}-${quality}-replacement.mp4`);
    const closing = join(source, `${format}-${quality}-closing.mp4`);
    ffmpeg(['-i', original, '-map', '0:v:0', '-frames:v', '3960', '-c:v', 'copy', '-video_track_timescale', timescale, prefix]);
    ffmpeg(['-ss', '80', '-i', original, '-map', '0:v:0', '-frames:v', '600', '-c:v', 'copy', '-video_track_timescale', timescale, closing]);
    console.log(`Encoding only14s food replacement: ${format} ${quality}`);
    ffmpeg(['-i', join(source, `food-${format}.mp4`), '-map', '0:v:0', '-vf', `scale=${size[0]}:${size[1]}:flags=lanczos:in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p,setsar=1`, '-r', '60', '-fps_mode:v', 'cfr', '-frames:v', '840', '-c:v', 'libx264', '-threads', '4', '-preset', 'fast', '-crf', quality === '4K' ? '17' : '19', '-color_range', 'tv', '-colorspace', 'bt709', '-color_trc', 'bt709', '-color_primaries', 'bt709', '-video_track_timescale', timescale, replacement]);
    const list = join(source, `${format}-${quality}-concat.txt`);
    writeFileSync(list, [prefix, replacement, closing].map(p => `file '${p.replaceAll('\\', '/').replaceAll("'", "'\\''")}'`).join('\n') + '\n');
    ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-i', original, '-map', '0:v:0', '-map', '1:a:0', '-map', '1:s:0', '-c', 'copy', '-map_metadata', '-1', '-metadata:s:s:0', 'language=eng', '-metadata:s:s:0', 'title=English narration', '-disposition:s:0', '0', '-metadata', 'title=T1 Arc - food refresh - elevenlabs.io AI narration - Signal Drift', '-metadata', 'comment=Existing free-tier George/ElevenLabs voice and owner-supplied Suno Signal Drift. Separate noncommercial media restrictions; not covered by app MIT licence. Synthetic emulator food draft, not saved.', '-t', '90', '-video_track_timescale', timescale, '-movflags', '+faststart', file]);
  }
  reports.push(verify(file, original, size, quality));
  writeFileSync(join(source, `${format}-video-progress.json`), JSON.stringify(reports, null, 2));
  if (quality === '4K') {
    ffmpeg(['-ss', '88', '-i', file, '-frames:v', '1', join(output, `T1-Arc-${format}-food-refresh-poster.png`)]);
    ffmpeg(['-ss', '77', '-i', file, '-frames:v', '1', join(output, `T1-Arc-${format}-food-refresh-food-poster.png`)]);
  } else {
    const web = join(output, `T1-Arc-${format}-web-food-refresh.mp4`);
    if (!process.argv.includes('--verify-only')) {
      const common = ['-i', file, '-map', '0:v:0', '-c:v', 'libx264', '-threads', '4', '-preset', 'fast', '-b:v', '490k', '-pix_fmt', 'yuv420p', '-passlogfile', join(source, `${format}-web-pass`)];
      console.log(`Encoding bounded sub10MB web copy: ${format}`);
      ffmpeg([...common, '-pass', '1', '-an', '-sn', '-f', 'null', '-']);
      ffmpeg([...common, '-pass', '2', '-map', '0:a:0', '-map', '0:s:0', '-c:a', 'copy', '-c:s', 'copy', '-movflags', '+faststart', web]);
    }
    reports.push(verify(web, original, size, 'web'));
    ffmpeg(['-i', web, '-vf', `fps=1/6,scale=${format === 'landscape' ? '384:216' : '216:384'},tile=5x3`, '-frames:v', '1', join(source, `${format}-filmstrip.jpg`)]);
    ffmpeg(['-ss', '66', '-i', web, '-t', '14', '-vf', `fps=1,scale=${format === 'landscape' ? '384:216' : '216:384'},tile=7x2`, '-frames:v', '1', join(source, `${format}-food-filmstrip.jpg`)]);
  }
}
for (const [file, hash] of Object.entries(oldHashes)) assert.equal(sha(file), hash, 'Original privacy export changed');
for (const name of ['T1-Arc-George-narration.srt', 'T1-Arc-George-narration.vtt', 'captions.json']) copyFileSync(join(previous, name), join(output, name));
copyFileSync(join(source, 'capture-provenance.json'), join(output, 'capture-provenance.json'));
writeFileSync(join(output, `${format}-video-verification.json`), JSON.stringify({ status: 'complete', edition: 'food-refresh', replacementSeconds: [66, 80], reports, protectedOriginalExports: oldHashes }, null, 2));
console.log(JSON.stringify(reports, null, 2));
