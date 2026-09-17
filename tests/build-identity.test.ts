import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

import {
  buildDetailsText,
  describeBuildSource,
  parseBuildSource,
} from "@/domain/buildIdentity";

const require = createRequire(import.meta.url);
const { readBuildSource } = require("../scripts/build-source.cjs") as {
  readBuildSource(root: string, run: (...args: unknown[]) => string): unknown;
};
const commit = "a".repeat(40);

describe("build source capture", () => {
  it.each(["", " M src/example.ts\n", "?? new-feature.ts\n"])(
    "records the checkout revision and tracked or untracked edits (%j)",
    (status) => {
      const run = vi
        .fn()
        .mockReturnValueOnce("")
        .mockReturnValueOnce(`${commit}\n`)
        .mockReturnValueOnce(status);
      expect(readBuildSource("/project", run)).toEqual({
        commit,
        modified: status.length > 0,
      });
      expect(run).toHaveBeenCalledWith(
        "git",
        ["rev-parse", "HEAD"],
        expect.objectContaining({ cwd: "/project" }),
      );
      expect(run).toHaveBeenCalledWith(
        "git",
        ["status", "--porcelain", "--untracked-files=normal"],
        expect.objectContaining({ cwd: "/project" }),
      );
    },
  );

  it("does not invent a source identity for an archive or failed Git command", () => {
    expect(
      readBuildSource("/archive", () => {
        throw new Error("no Git");
      }),
    ).toEqual({ commit: null, modified: null });
    expect(readBuildSource("/project", () => "not a commit")).toEqual({
      commit: null,
      modified: null,
    });
  });

  it("does not attribute a parent repository to a nested source archive", () => {
    const run = vi.fn().mockReturnValue("exports/t1-arc/\n");
    expect(readBuildSource("/parent/exports/t1-arc", run)).toEqual({
      commit: null,
      modified: null,
    });
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("installed build details", () => {
  it.each([
    undefined,
    null,
    {},
    { commit },
    { commit: "../../other", modified: false },
  ])(
    "shows unknown provenance for missing or invalid metadata (%j)",
    (value) => {
      const source = parseBuildSource(value);
      expect(source).toEqual({ commit: null, modified: null });
      expect(describeBuildSource(source)).toBe("Not recorded in this build");
    },
  );

  it("distinguishes a clean source revision from local edits", () => {
    expect(
      describeBuildSource(parseBuildSource({ commit, modified: false })),
    ).toBe(commit.slice(0, 12));
    expect(
      describeBuildSource(parseBuildSource({ commit, modified: true })),
    ).toBe(`${commit.slice(0, 12)} + local changes`);
  });

  it("shares only build metadata and keeps the actual native package identity", () => {
    const report = buildDetailsText({
      applicationId: "io.github.gregorgregor25.t1arc.sideload",
      version: "1.6.9",
      buildNumber: "26",
      source: { commit, modified: false },
    });
    expect(report).toBe(
      [
        "T1 Arc build details",
        "Version: 1.6.9 (26)",
        "Package: io.github.gregorgregor25.t1arc.sideload",
        `Source: ${commit}`,
        "Local changes: No",
      ].join("\n"),
    );
  });
});
