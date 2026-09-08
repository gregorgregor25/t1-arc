import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { FORMATS, FPS } from './timeline.mjs';
import { validateFilm } from './film-timeline.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = resolve(root, 'output/v3');
const film = validateFilm(JSON.parse(await readFile(resolve(out, 'film.json'), 'utf8')));
const run = promisify(execFile);
const ffmpeg = process.env.T1ARC_PROMO_FFMPEG ?? 'ffmpeg';
const ffprobe = process.env.T1ARC_PROMO_FFPROBE ?? 'ffprobe';
const exec = (program, args) => run(program, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const selected = process.argv.includes('--portrait') ? ['portrait'] : process.argv.includes('--landscape') ? ['landscape'] : Object.keys(FORMATS);

for (const format of selected) {
  const spec = FORMATS[format], folder = resolve(out, 'film', format), review = resolve(folder, 'review');
  await mkdir(review, { recursive: true });
  const files = [];
  for (const quality of ['4K', '1080p']) {
    const file = resolve(folder, `T1-Arc-Cinematic-${format}-${quality}-silent.mp4`);
    const metadata = JSON.parse((await exec(ffprobe, ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', file])).stdout);
    assert.equal(metadata.streams.length, 1, 'Exactly one video stream. No audio or private metadata streams.');
    const video = metadata.streams[0], divisor = quality === '4K' ? 1 : 2;
    assert.equal(video.codec_type, 'video');
    assert.equal(video.width, spec.width / divisor); assert.equal(video.height, spec.height / divisor);
    assert.equal(video.codec_name, 'h264'); assert.equal(video.pix_fmt, 'yuv420p'); assert.equal(video.sample_aspect_ratio, '1:1');
    assert.equal(video.r_frame_rate, `${FPS}/1`); assert.equal(video.avg_frame_rate, `${FPS}/1`);
    assert.equal(Number(video.nb_read_frames), FPS * film.duration);
    assert.ok(Math.abs(Number(metadata.format.duration) - film.duration) < .02);
    for (const key of ['color_space', 'color_primaries', 'color_transfer']) assert.equal(video[key], 'bt709');
    const data = await readFile(file);
    assert.ok(data.indexOf(Buffer.from('moov')) > 0 && data.indexOf(Buffer.from('moov')) < data.indexOf(Buffer.from('mdat')), 'Fast-start index');
    await exec(ffmpeg, ['-v', 'error', '-xerror', '-i', file, '-f', 'null', '-']);
    const frames = JSON.parse((await exec(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', file])).stdout).frames;
    assert.equal(frames.length, FPS * film.duration);
    for (let i = 0; i < frames.length; i++) assert.ok(Math.abs(Number(frames[i].best_effort_timestamp_time) - i / FPS) < .00002, `Frame ${i}: presentation timestamp`);
    files.push({ file, quality, width: video.width, height: video.height, fps: FPS, frames: frames.length, duration: Number(metadata.format.duration), bytes: (await stat(file)).size, sha256: await hash(file), fullDecode: 'passed', frameTiming: 'Every presentation timestamp checked at 60 fps', audioStreams: 0, fastStart: true });
    console.log(`${format}/${quality}: ${frames.length} frames, full decode, uniform timing and no audio verified`);
    if (quality !== '4K') continue;
    for (const [index, scene] of film.scenes.entries()) {
      const time = scene.start + Math.min(2, scene.duration / 2);
      await exec(ffmpeg, ['-v', 'error', '-y', '-ss', String(time), '-i', file, '-frames:v', '1', resolve(review, `${scene.id}.png`)]);
      await exec(ffmpeg, ['-v', 'error', '-y', '-ss', String(time), '-i', file, '-vf', `scale=${format === 'landscape' ? '384:216' : '216:384'}:flags=lanczos`, '-frames:v', '1', resolve(review, `scene-${String(index).padStart(2, '0')}.png`)]);
      await exec(ffmpeg, ['-v', 'error', '-y', '-ss', String(scene.start + scene.duration - 1.4), '-i', file, '-vf', `scale=${format === 'landscape' ? '960:540' : '390:694'}:flags=lanczos`, '-frames:v', '1', resolve(review, `${scene.id}-late-phone-size.png`)]);
    }
    await exec(ffmpeg, ['-v', 'error', '-y', '-i', resolve(review, 'scene-%02d.png'), '-vf', 'tile=4x3', '-frames:v', '1', resolve(review, 'contact-sheet.png')]);
    await exec(ffmpeg, ['-v', 'error', '-y', '-ss', '18', '-i', file, '-vf', `scale=${format === 'landscape' ? '960:540' : '390:694'}:flags=lanczos`, '-frames:v', '1', resolve(review, 'answer-phone-size.png')]);
    await exec(ffmpeg, ['-v', 'error', '-y', '-ss', '18', '-i', file, '-frames:v', '1', resolve(folder, `T1-Arc-${format}-poster.png`)]);
  }
  const previous = JSON.parse(await readFile(resolve(root, 'output/v2/verification.json'), 'utf8'));
  for (const item of previous) assert.equal(await hash(item.file), item.sha256, 'V2 export preserved');
  await writeFile(resolve(folder, 'verification.json'), JSON.stringify({ files, v2Preserved: true, visualReview: 'Pending encoded-frame review', audio: 'Music and narration deferred by owner. No speech, audio captions or AI-narration credit are appropriate yet.', publicationApproved: false }, null, 2));
}
