import { describe, expect, it } from "vitest";

import { tarvisHeaderMenuItems } from "@/components/tarvis/headerMenuItems";

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
