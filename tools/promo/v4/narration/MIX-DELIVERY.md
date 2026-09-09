# Conversational narration and Signal Drift

Historical delivery record. The current demo adds a spoken privacy ending and
updated food scene. Counts, paths and permissions below record this earlier
pass. Use [the current guide](README.md) and its linked media notice for sharing.

The owner's approved seven-scene script is in `script-mixed.json`. George's
British male voice narrates Today, Health, Tarv1s, the exact glucose question and
answer, Timeline and Food. The ending has no speech and no rejected taglines.
The original 3D phone remains on screen with the T1 Arc wordmark.

## Files

All media stays local in `out/narration-mixed/`, ignored by Git.

| Format | 4K master | Sharing copy |
| --- | --- | --- |
| Landscape | `T1-Arc-landscape-4K-narration-and-music.mp4` | `T1-Arc-landscape-sharing-narration-and-music.mp4` |
| Portrait | `T1-Arc-portrait-4K-narration-and-music.mp4` | `T1-Arc-portrait-sharing-narration-and-music.mp4` |

All four films run for 90 seconds at 60fps. Masters are 3840x2160 and 2160x3840;
sharing copies are 1920x1080 and 1080x1920. All have stereo AAC audio and
selectable English narration captions. SRT/VTT sidecars and JSON caption timings
are alongside them. Separate PNG posters are included for each format.

Editing audio:

- `T1-Arc-George-British-AI-narration-90s.wav`: isolated timed narration.
- `T1-Arc-Signal-Drift-music-bed-90s.wav`: timed and ducked stereo music.
- `T1-Arc-voice-and-Signal-Drift-90s.wav`: combined stereo master.
- `T1-Arc-voice-and-Signal-Drift-90s.mp3`: combined listening copy.

WAV stems are 48kHz, 24-bit editing files. They do not imply uncompressed
original recordings: the supplied music is MP3, and ElevenLabs supplied MP3.

## Mix decisions

The owner's Signal Drift track is 119.616 seconds. This edit uses its first
90 seconds at the original speed, without loops, with a 1.1-second opening fade
and a 4.5-second closing fade. The supplied download is unchanged.

Music falls smoothly before each speech cue, stays down across the whole
sentence, then recovers through the reading pause. It does not pump on individual
syllables. The last ten seconds are music only. No extra sound effects were added.

George has 56.216 seconds of speech, compared with 38.139 seconds in the previous
edition. All seven clips fit their scene windows naturally. No clip was cut short
or time-stretched. TTS speed was the provider's normal 1.0 setting.

The question finishes around 35.02 seconds, before the separate answer scene
begins at 38 seconds with the existing "After processing" disclosure. The spoken
answer is 6.6 millimoles per litre, matching the approved recording. The food scene
still shows an unsaved selection, and narration says to check details before saving.

## Verification

- V4 ESLint and TypeScript passed, as did Node syntax checks for production scripts.
- All four final exports passed complete video and audio decoding with errors fatal.
- Every final video has 5,400 frames at 60fps and a 90-second timeline. Maximum
  timestamp error is below 0.000002 seconds. Stereo audio begins at time zero.
- Both 4K masters played from beginning to end in the local browser, reporting
  time 90, ended true and no media error. Portrait was shown at 390px width.
  Complete-film contact sheets and the new closing layout were inspected.
  Browser playback was muted; this was a visual/decoder test, not an ear audition.
- Final AAC measures approximately -16.02 LUFS integrated, with -2.20dBTP true
  peak. There is headroom and no detected clipping.
- JSON captions match the approved script, remain ordered and non-overlapping,
  and end before the closing scene. Each displayed caption is at most two lines.
- Local Whisper checks were run both on isolated voice and with music beneath it.
  Ordinary words, the numerical answer and the treatment boundary match. Proper
  name recognition is inconsistent: "Tarvis" was transcribed as "Tavis" in the
  isolated clip and "Tarbus" in the mix. Captions retain the correct Tarv1s name.
  This interface cannot listen by ear, so pronunciation and subjective delivery
  still need the owner's listening judgement. No human audition is claimed.
- Four original videos, including the old narrated reviews, retain their exact
  earlier SHA-256 hashes. V1-V3, the app and installed devices were not changed.
- The first attempt at concatenating the new ending defaulted to 25fps. It was
  rejected by verification and replaced by explicit 60fps exports. None of those
  rejected encodes are final deliverables.

Machine-readable evidence: `audio-verification.json`, `mix-verification.json`,
`landscape-video-verification.json` and `portrait-video-verification.json`.
Private transcript evidence and filmstrips are under `.render/narration-mixed/`.

## Access and publication

938 free ElevenLabs characters were used for this revision. The account reported
1,610 used in total, with 8,390 of 10,000 remaining. No paid service, subscription
change, top-up or publication was performed. Only the approved narration was sent
for synthesis, not recordings or source health records. The external ElevenLabs
key was used solely for authentication; the app's OpenAI key was not accessed.

Everything remains a private review asset. The previously noted ElevenLabs
free-plan publication restrictions still apply. The music was supplied by the
owner as a Suno creation; no new claim about its publication rights is made.

## Reproduce

Set `T1ARC_NARRATION_EDITION=mixed`. For API generation only, also set
`T1ARC_NARRATION_ENV_FILE` to the owner's external private env file. Do not put
that file or its contents in the repository.

```sh
node scripts/elevenlabs-narration.mjs generate George all
node scripts/build-narration.mjs
node scripts/check-narration-speech.mjs
node scripts/mix-signal-drift.mjs "path/to/Signal Drift.mp3"
```

Set `T1ARC_VERIFY_MIX=1` and run the speech checker again for mixed-audio QA.
Render the two ten-second ending compositions with Remotion using the existing
angle renderer and native composition dimensions, then export:

```sh
npx remotion render src/index.ts T1Arc-Music-Closing-Landscape .render/narration-mixed/closing-landscape.mp4 --gl=angle --concurrency=3 --codec=h264 --crf=17 --image-format=jpeg --jpeg-quality=95
npx remotion render src/index.ts T1Arc-Music-Closing-Portrait .render/narration-mixed/closing-portrait.mp4 --gl=angle --concurrency=3 --codec=h264 --crf=17 --image-format=jpeg --jpeg-quality=95
node scripts/export-music-film.mjs landscape
node scripts/export-music-film.mjs portrait
node scripts/verify-music-edition.mjs
```

The first 80 seconds come from the approved native 4K films, colour-converted to
limited-range BT.709 for consistent playback. Only the ten-second ending was
re-rendered in Remotion. App footage is the original 1080px-wide recording, not
a claim of native 4K screen capture or generated intermediate app frames.
