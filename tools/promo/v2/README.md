# A closer look at T1 Arc

This is the interaction-led revision of the original product film. It gives
Tarv1s room to answer a useful question, then shows everyday phone workflows.
Original Three.js device geometry is used for the short opening and closing.
The main scenes use actual screen recordings with a steady, readable frame.

V1 remains unchanged in the parent directory. V2 writes only to the ignored
`tools/promo/output/v2/` folder. It does not build, install or alter the app.

## Captures and consent

V2 can use personal phone captures only with the owner's explicit approval.
Keep recordings, private captions, answer excerpts and the edit manifest out
of source control. Never extract an API key to make a film. Use the app's normal
interface, and do not create fictional saved health records for a shot.

Do not replace a rejected or failed answer with an invented successful one.
Reopening a genuine saved answer is fine, but record that provenance accurately.
Shorten waiting time when editing without claiming that the film measures latency.
Keep general education distinct from personal-record analysis.

All footage is cropped before the local preview serves it. The standard crop
removes the status and Android navigation bars from 1080 x 2404 captures. This
does not automatically remove notification banners, keys or identifiers inside
the app. Review the footage manually and omit unsuitable clips.

## Local workflow

Use the existing dependencies in the parent media tool. No CDN, user browser
profile, app database or connected cloud account is used by the renderer.
Node.js, a local Chrome binary and ffmpeg/ffprobe are required.

From the repository root:

```powershell
node --test tools/promo/v2/test.test.mjs tools/promo/test/*.test.mjs
node tools/promo/v2/render.mjs --stills
node tools/promo/v2/render.mjs --stills --portrait
node tools/promo/v2/render.mjs --skip-prep
node tools/promo/v2/render.mjs --skip-prep --portrait
node tools/promo/v2/verify.mjs
```

The private `output/v2/edit.json` names the owner-approved clips, in-points,
durations, captions and provenance. Source paths resolve against `tools/promo`.
`edit.mjs` validates the required fields. The same scene timings are used in
both formats, with shorter captions for the vertical layout.

Use `--skip-prep` only after the stills step has prepared the cropped assets.
Do not run two asset-preparation passes concurrently. Once prepared, the two
format renders can run independently. End-frame holds let a short capture stay
on screen for reading; no unrecorded action is added.

`node tools/promo/v2/server.mjs` starts the loopback-only scene preview on port
4318. It has previous/next controls and no autoplay. The preview shows scene
posters, not the finished video. Use the rendered MP4 to review timing and motion.

The verifier checks resolution, H.264, frame count, duration, pixel format,
fast-start metadata and complete decoding. It rejects extra audio or metadata
streams and exports a contact sheet plus three full-size samples per scene.
These checks supplement visual review; they do not replace it.

## Outputs

- `output/v2/landscape/T1-Arc-A-Closer-Look-landscape.mp4`
- `output/v2/portrait/T1-Arc-A-Closer-Look-portrait.mp4`
- Per-format preview PNGs and render reports.
- `output/v2/verification.json` and per-format decoded review frames.

Nothing is published or uploaded automatically. Personal capture approval is
not permission for unrelated uploads or changes to repository visibility.
