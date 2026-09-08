import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'out', 'narration');
const stem = join(output, 'T1-Arc-George-British-AI-narration-90s.wav');
const captions = join(output, 'T1-Arc-George-narration.srt');
function run(binary, args) {
  return execFileSync(binary, args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}
const reports = [];
for (const format of ['landscape', 'portrait']) {
  const video = join(root, 'out', `T1-Arc-V4-full-${format}-sharing.mp4`);
  const final = join(output, `T1-Arc-${format}-George-AI-narration-review.mp4`);
  const location = format === 'landscape' ? 'x=90:y=1000' : 'x=75:y=64';
  console.log(`Rendering ${format} narrated review`);
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-i', stem, '-i', captions,
    '-filter:v', `drawtext=fontfile='public/fonts/Manrope.ttf':text='AI narration\\: George / elevenlabs.io':${location}:fontsize=24:fontcolor=0xadb2c6:enable='between(t,86,89.9)'`,
    '-map', '0:v:0', '-map', '1:a:0', '-map', '2:0', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-threads', '4',
    '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-color_trc', 'bt709', '-color_primaries', 'bt709',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng', '-metadata:s:s:0', 'title=English narration',
    '-disposition:s:0', '0', '-metadata', 'title=T1 Arc - AI narration by George - elevenlabs.io',
    '-metadata', 'comment=Private review. Free-plan ElevenLabs narration. No music.', '-t', '90', '-movflags', '+faststart', final]);
  const metadata = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', final]));
  const picture = metadata.streams.find(stream => stream.codec_type === 'video');
  const sound = metadata.streams.find(stream => stream.codec_type === 'audio');
  const subtitle = metadata.streams.find(stream => stream.codec_type === 'subtitle');
  if (Number(picture.nb_frames) !== 5400 || picture.avg_frame_rate !== '60/1' || Number(picture.duration) !== 90) throw new Error('Video timing mismatch');
  if (Math.abs(Number(sound.duration) - 90) > .025 || Number(sound.start_time) !== 0 || sound.sample_rate !== '48000') throw new Error('Audio timeline mismatch');
  if (subtitle?.codec_name !== 'mov_text') throw new Error('Missing selectable captions');
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-xerror', '-err_detect', 'explode', '-i', final, '-map', '0:v', '-map', '0:a', '-f', 'null', '-']);
  const levels = spawnSync('ffmpeg', ['-hide_banner', '-i', final, '-map', '0:a', '-af', 'loudnorm=I=-16:LRA=7:TP=-1.5:print_format=json', '-f', 'null', '-'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const loudness = JSON.parse(levels.stderr.match(/\{\s*"input_i"[\s\S]*?\}/)[0]);
  if (Number(loudness.input_tp) >= 0) throw new Error('Encoded narration clips');
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '88', '-i', final, '-frames:v', '1', join(root, '.render', 'narration', `${format}-credit.png`)]);
  reports.push({ format, file: final, video: { width: picture.width, height: picture.height, frames: Number(picture.nb_frames), fps: picture.avg_frame_rate, duration: Number(picture.duration) },
    audio: { codec: sound.codec_name, sampleRate: sound.sample_rate, channels: sound.channels, duration: Number(sound.duration), start: Number(sound.start_time), loudness },
    selectableCaptions: true, burntInCreditSeconds: [86, 89.9], completeDecode: 'passed', sha256: createHash('sha256').update(readFileSync(final)).digest('hex') });
}
writeFileSync(join(output, 'narrated-video-verification.json'), JSON.stringify(reports, null, 2));
console.log(JSON.stringify(reports, null, 2));
