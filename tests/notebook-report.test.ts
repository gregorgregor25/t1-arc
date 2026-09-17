import { describe, expect, it } from "vitest";

import { buildNotebookReport } from "@/data/notebook/notebookReport";
import type { NotebookEntry } from "@/domain/personalNotebook";

const scope = { ownerIdentity: "owner-private-digest", dataMode: "live" };
const entry: NotebookEntry = {
  id: "private-id", ...scope, createdAt: Date.parse("2026-09-08T12:00:00Z"), title: "A question for my appointment",
  answer: "Average glucose was 6.6 mmol/L.", note: "What patterns should I keep a note of?",
  limitations: ["Missing readings were not treated as zero."],
  evidence: [{ label: "Yesterday", description: "332 recorded readings; full observed coverage.", recordCount: 332, range: { start: Date.parse("2026-09-06T23:00:00Z"), end: Date.parse("2026-09-07T23:00:00Z") }, sourceIds: ["librelinkup"] }],
};
const options = { locale: "en-GB", timeZone: "Europe/London" };

describe("previewed appointment notes", () => {
  it("includes the actual saved answer, evidence range, coverage description and limitations", () => {
    const report = buildNotebookReport([entry], scope, options);
    for (const value of [entry.answer, entry.note, entry.limitations[0], entry.evidence[0]?.description, "332 records", "7 Sept 2026"]) expect(report.text).toContain(value);
    expect(report.text).not.toContain(scope.ownerIdentity);
    expect(report.text).not.toContain(entry.id);
    expect(report.html).toContain("Europe/London");
    expect(report.html).toContain("@media print");
  });
  it("requires explicit archive inclusion and labels archived observations", () => {
    const archived = { ...entry, ownerIdentity: "other-owner" };
    expect(() => buildNotebookReport([archived], scope, options)).toThrow("other connections");
    const report = buildNotebookReport([archived], scope, { ...options, includeArchives: true });
    expect(report.text).toContain("From another connection or restored backup");
    expect(report.html).not.toContain("other-owner");
  });
  it("cannot mix demo and live reports even after archive approval", () => {
    expect(() => buildNotebookReport([{ ...entry, dataMode: "demo" }], scope, { ...options, includeArchives: true })).toThrow("Demo and personal");
  });
  it("requires a selection of one to five items", () => {
    expect(() => buildNotebookReport([], scope, options)).toThrow("five");
    expect(() => buildNotebookReport(Array.from({ length: 6 }, (_, index) => ({ ...entry, id: String(index) })), scope, options)).toThrow("five");
  });
  it("escapes all saved content and prevents active HTML or remote resources", () => {
    const report = buildNotebookReport([{ ...entry, title: '<script>alert("x")</script>', note: '<img src="https://evil.test/track">', answer: "Fish & chips" }], scope, options);
    expect(report.html).toContain("&lt;script&gt;");
    expect(report.html).toContain("&lt;img");
    expect(report.html).not.toContain("<script>");
    expect(report.html).not.toContain("<img");
    expect(report.html).toContain("default-src 'none'");
    expect(report.html).toContain("Fish &amp; chips");
  });
  it("distinguishes an answer's original date from a standalone note's save date", () => {
    const answer = buildNotebookReport([{ ...entry, id: "answer:original-message" }], scope, options);
    expect(answer.text).toContain("Answer from 8 Sept 2026");
    expect(answer.html).toContain("Answer from 8 Sept 2026");
    const note = buildNotebookReport([entry], scope, options);
    expect(note.text).toContain("Saved 8 Sept 2026");
  });
});
