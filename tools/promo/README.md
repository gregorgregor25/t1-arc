# T1 Arc product film tools

The current production workspace is [v4/](v4/README.md). Its 90-second film uses
George narration, Signal Drift music, the privacy ending and the current food UI.
The selected viewing copy and separate soundtrack/title-credit notice are in
[docs/media](../../docs/media/README.md). See [sharing guidance](SHARING.md).

These optional maintainer tools are not app installation steps. App users should
follow the [main APK download guide](../../README.md). Raw captures, audio,
generated production files and workspace dependencies are excluded; a fresh clone
needs its own authorised inputs to reproduce an edit.

V1–V3 and their reports are historical editions, not the current demo. In
particular, the silent-film and synthetic-data descriptions below apply only to
V1, not to the current narrated film or all its footage. No statement below
licenses the current film's voice or music under MIT.

## Historical V1 production guide

A 46-second introduction to T1 Arc, led by Tarv1s. It shows the real Android
app inside an original 3D phone, followed by the five watch faces on original
3D watch models. The scene is rendered in Three.js, not generated video.

The landscape version is 1920 × 1080. The vertical version is 1080 × 1920.
Both use 30 fps H.264 MP4 with captions baked in and no audio. A silent film
works without sound; no music, voice or purchased device assets are included.

This folder is a separate media tool. It does not run in the Android app or
change its dependencies, data or behaviour.

## What the film shows

| Time | Screen |
| --- | --- |
| 0–8 s | Tarv1s: questions about your own records, with the BYOK requirement |
| 8–16 s | Today: glucose, insulin, food and health context |
| 16–23 s | History and Health: timeline, meals, activity and sleep |
| 23–30 s | Food: search, scan, a custom example food and copying from another day |
| 30–33 s | Pace: value, direction and freshness on a watch |
| 33–40 s | Meridian, Chronograph, Atelier, Pace and Summit |
| 40–46 s | T1 Arc closing frame and repository address |

The phone and watch PNGs are unmodified emulator captures. The phone uses a
fresh profile with the app's built-in example data. The custom yoghurt bowl
is a fictional entry, not a nutrition reference. Watch captures use separate
synthetic fixtures, so their time and step totals do not represent a live
paired session. No personal health records, accounts, keys or conversations
appear. The Tarv1s screen is genuine; the film does not fabricate an AI answer.
Capture versions, dimensions and hashes are in `assets/provenance.json`.

The film is promotional footage, not proof that every integration or physical
device has passed acceptance testing. It does not announce release availability.
Keep the example-data and treatment-boundary captions when sharing it.

## Preview or re-render

These instructions are for maintaining the media, not installing T1 Arc.
App users download an APK from a published GitHub release.

Use Node.js 24+, an installed Chrome or compatible Chromium browser, and an
ffmpeg build with the `libx264` encoder. Install this folder's pinned dependencies
with `npm ci --ignore-scripts`. Nothing is loaded from a CDN.

From this directory, in PowerShell:

```powershell
$env:T1ARC_PROMO_BROWSER = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm test
node verify-preview.mjs
node render.mjs --stills
node render.mjs --stills --portrait
node render.mjs
node render.mjs --portrait
node verify-video.mjs
```

Set `T1ARC_PROMO_FFMPEG` and `T1ARC_PROMO_FFPROBE` if those programs are not on PATH. Add `--draft` for a smaller
15 fps render while editing. Generated files go in the ignored `output/`
directory. Each full render also writes eight stills and a `render.json` report.
The verifier checks codec, resolution, frame count, duration and fast-start
metadata, decodes every frame and exports contact sheets for visual review.

`npm run preview` starts a loopback-only preview at port 4317. Add
`?format=portrait` for the vertical layout. It starts paused, supports seeking
and never reads an app database or an existing browser profile.

After changing a captured PNG, review it for privacy and accuracy, then run
`node prepare-assets.mjs` to refresh its provenance hash. This is not an
automatic privacy check. Do not replace demo screens with a person's data.

## Editing and reuse

- Captions and timings: `storyboard.mjs`.
- Device geometry: `models.mjs`.
- Camera movement and scene lighting: `app.mjs`.
- Landscape and vertical caption layout: `styles.css`.
- Public sharing notes and a text alternative: `SHARING.md`.

The device geometry and scene code are original T1 Arc work under the
repository's MIT licence. Three.js is MIT licensed. Playwright Core is Apache
2.0 licensed. Their notices stay in their installed packages and the lockfile
records the exact versions. No font files, music or third-party 3D models are
redistributed. System fonts are rendered into the video.

The source is reproducible with the recorded inputs and versions. Exact encoded
bytes can vary across browser, GPU and encoder versions, so compare the rendered
content and verification report as well as the final file hash.
