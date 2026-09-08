# Cinematic studio V3

A separate Three.js pipeline for the T1 Arc product film. A graphite Android
phone carries genuine recorded app footage through a dark studio. The camera
moves closer for reading, settles, then pulls back for the next interaction.
Landscape and portrait have their own compositions, not a centre crop.

The owner accepted the 12-second visual sample and rejected its soundtrack.
Current exports are silent. Music and narration will be handled separately.
V1, V2, their exports, and all application code are preserved.

## Run locally

Use the dependencies already installed in tools/promo. From the repository root:

```powershell
node --test tools/promo/test/*.test.mjs tools/promo/v2/test.test.mjs tools/promo/v3/test.test.mjs
node tools/promo/v3/server.mjs
```

The preview is loopback-only on port 4319. Add `?format=portrait` for the
vertical sample, or `?format=portrait&film=1` for the full vertical film.
Use `format=landscape` for the horizontal composition. Playback is manual.
Preview controls never appear in the encoded films.

## Sample and full-film rendering

Private, owner-approved input manifests must already be present. These are not
distributed with the public source because they refer to personal recordings.

```powershell
# Sample. Add --portrait for the other format.
node tools/promo/v3/render.mjs --stills
node tools/promo/v3/render.mjs --skip-prep

# Full film. Preparation requires recorded visual approval and deferred audio.
node tools/promo/v3/prepare-film.mjs
node tools/promo/v3/render-film.mjs --stills
node tools/promo/v3/render-film.mjs --portrait --stills
node tools/promo/v3/render-film.mjs
node tools/promo/v3/render-film.mjs --portrait
node tools/promo/v3/verify-film.mjs
```

The full film is 91 seconds. Masters are 3840 x 2160 and 2160 x 3840 at 60 fps.
Each master also has a half-resolution sharing copy. Rendering uses an isolated
headless Chrome process, native output-size frames and H.264 with BT.709 colour.
No device connection or application build is needed.

Prepared source PNGs retain the real recording's motion at 30 fps. When both
the source frame and every visible camera/copy parameter are unchanged, the
renderer reuses identical pixels. All 5,460 output frames remain present.
Short clips hold their last recorded frame; they do not loop or invent actions.

## Private input and honest output

The owner-approved manifest lives in ignored output/v3/sample.json. It supplies
the source MP4 path, crop, editorial titles, provenance and pending narration
script. Source paths resolve relative to tools/promo. Prepared frames, audio,
exports and verification evidence also remain ignored. Do not commit real data.

4K describes the rendered scene, typography and export. The original phone
recordings are 1080 pixels wide. Enlarging them is not native 4K capture, and
there are no AI-generated intermediate app frames.

The Tarv1s section retains the real question, answer, evidence strength and
limits. A whole-period comparison is not presented as proof of the cause of
individual episodes. The follow-up section uses another genuine conversation.
The food sequence ends with a draft, not a claimed successful meal save.

## Audio is a separate pass

Neither current renderer requests speech, extracts credentials nor includes
an audio stream. The old procedural score and music-bearing sample exports
are retained only as historical work. They are not part of the current film.
The historical `verify.mjs` checks those old samples; `verify-film.mjs` checks
the silent full-length exports and explicitly rejects any audio stream.

Narration requires separate access and spending approval. Never extract the
API key stored in T1 Arc. Speech timing, subtitles, pronunciation, a discreet
AI-narration credit and the final audio mix must be reviewed when speech is
actually added. Do not label a silent film as narrated or invent captions for
speech that does not exist.

## Verification and privacy

`verify-film.mjs` checks dimensions, codecs, colour metadata, frame count,
every presentation timestamp, complete decoding and fast-start layout. It
creates scene contact sheets, encoded-frame stills, ordinary phone-size
reading checks and a poster for each format. Human visual review is a separate
step and must be described honestly in the handover.

Source recordings, input manifests, prepared frames, posters, rendered films
and verification reports stay in ignored local folders. Do not commit or
publish personal captures. Approval of the visual direction is not approval
to publish. This pipeline makes no app, watch, account or health-data changes.
