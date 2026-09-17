# Produce the current T1 Arc film

This optional Remotion workspace is separate from the Android app. Start with
the [workspace setup and media conditions](README.md). A fresh clone does not
include personal captures, narration, music or previous finished masters.
Supply authorised inputs matching the scripts' expected paths before running.

## Current pipeline

The 90-second film uses the prepared narrated privacy edition, replacing seconds
66–80 with a new food scene. Earlier and later scenes and existing audio are
preserved. The base `T1Arc-Film-*` composition alone does not create this edition.

From the repository root:

```sh
node tools/promo/v4/scripts/prepare-food-refresh.mjs
node tools/promo/v4/scripts/render-food-refresh.mjs landscape
node tools/promo/v4/scripts/render-food-refresh.mjs portrait
node tools/promo/v4/scripts/export-food-refresh.mjs landscape
node tools/promo/v4/scripts/export-food-refresh.mjs portrait
```

The wrapper selects the promo directory and empty public configuration. No
narration-generation API request is needed. Results go to ignored
`tools/promo/v4/out/food-refresh/`. Use the exporter's `--verify-only` option
to check existing outputs without re-encoding.

## Review before sharing

The exporter checks full decode, duration, frame timing, unchanged audio and
captions, and preservation of scenes outside the replacement. Web copies are
re-encoded to meet their size limit and do not claim identical compressed video.
Inspect both layouts at ordinary viewing sizes, including the splice points;
technical checks cannot establish readability, consent or media rights.

Keep source captures and delivery reports private. Publish only selected media
with permission and the [required credits](../../../docs/media/README.md).
