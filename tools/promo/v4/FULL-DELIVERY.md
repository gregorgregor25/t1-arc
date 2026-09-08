# Full film delivery

## Status

Both complete films, both sharing copies and both posters are rendered locally.
The approved 12-second samples are preserved. No publication has been performed.

## Deliverables

- Landscape master: `out/T1-Arc-V4-full-landscape-4K.mp4`, 3840x2160.
- Portrait master: `out/T1-Arc-V4-full-portrait-4K.mp4`, 2160x3840.
- Smaller sharing copies: `out/T1-Arc-V4-full-*-sharing.mp4`, 1920x1080 and
  1080x1920 respectively.
- Separate native-resolution landscape and portrait posters.
- Machine-readable verification: `out/*-full-verification.json`.

Both films are 90 seconds at 60 fps. Music and narration are intentionally
separate, so the delivered videos contain no audio track. No synthetic speech
was generated and no API account was accessed for this export. There is no
narration transcript or speech subtitle file because these are silent films.

## What is shown

Today and current glucose, Health and sleep, Tarv1s, a genuine average-glucose
question and its recorded answer, the daily timeline, food search and closing.
See `PRODUCTION.md` for scene timings and capture handling.

The question is exactly "What was my average glucose yesterday?" The answer
shows 6.6 mmol/L, 332 readings and 100% observed coverage for 6 September. This
is recorded personal data, not a claim about an improvement caused by the app.

The question clip shows submission and waiting. A separate answer capture is
introduced with "After processing". The film is edited and is not a continuous
recording or a speed benchmark. Static captured views and the final recorded
answer frame are deliberately held for reading. No app interactions, meals,
answers or intermediate app frames were generated. Food remains an unsaved
selection, with no suggestion that the Save meal button was pressed.

## Quality checks

- V4 ESLint and TypeScript: passed after full-film edits.
- All four video files pass full FFmpeg decoding with errors treated as fatal.
  Each contains exactly 5,400 frames at 60 fps, runs for 90.000 seconds and has
  no audio stream. Maximum timestamp error is 0.000000334 seconds.
- Both native-resolution masters preserve Remotion's full-range 8-bit 4:2:0
  encoding. Sharing copies explicitly convert to limited-range BT.709 with
  matching colour tags, rather than dropping the source's matrix metadata.
- Full-film contact sheets and exact frames around every scene cut reviewed.
  Screen textures remain visible, titles stay within the composition, the answer
  hold survives the source clip ending, and the final frame is intact.
- Both 4K masters played from start to end in the local browser with no media
  error. Portrait was reviewed at 390px width. The question and primary answer
  remain readable; dense in-app evidence details are secondary, not enlarged
  beyond the source recording's real resolution.
- Exact hashes, sizes, dimensions and decoding evidence are in the two
  `out/*-full-verification.json` reports.

## Reproduce locally

Run each render from this directory, then finalize the corresponding export:

```sh
npx remotion render src/index.ts T1Arc-Film-Landscape .render/full-landscape-raw.mp4 --gl=angle --concurrency=3 --codec=h264 --crf=17 --image-format=jpeg --jpeg-quality=95
node scripts/finalize.mjs landscape
npx remotion render src/index.ts T1Arc-Film-Portrait .render/full-portrait-raw.mp4 --gl=angle --concurrency=3 --codec=h264 --crf=17 --image-format=jpeg --jpeg-quality=95
node scripts/finalize.mjs portrait
```

`node scripts/review.mjs` opens a review server on 127.0.0.1:4327 only. It serves
the four named deliverable videos, not the repository or raw captures. Stop it
after review. All videos remain local until the owner approves publication.

V1-V3, the app, installed phone and watch were not changed during this full-film
rendering task. The samples remain available beside these full exports.
