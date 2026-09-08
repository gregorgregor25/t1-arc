import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const format = process.argv[2];
if (!['landscape', 'portrait'].includes(format)) throw new Error('Specify landscape or portrait');
const dimensions = format === 'landscape' ? [3840, 2160] : [2160, 3840];
const raw = join(root, '.render', `full-${format}-raw.mp4`);
const master = join(root, 'out', `T1-Arc-V4-full-${format}-4K.mp4`);
const sharing = join(root, 'out', `T1-Arc-V4-full-${format}-sharing.mp4`);
const poster = join(root, 'out', `T1-Arc-V4-full-${format}-poster.png`);
mkdirSync(join(root, 'out'), { recursive: true });

function run(binary, args) {
  return execFileSync(binary, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}
function ffmpeg(args) {
  return run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
}
function probe(file, args) {
  return JSON.parse(run('ffprobe', ['-v', 'error', ...args, '-of', 'json', file]));
}
function verify(file, expectedDimensions) {
  const data = probe(file, ['-show_streams', '-show_format']);
  const streams = data.streams;
  if (streams.length !== 1 || streams[0].codec_type !== 'video') throw new Error('Silent delivery must contain video only');
  const video = streams[0];
  if (video.width !== expectedDimensions[0] || video.height !== expectedDimensions[1]) throw new Error('Wrong dimensions');
  if (video.r_frame_rate !== '60/1' || video.avg_frame_rate !== '60/1') throw new Error('Wrong frame rate');
  if (Number(video.nb_frames) !== 5400 || Number(data.format.duration) !== 90) throw new Error('Wrong duration/frame count');
  if (!['yuv420p', 'yuvj420p'].includes(video.pix_fmt)) throw new Error('Expected 8-bit 4:2:0 video');
  console.log(`Decoding ${file}`);
  ffmpeg(['-xerror', '-err_detect', 'explode', '-i', file, '-map', '0:v:0', '-f', 'null', '-']);
  const frames = probe(file, ['-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time']).frames;
  if (frames.length !== 5400) throw new Error('Decoded frame count mismatch');
  const maximumTimestampError = Math.max(...frames.map((frame, i) => Math.abs(Number(frame.best_effort_timestamp_time) - i / 60)));
  if (maximumTimestampError > 0.000002) throw new Error('Non-uniform frame timing');
  return {
    file, width: video.width, height: video.height, codec: video.codec_name,
    pixelFormat: video.pix_fmt, colorRange: video.color_range, colorSpace: video.color_space,
    fps: video.avg_frame_rate, durationSeconds: Number(data.format.duration),
    decodedFrames: frames.length, maximumTimestampErrorSeconds: maximumTimestampError,
    audioStreams: 0, completeDecode: 'passed', bytes: Number(data.format.size),
    sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
  };
}

console.log(`Preparing silent ${format} master`);
ffmpeg(['-i', raw, '-map', '0:v:0', '-an', '-c:v', 'copy', '-movflags', '+faststart', master]);
console.log(`Encoding ${format} sharing copy`);
const small = dimensions.map(value => value / 2);
// Preserve the original full-range master. Explicitly convert its JPEG/601
// matrix to limited-range BT.709 for widely compatible sharing copies.
ffmpeg(['-i', master, '-vf', `scale=${small[0]}:${small[1]}:flags=lanczos:in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p`, '-an', '-c:v', 'libx264', '-threads', '4', '-preset', 'fast', '-crf', '19', '-color_range', 'tv', '-colorspace', 'bt709', '-color_trc', 'bt709', '-color_primaries', 'bt709', '-movflags', '+faststart', sharing]);
ffmpeg(['-ss', '84', '-i', master, '-frames:v', '1', poster]);
const reports = [verify(master, dimensions), verify(sharing, small)];
writeFileSync(join(root, 'out', `${format}-full-verification.json`), JSON.stringify({
  generatedAt: new Date().toISOString(), format, reports,
  sourceCaptureDimensions: [1080, 2404], generatedApplicationFrames: false,
  audio: 'Intentionally absent. Music and narration remain separate.',
  visualReview: 'See FULL-DELIVERY.md for separate human-visible frame and playback review.',
}, null, 2));

console.log(`Generating ${format} review sheets`);
const reviewSize = format === 'landscape' ? [384, 216] : [270, 480];
const labels = "drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='%{pts\\:hms}':x=8:y=8:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.7";
ffmpeg(['-i', master, '-vf', `fps=1/3,scale=${reviewSize[0]}:${reviewSize[1]}:flags=lanczos,${labels},tile=5x6`, '-frames:v', '1', '-q:v', '2', join(root, '.render', `full-${format}-filmstrip.jpg`)]);
const cuts = [0, 1, 599, 600, 601, 959, 960, 961, 1319, 1320, 1321, 1679, 1680, 1681, 2279, 2280, 2281, 2399, 2400, 3239, 3240, 3241, 3959, 3960, 3961, 4799, 4800, 4801, 5398, 5399];
const selection = cuts.map(frame => `eq(n\\,${frame})`).join('+');
ffmpeg(['-i', master, '-vf', `select='${selection}',scale=${reviewSize[0]}:${reviewSize[1]}:flags=lanczos,${labels},tile=5x6`, '-frames:v', '1', '-q:v', '2', join(root, '.render', `full-${format}-cuts.jpg`)]);
console.log(JSON.stringify(reports, null, 2));
