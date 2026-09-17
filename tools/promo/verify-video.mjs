import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { DURATION, FPS } from './storyboard.mjs';

const run = promisify(execFile);
const root = fileURLToPath(new URL('.', import.meta.url));
const formats = process.argv.includes('--draft') ? ['landscape-draft'] : ['landscape', 'portrait'];
const reports = [];
for (const format of formats) {
  const draft = format.endsWith('-draft');
  const portrait = format.startsWith('portrait');
  const path = resolve(root, 'output', format, `t1-arc-${format}.mp4`);
  const expectedWidth = draft ? 960 : portrait ? 1080 : 1920;
  const expectedHeight = draft ? 540 : portrait ? 1920 : 1080;
  const fps = draft ? 15 : FPS;
  const { stdout } = await run(process.env.T1ARC_PROMO_FFPROBE ?? 'ffprobe', [
    '-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', path,
  ], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  const probe = JSON.parse(stdout);
  const video = probe.streams.find(stream => stream.codec_type === 'video');
  assert.ok(video, 'video stream exists');
  assert.equal(video.codec_name, 'h264');
  assert.equal(video.pix_fmt, 'yuv420p');
  assert.equal(video.width, expectedWidth);
  assert.equal(video.height, expectedHeight);
  assert.equal(video.avg_frame_rate, `${fps}/1`);
  assert.equal(Number(video.nb_read_frames), DURATION * fps);
  assert.ok(Math.abs(Number(probe.format.duration) - DURATION) < .05);
  assert.equal(probe.streams.filter(stream => stream.codec_type === 'audio').length, 0);
  const bytes = await readFile(path);
  const atoms = [];
  for (let offset = 0; offset + 8 <= bytes.length;) {
    let size = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (size === 1) size = Number(bytes.readBigUInt64BE(offset + 8));
    if (size === 0) size = bytes.length - offset;
    assert.ok(size >= 8 && offset + size <= bytes.length, 'valid MP4 atom');
    atoms.push({ type, offset, size });
    offset += size;
  }
  assert.ok(atoms.find(atom => atom.type === 'moov').offset < atoms.find(atom => atom.type === 'mdat').offset,
    'fast-start index precedes video data');
  const decoded = await run(process.env.T1ARC_PROMO_FFMPEG ?? 'ffmpeg', [
    '-hide_banner', '-v', 'error', '-xerror', '-i', path, '-f', 'null', '-',
  ], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(decoded.stderr.trim(), '', 'all frames decode without errors');
  const reviewDir = resolve(root, 'output', format, 'encoded-review');
  await mkdir(reviewDir, { recursive: true });
  await run(process.env.T1ARC_PROMO_FFMPEG ?? 'ffmpeg', [
    '-hide_banner', '-v', 'error', '-y', '-i', path, '-vf',
    portrait ? 'fps=1,scale=270:480,tile=6x8:padding=8:margin=8:color=0x222b3b' :
      'fps=1,scale=384:216,tile=6x8:padding=8:margin=8:color=0x222b3b',
    '-frames:v', '1', resolve(reviewDir, 'one-second-contact-sheet.png'),
  ], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  for (const time of [2.8, 11.5, 18.8, 21.8, 26.5, 31.8, 33.7, 35.1, 36.5, 37.9, 39.3, 43.5]) {
    await run(process.env.T1ARC_PROMO_FFMPEG ?? 'ffmpeg', [
      '-hide_banner', '-v', 'error', '-y', '-ss', String(time), '-i', path,
      '-frames:v', '1', resolve(reviewDir, `frame-${time}.png`),
    ], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  }
  reports.push({ file: path.split(/[\\/]/).at(-1), bytes: (await stat(path)).size,
    sha256: createHash('sha256').update(bytes).digest('hex'), width: video.width, height: video.height,
    frameRate: video.avg_frame_rate, decodedFrames: Number(video.nb_read_frames),
    durationSeconds: Number(probe.format.duration), codec: video.codec_name, pixelFormat: video.pix_fmt,
    fastStart: true, audioStreams: 0, fullDecode: 'passed', reviewFrames: 12,
    oneSecondContactSheet: `${format}/encoded-review/one-second-contact-sheet.png`,
  });
  console.log(`${format}: ${video.width}x${video.height}, ${video.avg_frame_rate} fps, ${video.nb_read_frames} decoded frames, ${probe.format.duration}s, H.264/fast-start verified.`);
}
await writeFile(resolve(root, 'output', `video-verification${process.argv.includes('--draft') ? '-draft' : ''}.json`),
  JSON.stringify(reports, null, 2) + '\n');
