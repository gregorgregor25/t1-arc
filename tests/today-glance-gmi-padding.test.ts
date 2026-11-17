import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/TodayGlanceCard.tsx", "utf8");

describe("Today glance GMI row", () => {
  it("pads extra tile rows like the tile text above them", () => {
    expect(source).toContain(
      "{children ? <View style={styles.tileExtra}>{children}</View> : null}",
    );
    const style = source.slice(source.indexOf("  tileExtra: {"));
    expect(style).toMatch(/^ {2}tileExtra: \{\s+paddingHorizontal: 14,\s+paddingBottom: 14,/);
  });
});
