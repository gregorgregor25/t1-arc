import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { serviceStatusMessage } from "../src/domain/serviceMessages";

describe("plain error wording", () => {
  it("explains unexpected service replies without developer terms", () => {
    for (const status of [400, 401, 403, 404, 429, 500, 503]) {
      const message = serviceStatusMessage("Example", status);
      expect(message).not.toMatch(/HTTP|endpoint|request failed/i);
      expect(message).toContain(`(Code ${status})`);
      expect(message.startsWith("Example ")).toBe(true);
    }
    expect(serviceStatusMessage("Example", 503)).toMatch(/try again later/i);
    expect(serviceStatusMessage("Example", 401)).toMatch(/sign-in details/);
  });

  it("gives every error card a specific title", () => {
    const files = [
      "src/screens/TodayScreen.tsx",
      "src/screens/HistoryScreen.tsx",
      "src/screens/RecordsScreen.tsx",
      "src/screens/CycleTrackingScreen.tsx",
      "src/components/HealthConnectRecordReview.tsx",
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const cards = source.split("<ErrorCard").slice(1);
      expect(cards.length).toBeGreaterThan(0);
      for (const card of cards) {
        expect(card.slice(0, card.indexOf("/>"))).toMatch(/title="[^"]+"/);
      }
    }
    expect(readFileSync("src/components/ErrorCard.tsx", "utf8")).not.toContain("Data unavailable");
  });

  it("offers Retry where the screen can reload its data", () => {
    expect(readFileSync("src/screens/TodayScreen.tsx", "utf8")).toContain("onRetry={selectedTimeline.reload}");
    expect(readFileSync("src/screens/HistoryScreen.tsx", "utf8")).toContain("onRetry={timeline.reload}");
    const records = readFileSync("src/screens/RecordsScreen.tsx", "utf8");
    expect(records).toContain("dailyHealth.reload();");
    expect(records).toContain("healthTrend.reload();");
  });
});
