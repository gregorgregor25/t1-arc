# Narration and soundtrack production notes

The current T1 Arc film uses George, ElevenLabs' British narrative voice, with
the owner's Suno track *Signal Drift*. It is not the earlier silent or voice-only
preview. Watch the selected 90-second demo and read its credits in
[docs/media](../../../../docs/media/README.md).

This is optional maintainer material. App users need the APK described in the
[main guide](../../../../README.md), not narration tools or API credentials.

## Current script and editions

| Source | Role |
| --- | --- |
| `script.json` | Historical original nine-cue, voice-only review |
| `script-mixed.json` | Approved conversational narration for the first seven scenes |
| `script-privacy.json` | Replacement privacy-closing cue |
| `FOOD-REFRESH-DELIVERY.md` | Current food UI replacement; existing audio/captions unchanged |

The selected film combines the conversational narration with the privacy cue.
The closing explains local health-history storage and no maintainer collection;
the screen also states that optional AI sends relevant data directly to OpenAI.
The refreshed 66–80-second food scene keeps the existing search/portion/check
narration and shows an actual unsaved example draft.

The question remains “What was my average glucose yesterday?” Its genuine
recorded answer follows an editorial cut, not an instant-response or treatment
claim. Captions retain the displayed T1 Arc and Tarv1s names.

## Local inputs and outputs

Production captures, generated speech, music, alignment data and editing stems
are excluded from Git. A fresh clone cannot recreate the finished mix without
those separately supplied, authorised inputs.

- `out/narration/`: historical sparse voice-only reviews and audition samples.
- `out/narration-mixed/`: conversational George/Signal Drift mix and stems.
- `out/narration-privacy/`: privacy-ending mix, captions and prior finished films.
- `out/food-refresh/`: current local films, posters, captions and verification.
- `.render/`: excluded generation cache, source media and local QA intermediates.

These paths are relative to the V4 workspace. The selected repository viewing
copy is in `docs/media/`; the production folders are not public download promises.
Install the workspace's own dependencies as described in the
[production README](../README.md).

New voice generation is not required to view the demo or refresh pictures while
preserving prepared audio. Do not run generation scripts as routine app setup.
Any intentional new generation needs its own account, allowance and rights review.
Never put credentials in source, command arguments, browser code or logs.

## Verification and reuse

The food-refresh exporter checks the complete 90-second video/audio decode,
5,400 frame timestamps, identical existing AAC audio, unchanged caption text and
timing, and scenes preserved outside the food replacement. Final reports and
source provenance are described in [FOOD-REFRESH-DELIVERY.md](FOOD-REFRESH-DELIVERY.md).
Technical checks are distinct from subjective listening and reuse permissions.

George's recordings and Signal Drift were produced on free plans. The creator's
personal, non-monetising demo has separate media restrictions; its soundtrack
is not supplied as reusable MIT audio for forks or commercial campaigns.
The publication title must include `elevenlabs.io` or `11.ai`; the on-screen
credit alone is not a substitute. Read the
[maintained media-rights notice](../../../../docs/media/README.md) for credits and sources.

Earlier delivery documents, usage counts, audition comparisons and verification
files are historical records. They are not live allowance reports, descriptions
of the current selected file, new generation requirements or unrestricted licences.
