import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { join } from 'node:path';
import { source as out, scriptFile, ledgerFile } from './narration-paths.mjs';
mkdirSync(out, { recursive: true });
const envFile = process.env.T1ARC_NARRATION_ENV_FILE;
if (!envFile) throw new Error('Set T1ARC_NARRATION_ENV_FILE to the private, external ElevenLabs env file');
const env = parseEnv(readFileSync(envFile, 'utf8'));
const key = env.ELEVENLABS_API_KEY;
if (!key || key.length < 10) throw new Error('ElevenLabs key is not configured');

async function api(path, body) {
  const response = await fetch(`https://api.elevenlabs.io${path}`, {
    method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(60000),
    headers: { 'xi-api-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    let status = 'request_failed';
    try { const data = await response.json(); if (/^[a-z_]+$/.test(data.detail?.status)) status = data.detail.status; } catch { /* No raw response or credentials in logs. */ }
    throw new Error(`ElevenLabs HTTP ${response.status}: ${status}`);
  }
  return response.json();
}
const subscription = await api('/v1/user/subscription');
const quota = {
  tier: subscription.tier, characterCount: subscription.character_count,
  characterLimit: subscription.character_limit,
  remaining: subscription.character_limit - subscription.character_count,
  canExtend: subscription.can_extend_character_limit,
};
const mode = process.argv[2] ?? 'inspect';
if (mode === 'inspect') {
  const result = await api('/v1/voices');
  const voices = result.voices.filter(voice => voice.labels?.gender === 'male' && /british/i.test(voice.labels?.accent ?? ''))
    .map(voice => ({ id: voice.voice_id, name: voice.name, category: voice.category, labels: voice.labels, description: voice.description }));
  const report = { checkedAt: new Date().toISOString(), quota, voices };
  writeFileSync(join(out, 'account-check.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} else if (mode === 'generate') {
  const config = JSON.parse(readFileSync(scriptFile, 'utf8'));
  config.cues = config.cues.map(cue => ({ ...cue, spoken: cue.phrases.map(phrase => phrase.spoken ?? phrase.text).join(' ') }));
  const voice = config.voices.find(item => item.name === process.argv[3]);
  if (!voice) throw new Error('Choose a configured British male voice');
  const requested = process.argv[4] === 'all' ? config.cues : config.cues.filter(cue => cue.id === process.argv[4]);
  if (!requested.length) throw new Error('Choose all or a configured cue ID');
  if (quota.tier !== 'free') throw new Error('This generation run is restricted to the verified free tier');
  const ledger = existsSync(ledgerFile) ? JSON.parse(readFileSync(ledgerFile, 'utf8')) : [];
  const pending = requested.filter(cue => !existsSync(join(out, `${voice.name.toLowerCase()}-${cue.id}.mp3`)));
  const required = pending.reduce((sum, cue) => sum + cue.spoken.length, 0);
  const used = ledger.reduce((sum, row) => sum + row.characters, 0);
  if (used + required > 3000 || required > quota.remaining) throw new Error('Local 3,000-character budget or available free quota would be exceeded');
  for (const cue of requested) {
    const stem = `${voice.name.toLowerCase()}-${cue.id}`;
    if (existsSync(join(out, `${stem}.mp3`))) { console.log(`Already generated: ${stem}`); continue; }
    const reservation = { voice: voice.name, cue: cue.id, characters: cue.spoken.length, state: 'requested', requestedAt: new Date().toISOString() };
    ledger.push(reservation); writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2));
    const audio = await api(`/v1/text-to-speech/${voice.id}/with-timestamps?output_format=mp3_44100_128`, {
      text: cue.spoken, model_id: 'eleven_multilingual_v2',
      voice_settings: config.voiceSettings ?? { stability: .55, similarity_boost: .75, style: 0, use_speaker_boost: true, speed: .96 },
      seed: 20260907,
    });
    writeFileSync(join(out, `${stem}.mp3`), Buffer.from(audio.audio_base64, 'base64'));
    writeFileSync(join(out, `${stem}.alignment.json`), JSON.stringify({ alignment: audio.alignment, normalized_alignment: audio.normalized_alignment }, null, 2));
    reservation.state = 'received'; writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2));
    console.log(`Generated ${stem}: ${cue.spoken.length} characters`);
  }
  const final = await api('/v1/user/subscription');
  console.log(JSON.stringify({ tier: final.tier, characterCount: final.character_count, characterLimit: final.character_limit }));
} else throw new Error('Use inspect or generate');
