# T1 Arc privacy ending

Completed 8 September 2026. Local files only. Nothing published or transferred
to a phone. No app code, public API, installed app or watch face changed.

## Files

Output folder:
`out/narration-privacy/`, relative to the V4 project.

| File | Picture | Size |
| --- | --- | --- |
| T1-Arc-landscape-4K-privacy.mp4 | 3840x2160, 60 fps | 29,822,677 bytes |
| T1-Arc-portrait-4K-privacy.mp4 | 2160x3840, 60 fps | 33,140,987 bytes |
| T1-Arc-landscape-sharing-privacy.mp4 | 1920x1080, 60 fps | 10,880,285 bytes |
| T1-Arc-portrait-sharing-privacy.mp4 | 1080x1920, 60 fps | 12,080,566 bytes |

All four films are 90 seconds with 5,400 frames. The folder also contains:

- `T1-Arc-George-narration.srt` and `.vtt`, optional English subtitles for either format.
- `captions.json`, the aligned Remotion caption source.
- `T1-Arc-landscape-privacy-poster.png` and `T1-Arc-portrait-privacy-poster.png`.
- `T1-Arc-voice-and-Signal-Drift-90s.wav` and `.mp3`, final stereo mix.
- `T1-Arc-George-British-AI-narration-90s.wav` and `.mp3`, separate narration stem.
- Audio, mix and video verification JSON reports, including export SHA-256 hashes.

Earlier silent, voice-only and music editions remain in their original folders.

## The change

Only 80-90 seconds is replaced. The phone remains three-dimensional. Portrait
has its own layout, with a slightly smaller, lower phone so it cannot cover the
qualifier or AI-narration credit. The earlier demonstrations are not rerendered.

George says: "T1 Arc is open source. Your health history is stored on your phone.
We don't collect your health data."

The three approved claims appear on screen, with "Optional AI sends relevant
data directly to OpenAI." visible throughout the closing shot. The existing
George / elevenlabs.io AI-narration credit remains separate.

"We" refers to T1 Arc maintainers. This is not a claim that everything runs
offline or that third-party services receive no data. Checked against LICENSE
(MIT), PRIVACY.md, app.json (SQLCipher and disabled Android backup), and the
direct Responses API requests in src/data/tarvis/openAiClient.ts, lines 439 and
732. The key and relevant evidence go directly to OpenAI, not a maintainer relay.

## Audio

One new cue, 107 characters, generated using the existing George voice ID,
eleven_multilingual_v2 model and identical voice settings, including speed 1.
No existing cue regenerated. Free account checked after generation:
1,717 of 10,000 characters used, 8,283 remaining, extensions disabled.

The cue starts at 80.6 seconds and ends at 86.89551. No speech truncation or
acceleration. Alignment places the last word's end at 86.869 seconds. Signal
Drift ducks by 10 dB under the added cue, with a 0.33-second attack and 1.12-second
release. Its existing 85.5-90-second ending fade is retained. No extra sound effects.

The final WAV measures -15.84 LUFS and -2.19 dBTP. All four encoded AAC tracks
measure -15.84 LUFS and -2.20 dBTP. No clipping. Closing speech measures
-16.69 LUFS; the earlier cue stems range from -16.39 to -15.71 LUFS.
Both clean and music-mixed local transcriptions match the approved words.

This interface cannot audition audio by ear. Timing, text and signal checks pass;
the owner's subjective listening approval remains separate. Existing narration
and music publication-rights decisions are not changed by this local edit.

## Verification

- `npm run lint`: ESLint and TypeScript pass.
- `node scripts/verify-privacy-edition.mjs` with privacy edition selected: pass.
- Full FFmpeg video/audio decoding with errors treated as failures: all four pass.
- Every decoded frame timestamp checked against frame number / 60. Maximum
  deviation 0.00000033333335 seconds; no missing or extra frames.
- Audio starts at zero, lasts 90 seconds, stereo 48 kHz. Embedded optional
  subtitles match the source text and timings after normalizing line endings.
- First 4,800 frames retain the exact original compressed video and timestamps,
  verified by canonical Annex-B SHA-256 and packet timestamp comparisons.
  MP4 packaging may repeat decoding headers; no earlier pictures are re-encoded.
- First 80 seconds of the mix and narration stem are PCM-identical to the old
  edition. Earlier caption objects and timing are unchanged.
- All eight protected previous exports pass their recorded SHA-256 checks.
- Both 4K files played from beginning to end in the browser: ended=true,
  currentTime=90, error=null. Portrait displayed at 390 CSS pixels wide.
- Closing layout inspected at 390px portrait and 844px landscape, plus a
  one-frame-per-second closing filmstrip. Qualifier remains readable and clear
  of the phone and narration credit. Optional closing captions checked in both
  sharing formats. Captions sit near the bottom, away from the qualifier.

## Reproduce locally

Run from tools/promo/v4 in the product-review working tree. Set
`T1ARC_NARRATION_EDITION=privacy`. Keep the dedicated external ElevenLabs env file
outside the repo. Generation is cached and restricted to the free allowance.

1. `node scripts/elevenlabs-narration.mjs generate George closing-privacy`
2. `node scripts/build-narration.mjs`
3. `node scripts/mix-privacy-ending.mjs`
4. Render `T1Arc-Privacy-Closing-Landscape` and `T1Arc-Privacy-Closing-Portrait`
   into `.render/narration-privacy/closing-landscape.mp4` and `closing-portrait.mp4`
   using native dimensions, `--gl=angle --concurrency=2 --crf=17
   --image-format=jpeg --jpeg-quality=95`.
5. `node scripts/export-privacy-film.mjs landscape` and then `portrait`.
6. `node scripts/verify-privacy-edition.mjs`.

`node scripts/review.mjs` serves only the allowlisted local exports on port 4329.
No source recordings, credentials or app data files are exposed by that server.
