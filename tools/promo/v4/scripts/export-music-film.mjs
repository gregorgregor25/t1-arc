import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { root, source, output, edition } from './narration-paths.mjs';

if (edition !== 'mixed') throw new Error('Set T1ARC_NARRATION_EDITION=mixed');
const format = process.argv[2];
if (!['landscape', 'portrait'].includes(format)) throw new Error('Choose landscape or portrait');
const size = format === 'landscape' ? [3840, 2160] : [2160, 3840];
const original = join(root, 'out', `T1-Arc-V4-full-${format}-4K.mp4`);
const ending = join(source, `closing-${format}.mp4`);
const sound = join(output, 'T1-Arc-voice-and-Signal-Drift-90s.wav');
const captions = join(output, 'T1-Arc-George-narration.srt');
const master = join(output, `T1-Arc-${format}-4K-narration-and-music.mp4`);
const sharing = join(output, `T1-Arc-${format}-sharing-narration-and-music.mp4`);
function run(binary, args) {
  return execFileSync(binary, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}
function ffmpeg(args) { return run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]); }
function probe(file, extra = ['-show_streams', '-show_format']) {
  return JSON.parse(run('ffprobe', ['-v', 'error', ...extra, '-of', 'json', file]));
}
const colour = `scale=${size[0]}:${size[1]}:in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p,setsar=1`;
console.log(`Encoding ${format} 4K music master`);
ffmpeg(['-filter_complex_threads', '2', '-i', original, '-i', ending, '-i', sound, '-i', captions,
  '-filter_complex', `[0:v]trim=end_frame=4800,setpts=PTS-STARTPTS,${colour}[body];[1:v]trim=end_frame=600,setpts=PTS-STARTPTS,${colour}[end];[body][end]concat=n=2:v=1:a=0[v]`,
  '-map', '[v]', '-map', '2:a:0', '-map', '3:0', '-map_metadata', '-1', '-r', '60', '-fps_mode:v', 'cfr',
  '-c:v', 'libx264', '-threads', '4', '-preset', 'fast', '-crf', '17', '-pix_fmt', 'yuv420p',
  '-color_range', 'tv', '-colorspace', 'bt709', '-color_trc', 'bt709', '-color_primaries', 'bt709',
  '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-c:s', 'mov_text', '-disposition:s:0', '0',
  '-metadata:s:s:0', 'language=eng', '-metadata:s:s:0', 'title=English narration',
  '-metadata', 'title=T1 Arc - AI narration by George - elevenlabs.io - Signal Drift',
  '-metadata', 'comment=Private review. Owner-supplied Suno music. No additional sound effects.',
  '-t', '90', '-movflags', '+faststart', master]);
console.log(`Encoding ${format} sharing copy`);
ffmpeg(['-i', master, '-map', '0:v:0', '-map', '0:a:0', '-map', '0:s:0',
  '-vf', `scale=${size[0]/2}:${size[1]/2}:flags=lanczos,format=yuv420p`,
  '-c:v', 'libx264', '-threads', '4', '-preset', 'fast', '-crf', '19',
  '-color_range', 'tv', '-colorspace', 'bt709', '-color_trc', 'bt709', '-color_primaries', 'bt709',
  '-c:a', 'copy', '-c:s', 'copy', '-disposition:s:0', '0', '-movflags', '+faststart', sharing]);

const reports = [];
for (const [file, dimensions] of [[master, size], [sharing, size.map(value => value/2)]]) {
  console.log(`Verifying ${file}`);
  const info = probe(file), video = info.streams.find(stream => stream.codec_type === 'video');
  const audio = info.streams.find(stream => stream.codec_type === 'audio');
  const subtitle = info.streams.find(stream => stream.codec_type === 'subtitle');
  if (video.width !== dimensions[0] || video.height !== dimensions[1] || Number(video.nb_frames) !== 5400 || video.avg_frame_rate !== '60/1' || Number(video.duration) !== 90) throw new Error('Video dimensions/timing mismatch');
  if (audio.channels !== 2 || audio.sample_rate !== '48000' || Number(audio.duration) !== 90 || Number(audio.start_time) !== 0) throw new Error('Audio duration/channel mismatch');
  if (subtitle?.codec_name !== 'mov_text') throw new Error('Caption track missing');
  ffmpeg(['-xerror', '-err_detect', 'explode', '-i', file, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-']);
  const frames = probe(file, ['-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time']).frames;
  const error = Math.max(...frames.map((frame, index) => Math.abs(Number(frame.best_effort_timestamp_time) - index/60)));
  if (frames.length !== 5400 || error > .000002) throw new Error('Non-uniform video frame timing');
  const result = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-map', '0:a:0', '-af', 'loudnorm=I=-16:LRA=8:TP=-1.5:print_format=json', '-f', 'null', '-'], { cwd: root, encoding: 'utf8', maxBuffer: 16*1024*1024 });
  if (result.status !== 0) throw new Error('Final audio analysis failed');
  const loudness = JSON.parse(result.stderr.match(/\{\s*"input_i"[\s\S]*?\}/)[0]);
  if (Number(loudness.input_tp) >= 0 || Math.abs(Number(loudness.input_i) + 16) > 1) throw new Error('Encoded mix clips or exceeds loudness range');
  reports.push({ file, width: video.width, height: video.height, fps: video.avg_frame_rate, frames: frames.length, duration: 90,
    maximumTimestampError: error, stereoAudio: true, sampleRate: 48000, loudness, selectableCaptions: true,
    completeDecode: 'passed', sha256: createHash('sha256').update(readFileSync(file)).digest('hex') });
}
ffmpeg(['-ss', '88', '-i', master, '-frames:v', '1', join(output, `T1-Arc-${format}-music-poster.png`)]);
ffmpeg(['-i', sharing, '-vf', `fps=1/6,scale=${format === 'landscape' ? '384:216' : '216:384'},tile=5x3`, '-frames:v', '1', join(source, `${format}-filmstrip.jpg`)]);
writeFileSync(join(output, `${format}-video-verification.json`), JSON.stringify(reports, null, 2));
console.log(JSON.stringify(reports, null, 2));
