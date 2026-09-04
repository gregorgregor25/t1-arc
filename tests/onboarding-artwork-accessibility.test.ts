import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const artworkSource = readFileSync(
  path.join(process.cwd(), "src", "screens", "onboarding", "TourArtwork.tsx"),
  "utf8",
);

describe("onboarding artwork accessibility", () => {
  it("keeps composite mock-up text at design size while surrounding tour copy remains scalable", () => {
    expect(artworkSource).toContain(
      "const TOUR_ARTWORK_MAX_FONT_SIZE_MULTIPLIER = 1;",
    );
    expect(artworkSource).toContain("function ArtworkText(");
    expect(artworkSource).toContain(
      "maxFontSizeMultiplier={TOUR_ARTWORK_MAX_FONT_SIZE_MULTIPLIER}",
    );
    // TourArtwork is exposed to assistive technology as one labelled image.
    // Keeping every visual label behind this wrapper prevents fixed mock-up
    // geometry from overlapping at Android's largest font setting.
    expect(artworkSource.match(/<Text(?:\s|>)/g) ?? []).toHaveLength(1);
    expect(artworkSource).not.toContain("</Text>");
    expect(artworkSource).toContain(
      'importantForAccessibility="no-hide-descendants"',
    );
  });
});
