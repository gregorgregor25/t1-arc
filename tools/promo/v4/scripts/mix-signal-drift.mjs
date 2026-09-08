import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { root, source, output, edition } from './narration-paths.mjs';

if (edition !== 'mixed') throw new Error('Set T1ARC_NARRATION_EDITION=mixed');
if (!process.argv[2]) throw new Error('Provide the owner-supplied music file path');
const supplied = resolve(process.argv[2]);
const music = join(source, 'Signal Drift.mp3');
copyFileSync(supplied, music);
const voice = join(output, 'T1-Arc-George-British-AI-narration-90s.wav');
const voiceReport = JSON.parse(readFileSync(join(output, 'audio-verification.json'), 'utf8'));
function run(binary, args) {
  return execFileSync(binary, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}
function ffmpeg(args) { return run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]); }
function probe(file) { return JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file])); }
function measure(file) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-map', '0:a:0', '-af', 'loudnorm=I=-16:LRA=8:TP=-1.5:print_format=json', '-f', 'null', '-'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error('Audio analysis failed');
  return JSON.parse(result.stderr.match(/\{\s*"input_i"[\s\S]*?\}/)[0]);
}
function normalize(file, target, destination) {
  const measured = measure(file);
  ffmpeg(['-i', file, '-map', '0:a:0', '-af', `loudnorm=I=${target}:LRA=8:TP=-1.5:measured_I=${measured.input_i}:measured_LRA=${measured.input_lra}:measured_TP=${measured.input_tp}:measured_thresh=${measured.input_thresh}:linear=true`, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s24le', '-map_metadata', '-1', destination]);
  return measured;
}
const musicInfo = probe(music);
if (Number(musicInfo.format.duration) < 90) throw new Error('Music is shorter than the approved film');
const trimmed = join(source, 'music-90s-float.wav');
ffmpeg(['-i', music, '-map', '0:a:0', '-af', 'atrim=start=0:end=90,asetpts=PTS-STARTPTS,aresample=48000', '-c:a', 'pcm_f32le', '-ac', '2', '-map_metadata', '-1', trimmed]);
const base = join(source, 'music-base.wav');
normalize(trimmed, -20, base);

// Whole-sentence envelopes avoid syllable-by-syllable pumping. Fade down before
// speech, hold under the cue, then recover gently through the reading pause.
const ducks = voiceReport.timings.map(cue => {
  const a = Math.max(0, cue.start - .35), b = cue.start - .02;
  const c = cue.end + .18, d = cue.end + 1.3;
  return `if(lt(t,${a}),0,if(lt(t,${b}),0.5-0.5*cos(PI*(t-${a})/${b-a}),if(lte(t,${c}),1,if(lt(t,${d}),0.5+0.5*cos(PI*(t-${c})/${d-c}),0))))`;
});
const envelope = `pow(10,(-3-7*min(1,${ducks.join('+')})+3*clip((t-77)/3,0,1))/20)`;
const bed = join(output, 'T1-Arc-Signal-Drift-music-bed-90s.wav');
ffmpeg(['-i', base, '-af', `highpass=f=35,equalizer=f=2200:t=q:w=0.7:g=-2,volume='${envelope}':eval=frame,afade=t=in:d=1.1,afade=t=out:st=85.5:d=4.5`, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s24le', bed]);
const raw = join(source, 'combined-float.wav');
ffmpeg(['-i', voice, '-i', bed, '-filter_complex', '[0:a]pan=stereo|c0=0.70710678*c0|c1=0.70710678*c0[v];[v][1:a]amix=inputs=2:duration=longest:normalize=0,atrim=end=90[mix]', '-map', '[mix]', '-c:a', 'pcm_f32le', '-ar', '48000', raw]);
const final = join(output, 'T1-Arc-voice-and-Signal-Drift-90s.wav');
normalize(raw, -16, final);
ffmpeg(['-i', final, '-c:a', 'libmp3lame', '-b:a', '256k', '-map_metadata', '-1', '-metadata', 'title=T1 Arc - George AI narration - elevenlabs.io - Signal Drift', join(output, 'T1-Arc-voice-and-Signal-Drift-90s.mp3')]);
const levels = measure(final);
const metadata = probe(final);
if (Number(metadata.format.duration) !== 90 || metadata.streams[0].channels !== 2) throw new Error('Incorrect mix duration or channel layout');
if (Number(levels.input_tp) > -1 || Math.abs(Number(levels.input_i) + 16) > 1) throw new Error('Mix loudness or headroom is outside target');
ffmpeg(['-xerror', '-err_detect', 'explode', '-i', final, '-f', 'null', '-']);
const report = {
  sourceTitle: 'Signal Drift', sourceSha256: createHash('sha256').update(readFileSync(music)).digest('hex'),
  sourceDuration: Number(musicInfo.format.duration), sourceSegment: [0, 90],
  originalSourceUnmodified: true, musicSpeed: 1, musicLooping: false,
  narration: 'Approved conversational George script, seven cues, no closing narration',
  voiceTimings: voiceReport.timings, spokenSeconds: voiceReport.spokenClipSeconds,
  musicTargetLufs: -20, musicGainDbDuringSpeech: -10, musicGainDbBetweenCues: -3,
  musicGainDbAtClosing: 0, musicFadeOutSeconds: [85.5, 90],
  duckAttackSeconds: .33, duckReleaseSeconds: 1.12,
  extraSoundEffects: false, finalLoudness: levels,
  durationSeconds: 90, sampleRate: 48000, channels: 2, completeDecode: 'passed',
  publication: 'Local only. Owner listening approval and publication rights remain separate.',
};
writeFileSync(join(output, 'mix-verification.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
