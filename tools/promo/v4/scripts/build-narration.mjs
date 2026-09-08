import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { root, source, output, scriptFile, edition } from './narration-paths.mjs';
mkdirSync(output, { recursive: true });
const script = JSON.parse(readFileSync(scriptFile, 'utf8'));
const voice = 'george';
function ffmpeg(args) {
  return execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}
function duration(file) {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], { cwd: root, encoding: 'utf8' }).trim());
}
const timings = [];
const captions = [];
const inputs = [];
const filters = [];
for (const [index, cue] of script.cues.entries()) {
  const file = join(source, `${voice}-${cue.id}.mp3`);
  const seconds = duration(file);
  if (cue.start + seconds > cue.latestEnd) throw new Error(`${cue.id} exceeds its scene window`);
  timings.push({ id: cue.id, start: cue.start, duration: seconds, end: cue.start + seconds, latestEnd: cue.latestEnd });
  inputs.push('-i', file);
  filters.push(`[${index}:a]aresample=48000,afade=t=in:d=0.008,afade=t=out:st=${Math.max(0, seconds - .015)}:d=0.015,adelay=${Math.round(cue.start * 1000)}:all=1[a${index}]`);
  const alignment = JSON.parse(readFileSync(join(source, `${voice}-${cue.id}.alignment.json`), 'utf8')).alignment;
  const spoken = alignment.characters.join('');
  let cursor = 0;
  for (const phrase of cue.phrases) {
    const actual = phrase.spoken ?? phrase.text;
    const first = spoken.indexOf(actual, cursor);
    if (first < 0) throw new Error(`Alignment mismatch for ${cue.id}`);
    const last = first + actual.length - 1;
    const startMs = Math.round((cue.start + alignment.character_start_times_seconds[first]) * 1000);
    const endMs = Math.round((cue.start + alignment.character_end_times_seconds[last]) * 1000);
    captions.push({ text: phrase.text, startMs, endMs, timestampMs: startMs, confidence: null });
    cursor = last + 1;
  }
  ffmpeg(['-i', file, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', join(source, `${voice}-${cue.id}.wav`)]);
}
const raw = join(source, 'voice-timeline-float.wav');
filters.push(`${script.cues.map((_, index) => `[a${index}]`).join('')}amix=inputs=${script.cues.length}:normalize=0,apad,atrim=end=90[mix]`);
ffmpeg([...inputs, '-filter_complex', filters.join(';'), '-map', '[mix]', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_f32le', raw]);

function measure(file) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'loudnorm=I=-16:LRA=7:TP=-1.5:print_format=json', '-f', 'null', '-'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error('Loudness analysis failed');
  const match = result.stderr.match(/\{\s*"input_i"[\s\S]*?\}/);
  if (!match) throw new Error('Loudness analysis did not return measurements');
  return JSON.parse(match[0]);
}
const measured = measure(raw);
const wav = join(output, 'T1-Arc-George-British-AI-narration-90s.wav');
const mp3 = join(output, 'T1-Arc-George-British-AI-narration-90s.mp3');
const normalizer = `loudnorm=I=-16:LRA=7:TP=-1.5:measured_I=${measured.input_i}:measured_LRA=${measured.input_lra}:measured_TP=${measured.input_tp}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true`;
ffmpeg(['-i', raw, '-af', normalizer, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s24le', wav]);
ffmpeg(['-i', wav, '-c:a', 'libmp3lame', '-b:a', '192k', '-metadata', 'title=T1 Arc - AI narration by ElevenLabs George', mp3]);
const final = measure(wav);
if (Number(final.input_tp) > -1) throw new Error('Narration has insufficient peak headroom');
if (Math.abs(duration(wav) - 90) > .001) throw new Error('Narration timeline must be exactly 90 seconds');
writeFileSync(join(output, 'captions.json'), JSON.stringify(captions, null, 2));
function timestamp(milliseconds, separator) {
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor(milliseconds / 60000) % 60;
  const seconds = Math.floor(milliseconds / 1000) % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${separator}${String(milliseconds % 1000).padStart(3, '0')}`;
}
function wrap(text) {
  if (text.length <= 40) return text;
  const words = text.split(' ');
  const candidates = words.slice(1).map((_, i) => {
    const left = words.slice(0, i + 1).join(' '), right = words.slice(i + 1).join(' ');
    const weakBreak = /\b(the|and|into|your|with|for|a|of|to)$/i.test(left) ? 20 : 0;
    return { left, right, score: Math.abs(left.length - right.length) + weakBreak };
  }).filter(item => item.left.length <= 40 && item.right.length <= 40).sort((a, b) => a.score - b.score);
  if (!candidates.length) throw new Error('Caption needs a shorter phrase');
  return `${candidates[0].left}\n${candidates[0].right}`;
}
writeFileSync(join(output, 'T1-Arc-George-narration.srt'), captions.map((caption, i) => `${i + 1}\n${timestamp(caption.startMs, ',')} --> ${timestamp(caption.endMs, ',')}\n${wrap(caption.text)}\n`).join('\n'));
writeFileSync(join(output, 'T1-Arc-George-narration.vtt'), 'WEBVTT\n\n' + captions.map(caption => `${timestamp(caption.startMs, '.')} --> ${timestamp(caption.endMs, '.')}\n${wrap(caption.text)}\n`).join('\n'));
writeFileSync(join(output, 'audio-verification.json'), JSON.stringify({
  voice: 'ElevenLabs George, premade British male', model: 'eleven_multilingual_v2',
  sourceFormat: 'MP3 44.1kHz 128kbps', editingStem: '48kHz mono 24-bit PCM WAV',
  durationSeconds: duration(wav), spokenClipSeconds: timings.reduce((sum, cue) => sum + cue.duration, 0),
  timings, originalLoudness: measured, finalLoudness: final,
  syntheticNarration: true, music: false,
}, null, 2));
if (edition === 'privacy') {
  // Keep immutable assembly inputs separate from the subsequently merged film.
  copyFileSync(wav, join(source, 'closing-narration-90s.wav'));
  copyFileSync(join(output, 'captions.json'), join(source, 'closing-captions.json'));
  copyFileSync(join(output, 'audio-verification.json'), join(source, 'closing-audio-verification.json'));
}
console.log(JSON.stringify({ output, timings, finalLoudness: final }, null, 2));
