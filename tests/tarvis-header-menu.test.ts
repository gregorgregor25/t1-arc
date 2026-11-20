import { describe, expect, it } from "vitest";

import { tarvisHeaderMenuItems } from "@/components/tarvis/headerMenuItems";
import { TARVIS_MENU_TOP_GAP, tarvisMenuSheetLayout } from "@/components/tarvis/headerMenuLayout";

const home = {
  historyVisible: false,
  conversationVisible: false,
  exchangeCount: 0,
  notebookAvailable: true,
  working: false,
};

describe("Tarv1s header menu", () => {
  it("keeps history, notebook and the two Settings links on the Ask home", () => {
    expect(tarvisHeaderMenuItems(home).map(({ id }) => id)).toEqual([
      "history",
      "notebook",
      "weekly-reviews",
      "settings",
    ]);
  });

  it("adds new conversation, export and report while a conversation is open", () => {
    const items = tarvisHeaderMenuItems({ ...home, conversationVisible: true, exchangeCount: 2 });
    expect(items.map(({ id }) => id)).toEqual([
      "history",
      "new-conversation",
      "notebook",
      "export",
      "report",
      "weekly-reviews",
      "settings",
    ]);
    expect(items.every(({ disabled }) => !disabled)).toBe(true);
  });

  it("disables starting again and reporting while an answer is being prepared", () => {
    const items = tarvisHeaderMenuItems({ ...home, conversationVisible: true, exchangeCount: 1, working: true });
    const disabled = items.filter(({ disabled }) => disabled).map(({ id }) => id);
    expect(disabled).toEqual(["new-conversation", "report"]);
  });

  it("hides history inside history and the notebook without a known owner", () => {
    const ids = tarvisHeaderMenuItems({ ...home, historyVisible: true, notebookAvailable: false }).map(({ id }) => id);
    expect(ids).toEqual(["weekly-reviews", "settings"]);
  });

  it("says where the settings now live", () => {
    const items = tarvisHeaderMenuItems(home);
    expect(items.find(({ id }) => id === "settings")?.detail).toBe("Connection and privacy, in Settings");
    expect(items.find(({ id }) => id === "weekly-reviews")?.detail).toBe("In Settings, Notifications and reminders");
  });
});

describe("Tarv1s header menu sheet layout", () => {
  const insets = { top: 32, right: 48, bottom: 24, left: 0 };

  it("keeps the sheet clear of the system bars and caps its height to the window", () => {
    expect(tarvisMenuSheetLayout(800, insets)).toEqual({
      paddingTop: 32 + TARVIS_MENU_TOP_GAP,
      paddingLeft: 0,
      paddingRight: 48,
      bottomInset: 24,
      maxHeight: 800 - 32 - TARVIS_MENU_TOP_GAP,
    });
  });

  it("leaves a short landscape window a bounded sheet whose list scrolls", () => {
    // Seven 56dp rows plus the title and Cancel need far more than this.
    const { maxHeight } = tarvisMenuSheetLayout(360, insets);
    expect(maxHeight).toBe(360 - 32 - TARVIS_MENU_TOP_GAP);
    expect(maxHeight).toBeLessThan(7 * 56);
  });

  it("never returns a negative height", () => {
    expect(tarvisMenuSheetLayout(10, insets).maxHeight).toBe(0);
  });
});
