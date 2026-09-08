# Current food UI refresh

8 September 2026. Separate edition in `out/food-refresh/`; all previous exports
remain in their original folders. This task does not upload media or change an APK.

## Scope

Only 66–80 seconds is replaced in the approved privacy edition. The story remains
90 seconds / 5,400 frames / 60 fps: Today 0–10, Health 10–22, Tarv1s introduction
22–28, question 28–38, answer 38–54, Timeline 54–66, Food 66–80, privacy 80–90.
The existing George narration, Signal Drift music, caption words/times, genuine
question/answer footage, and privacy ending remain intact.

The original graphite phone, lighting, editorial typography and separate portrait
layout are retained. Only the new fourteen-second scene is rendered at native
3840×2160 / 2160×3840. The app footage itself is 1080×2400, not native 4K.

## Genuine updated app capture

Captured from **emulator-5554 only**, the existing synthetic Android user12,
T1 Arc sideload1.7.1 / code28. The actual dark food UI shows an `oats raw` search,
the USDA `Oats, raw` selection, and portion options. The final actual screenshot
shows half of the source's one-cup portion: 1.41oz,27.1g carbs,152kcal.

No meal was saved or recipe/custom food created. The draft was discarded; the
existing synthetic profile still showed one logged meal afterwards. No real phone,
watch, installed APK, account credential or model-generation API was used.

This is an edited demonstration, not continuous interaction or a latency claim:

| Food-scene time | Source |
| --- | --- |
| 0–6s | First six seconds of the genuine search-result/selection recording |
| 6–9s | Recording14–17s, approaching/opening portion options |
| 9–14s | Held actual screenshot of the half-cup draft |

Android's sparse VFR timestamps are normalised to60fps before exact-frame edits.
Two pixels of padding are added above/below the1080×2400 capture to fit the original
1080×2404 phone texture without stretching app pixels. No invented, painted or
AI-generated app frames are used. The source recording, PNG and hashes/edit list
are retained under `.render/food-refresh/`; `capture-provenance.json` accompanies
the finished exports.

After capture, app appearance was restored to System through the app UI; Android
night mode to custom_bedtime; the temporary handwriting setting to absent/null;
foreground user to0. Rotation remained free and font scale1.0. ADB ownership was
then returned to the main QA task.

## Output and acceptance

Each orientation has three90-second MP4s named
`T1-Arc-{landscape,portrait}-{4K,sharing,web}-food-refresh.mp4`.
4K masters retain original native dimensions; sharing/web copies are1920×1080
or1080×1920. The web copies target under10,000,000 bytes while retaining60fps,
the original AAC audio and selectable English captions.

Each orientation has a privacy-ending poster and a food-preview poster. The
unchanged SRT,VTT and captions.json are alongside them. The two final verification
reports must be objects with `status: complete`, three successful reports, and
`protectedOriginalExports`; an intermediate progress report is not acceptance.

Completed files (all90s,5,400frames,60fps):

| Filename | Size |
| --- | --- |
| T1-Arc-landscape-4K-food-refresh.mp4 | 28,736,269 bytes |
| T1-Arc-portrait-4K-food-refresh.mp4 | 31,885,704 bytes |
| T1-Arc-landscape-sharing-food-refresh.mp4 | 10,570,330 bytes |
| T1-Arc-portrait-sharing-food-refresh.mp4 | 11,702,318 bytes |
| T1-Arc-landscape-web-food-refresh.mp4 | 9,168,314 bytes |
| T1-Arc-portrait-web-food-refresh.mp4 | 9,147,213 bytes |

Both web copies are below decimal10MB. All six full-decode/frame/audio/caption
checks passed. Maximum frame-time deviation is0.00000033333335s. All22 protected
previous MP4 exports retained their SHA-256 hashes. Promo ESLint/TypeScript and
the three new pipeline scripts' Node syntax checks passed.

The verifier checks full video/audio decode, all5,400 frame timestamps, exact
dimensions/duration/fps, unchanged AAC payload and caption text/times. For4K and
sharing, canonical compressed video hashes prove0–66s and80–90s unchanged. The web
copies explicitly re-encode the complete picture to meet the file-size limit;
they do not claim unchanged compressed video. All previous MP4 export hashes are
checked again before success. Final readable-frame/filmstrip review is recorded
in `out/food-refresh/visual-review.json`.

The final web question/answer, food and privacy frames were visually reviewed at
1280px landscape and390px portrait, including exact66s/80s scene boundaries.
Headlines, key nutrition totals, answer text and the OpenAI qualifier remain
readable; small app microcopy is naturally limited by the original overview-shot
framing. Full-story and food-only filmstrips were also inspected. Audio was not
subjectively re-auditioned; its original compressed payload is identical.

## Separate media rights

The owner confirmed Signal Drift was created on Suno's free tier. George narration
was generated using ElevenLabs' free allowance in the earlier approved edit.
This refresh uses those existing recordings unchanged; it obtains no new licence
and makes no claim of commercial rights or MIT coverage for the soundtracks.

The owner already approved the genuine earlier health footage and private GitHub
placement. Personal non-monetising use must follow the applicable free-tier terms;
this is distinct from a commercial licence. The publication title must include
`elevenlabs.io` or `11.ai` for the free narration; the film retains its separate
on-screen George/elevenlabs.io credit. A suitable title is
**T1 Arc — product film — AI narration by elevenlabs.io**.

- [ElevenLabs publication guidance](https://help.elevenlabs.io/hc/en-us/articles/13313564601361-Can-I-publish-the-content-I-generate-on-the-platform)
- [Suno free-plan rights guidance](https://help.suno.com/en/articles/9601601)
- [Current Suno terms](https://suno.com/terms)

The Manrope font's bundled SIL OFL remains in `public/fonts/OFL.txt`. The code's
licence does not automatically relicense media. This task makes no public upload,
subscription change, paid generation, or new voice/music generation.

## Reproduce from the review checkout

Run these scripts from the review checkout root, not another app checkout:

```powershell
node tools/promo/v4/scripts/prepare-food-refresh.mjs
node tools/promo/v4/scripts/render-food-refresh.mjs landscape
node tools/promo/v4/scripts/render-food-refresh.mjs portrait
node tools/promo/v4/scripts/export-food-refresh.mjs landscape
node tools/promo/v4/scripts/export-food-refresh.mjs portrait
```

The render wrapper selects the promo working directory and an intentionally empty
public configuration file; no API credentials are required. Existing outputs can
be verified without re-encoding with the exporter `--verify-only` option.
