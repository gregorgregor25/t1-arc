# T1 Arc film V4

A local Remotion project, separate from the app and V1-V3.

## Edition history

The current viewing copy and media conditions are linked from [the workspace
README](README.md). The silent and earlier audio editions below are historical
outputs, not the current GitHub demo. Reproduction requires separately supplied
authorised inputs; excluded local paths are not files provided by a fresh clone.

Both 90-second films are rendered at native 3840x2160 and 2160x3840, 60 fps.
Final delivery filenames start `T1-Arc-V4-full-` in `out/`. There are smaller
sharing copies and separate posters. Those four video exports are silent.
The approved 12-second samples are preserved.

The subsequent British narration pass is documented in `narration/README.md`.
Its audio stem, subtitles and narrated review copies live in `out/narration/`.
They do not replace the silent masters.

The owner subsequently approved the conversational rewrite and supplied Signal
Drift. Both mixed 4K films, sharing copies, stems and captions are now in
`out/narration-mixed/`. See `narration/MIX-DELIVERY.md` for that edition.
The original silent and narration-only exports remain unchanged.

The subsequent privacy edition lives in `out/narration-privacy/`. It replaces
only the final ten seconds, adding the approved open-source and local-storage
message with a visible direct-OpenAI qualifier. It preserves the earlier films.
See `narration/PRIVACY-DELIVERY.md` for files and verification.

The subsequent current-food-UI edition lives in `out/food-refresh/`. It replaces
only 66–80 seconds with genuine synthetic-emulator footage of the updated food logger,
preserving the privacy ending and existing audio. It includes separate sub-10 MB
web copies. See `narration/FOOD-REFRESH-DELIVERY.md`; earlier editions remain intact.

The owner approved the visual treatment and requested both full films. See
`FULL-DELIVERY.md` for completed export and playback checks. Do not publish local captures.

## Story

| Time | Scene |
| --- | --- |
| 0-10s | Today and current glucose |
| 10-22s | Health overview and sleep |
| 22-28s | Meet Tarv1s |
| 28-38s | Genuine question submission and recorded waiting state |
| 38-54s | Answer and recorded evidence, held for reading |
| 54-66s | Daily timeline |
| 66-80s | Food search and unsaved selection |
| 80-90s | T1 Arc closing |

The short sample shows Today, Health and the answer as separate editorial shots.
It does not portray an instant answer. The full question scene contains the
genuine submission and waiting footage, with no request to make the app's answer
shorter. The complete processing interval was not captured in that clip. The
separate answer capture follows a cut labelled "After processing". This is an
edited demonstration, not a continuous recording or a response-time benchmark.
The question is quoted outside the phone for readability; the app pixels remain
untouched.

## Visual system

Original graphite Android-style hardware, bevels, side buttons, ports and studio
lighting. No manufacturer model or branding is used. The display is textured
with the actual 1080x2404 phone captures at their original aspect ratio. The
scene, typography and camera animation render at 4K; the app captures are not
native 4K. No AI-generated intermediate application frames are used.

Manrope is bundled under the SIL Open Font License in `public/fonts/OFL.txt`.
Camera animation is frame-driven. Video textures use the documented Remotion
headless Video/onVideoFrame route and explicitly redraw after decode completes.
Portrait has its own camera/framing and type layout, not a crop of landscape.

## Media handling

`public/captures/`, `.render/` and `out/` are ignored by Git. They contain the
owner-authorised health footage and must stay local unless separately approved.
No credentials are part of this project. ElevenLabs/OpenAI keys must never enter
browser code or the captured application frame.

Android produced one-frame recordings for completely static views. Their exact
source frames are held for 15 seconds in the `*-hold.mp4` files. This is an editorial
hold, not invented app activity. Question and food clips preserve real timing;
the last valid frame is held if the scene extends beyond the recording.

The food clip shows a search and a draft selection, not a saved meal. The draft
was discarded after filming. No sample health records were added to the owner's
phone for the film. The later food refresh uses a separate synthetic emulator profile.
The corrected question clip was checked against History before inclusion.

Private source provenance and app verification are in
`.qa/phone-update-promo-2026-09-07/VERIFICATION.md` at the repository root.

## Preview and checks

From this directory:

```sh
npm run lint
npx remotion studio --no-open --port=4327
npx remotion render src/index.ts T1Arc-Treatment-Landscape out/treatment.mp4 --gl=angle --concurrency=2 --crf=17 --image-format=jpeg --jpeg-quality=95
```

Registered IDs: `T1Arc-Treatment-Landscape`, `T1Arc-Treatment-Portrait`,
`T1Arc-Film-Landscape` and `T1Arc-Film-Portrait`.

Export QA includes full decoding, 720 frames at 60 fps for each sample, dimensions,
timestamps, typography, texture orientation, clean reading holds and filmstrips.
The final silent masters are losslessly remuxed to remove Remotion's empty AAC
track. Smaller 1080p sharing copies and a native 4K poster are also in `out/`.

Full films and sharing copies pass decoding, frame-count and timing checks.
Earlier exports remain available separately. The mixed edition adds the approved
voice and music; publication still requires the owner's approval.
