import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { validateEdit, durationOf, FORMATS, FPS } from './edit.mjs';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../output/v2/', import.meta.url));
const edit = validateEdit(JSON.parse(await readFile(resolve(root, 'edit.json'), 'utf8')));
const duration = durationOf(edit);
const results = [];
const sources = [];
const mediaRoot = fileURLToPath(new URL('..', import.meta.url));
for (const source of new Set(edit.scenes.map(scene => scene.source))) {
  const bytes = await readFile(resolve(mediaRoot, source));
  sources.push({ source, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const command = (program, argv) => run(program, argv, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
const ffmpeg = process.env.T1ARC_PROMO_FFMPEG ?? 'ffmpeg';
const ffprobe = process.env.T1ARC_PROMO_FFPROBE ?? 'ffprobe';

for (const [format, spec] of Object.entries(FORMATS)) {
  const path = resolve(root, format, `T1-Arc-A-Closer-Look-${format}.mp4`);
  const { stdout } = await command(ffprobe, ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', path]);
  const probe = JSON.parse(stdout);
  const video = probe.streams.find(s => s.codec_type === 'video');
  assert.ok(video);
  assert.equal(video.width, spec.width);
  assert.equal(video.height, spec.height);
  assert.equal(video.codec_name, 'h264');
  assert.equal(video.pix_fmt, 'yuv420p');
  assert.equal(video.avg_frame_rate, `${FPS}/1`);
  assert.equal(video.color_space, 'bt709');
  assert.equal(video.color_transfer, 'bt709');
  assert.equal(video.color_primaries, 'bt709');
  assert.equal(video.sample_aspect_ratio, '1:1');
  assert.equal(Number(video.nb_read_frames), duration * FPS);
  assert.ok(Math.abs(Number(probe.format.duration) - duration) < .05);
  assert.equal(probe.streams.length, 1, 'Only the composed video stream, no phone metadata or audio');
  const bytes = await readFile(path);
  const atoms = [];
  for (let offset = 0; offset + 8 <= bytes.length;) {
    let size = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (size === 1) size = Number(bytes.readBigUInt64BE(offset + 8));
    if (size === 0) size = bytes.length - offset;
    assert.ok(size >= 8 && offset + size <= bytes.length);
    atoms.push({ type, offset });
    offset += size;
  }
  assert.ok(atoms.find(a => a.type === 'moov').offset < atoms.find(a => a.type === 'mdat').offset);
  const decoded = await command(ffmpeg, ['-v', 'error', '-xerror', '-i', path, '-f', 'null', '-']);
  assert.equal(decoded.stderr.trim(), '');
  const review = resolve(root, format, 'review');
  await mkdir(review, { recursive: true });
  await command(ffmpeg, ['-v', 'error', '-y', '-i', path, '-vf',
    format === 'portrait' ? 'fps=1/2,scale=216:384,tile=7x8:padding=6:margin=6' : 'fps=1/2,scale=384:216,tile=7x8:padding=6:margin=6',
    '-frames:v', '1', resolve(review, 'contact-sheet.png')]);
  let start = 0;
  for (const scene of edit.scenes) {
    for (const [label, time] of [['start', start + .5], ['middle', start + scene.duration / 2], ['end', start + scene.duration - .25]]) {
      await command(ffmpeg, ['-v', 'error', '-y', '-ss', String(time), '-i', path, '-frames:v', '1', resolve(review, `${scene.id}-${label}.png`)]);
    }
    start += scene.duration;
  }
  const report = { format, file: path, width: video.width, height: video.height, durationSeconds: Number(probe.format.duration),
    frames: Number(video.nb_read_frames), fps: FPS, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    codec: 'h264', pixelFormat: 'yuv420p', fastStart: true, fullDecode: 'passed', videoStreams: 1, audioOrMetadataStreams: 0,
    reviewFrames: edit.scenes.length * 3, visualReview: 'Pending manual inspection of exported frames and contact sheet' };
  results.push(report);
  console.log(`${format}: ${duration}s, ${report.frames} frames, complete decode passed.`);
}
await writeFile(resolve(root, 'verification.json'), JSON.stringify(results, null, 2) + '\n');
await writeFile(resolve(root, 'provenance.json'), JSON.stringify({
  approvedRealCaptures: edit.approvedRealCaptures, approval: edit.approval,
  package: edit.package, version: edit.version, captureDate: edit.captureDate,
  sourceClips: sources, scenes: edit.scenes.map(({ id, source, in: inPoint, duration, provenance }) => ({ id, source, inPoint, duration, provenance })),
  processing: 'Status/navigation bars cropped; source frames trimmed or held. Original app text retained. Waiting time edited. No synthetic replies or saved health entries. Silent video only.',
}, null, 2) + '\n');
