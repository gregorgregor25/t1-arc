import { installWhisperCpp, downloadWhisperModel, transcribe, toCaptions } from '@remotion/install-whisper-cpp';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { root, source, output, scriptFile } from './narration-paths.mjs';
const directory = join(root, '.render', 'whisper-narration-qa');
await installWhisperCpp({ to: directory, version: '1.5.5' });
await downloadWhisperModel({ model: 'base.en', folder: directory });
const config = JSON.parse(readFileSync(scriptFile, 'utf8'));
const mixed = process.env.T1ARC_VERIFY_MIX === '1';
const timings = mixed ? JSON.parse(readFileSync(join(output, 'audio-verification.json'), 'utf8')).timings : [];
const results = [];
for (const cue of config.cues.filter(item => !process.argv[2] || item.id === process.argv[2])) {
  const inputPath = join(source, mixed ? `mixed-${cue.id}.wav` : `george-${cue.id}.wav`);
  if (mixed) {
    const timing = timings.find(item => item.id === cue.id);
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(timing.start), '-i', join(output, 'T1-Arc-voice-and-Signal-Drift-90s.wav'), '-t', String(timing.duration), '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', inputPath], { cwd: root });
  }
  const result = await transcribe({
    model: 'base.en', whisperPath: directory, whisperCppVersion: '1.5.5',
    inputPath, tokenLevelTimestamps: true,
  });
  const converted = toCaptions({ whisperCppOutput: result });
  writeFileSync(join(source, `asr-${mixed ? 'mixed-' : ''}${cue.id}.json`), JSON.stringify(converted, null, 2));
  const transcript = converted.captions.map(caption => caption.text).join('');
  results.push({ cue: cue.id, expected: cue.phrases.map(phrase => phrase.text).join(' '), transcript });
  console.log(JSON.stringify(results.at(-1)));
}
writeFileSync(join(source, `speech-review${mixed ? '-mixed' : ''}${process.argv[2] ? `-${process.argv[2]}` : ''}.json`), JSON.stringify(results, null, 2));
