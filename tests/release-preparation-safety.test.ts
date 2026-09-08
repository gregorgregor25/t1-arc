import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { load } = require("js-yaml") as { load: (value: string) => unknown };
const { prepareDraftReleaseNotes } = require("../scripts/prepare-release-notes.cjs") as {
  prepareDraftReleaseNotes: (template: string, record: unknown, commit: string) => string;
};
const root = fileURLToPath(new URL("..", import.meta.url));
const source = (path: string) => readFileSync(join(root, path), "utf8");
interface WorkflowJob {
  if?: string;
  uses?: string;
  needs?: string;
  permissions?: { contents: string };
  environment?: string;
  secrets?: unknown;
  steps?: { name?: string; run?: string; if?: string; uses?: string; with?: Record<string, unknown> }[];
}
interface Workflow {
  on: Record<string, unknown>;
  permissions: { contents: string };
  jobs: Record<string, WorkflowJob>;
}
const releaseText = source(".github/workflows/release.yml");
const qualityText = source(".github/workflows/quality.yml");
const release = load(releaseText) as Workflow;
const quality = load(qualityText) as Workflow;
const commit = "a".repeat(40);
const record = {
  sourceCommit: commit,
  applicationId: "io.github.gregorgregor25.t1arc",
  version: "1.7.1",
  versionCode: 28,
  apk: "T1-Arc-v1.7.1.apk",
  sha256: "b".repeat(64),
};
const template = source("docs/RELEASE_NOTES_TEMPLATE.md");
const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("release safety boundaries", () => {
  it("requires the entire same-commit reusable quality workflow without passing secrets", () => {
    expect(quality.on).toHaveProperty("workflow_call");
    expect(release.jobs.quality).toMatchObject({
      uses: "./.github/workflows/quality.yml", permissions: { contents: "read" },
    });
    expect(release.jobs.quality).not.toHaveProperty("secrets");
    expect(release.jobs.quality).not.toHaveProperty("environment");
    expect(release.jobs["prepare-release"]).toMatchObject({
      needs: "quality", environment: "production", permissions: { contents: "write" },
    });
    expect(release.permissions.contents).toBe("read");
    expect(quality.permissions.contents).toBe("read");
    expect(quality.jobs).toHaveProperty("archived-node-services");
    expect(qualityText).toContain(":t1arc-food-label:testDebugUnitTest");
    expect(qualityText).toContain(":app:processReleaseResources");
    expect(qualityText).not.toContain("secrets.");
  });

  it("keeps manual confirmation and uses the actual default branch, not a fixed legacy name", () => {
    expect(release.on).toHaveProperty("workflow_dispatch");
    for (const name of ["quality", "prepare-release"]) {
      expect(release.jobs[name]?.if).toBe(
        "inputs.confirmation == 'PREPARE SIGNED RELEASE' && github.ref == format('refs/heads/{0}', github.event.repository.default_branch)",
      );
      expect(release.jobs[name]?.if).not.toContain("always()");
    }
  });

  it("checks out the exact SHA and checks clean source before decoding production keys", () => {
    const steps = release.jobs["prepare-release"]!.steps!;
    expect(steps[0]?.with).toMatchObject({ ref: "${{ github.sha }}", "persist-credentials": false });
    const clean = steps.findIndex((step) => step.name === "Confirm clean source before signing");
    const decode = steps.findIndex((step) => step.name === "Decode the protected app and face keystores");
    expect(clean).toBeGreaterThan(-1);
    expect(decode).toBeGreaterThan(clean);
    expect(steps[decode]?.run).toContain("umask 077");
    expect(steps[clean]?.run).toContain("source.modified !== false");
    expect(steps[clean]?.run).toContain("source.commit !== process.env.GITHUB_SHA");
    for (const job of Object.values(quality.jobs)) {
      for (const step of job.steps ?? []) {
        if (step.uses?.startsWith("actions/checkout@")) expect(step.with?.["persist-credentials"]).toBe(false);
      }
    }
  });

  it("creates an immutable new ref before a draft and attaches reviewed-template notes", () => {
    const steps = release.jobs["prepare-release"]!.steps!;
    const draft = steps.find((step) => step.name === "Create a draft GitHub Release")!.run!;
    expect(draft.indexOf('gh api --method POST "repos/$GITHUB_REPOSITORY/git/refs"')).toBeLessThan(draft.indexOf("gh release create"));
    expect(draft).toContain('-f "ref=refs/tags/$RELEASE_TAG" -f "sha=$GITHUB_SHA"');
    expect(draft).toContain("--verify-tag");
    expect(draft).toContain("--draft");
    expect(draft).toContain('--notes-file "$RUNNER_TEMP/t1arc-release-notes.md"');
    expect(draft).not.toContain("--generate-notes");
    expect(draft).not.toMatch(/--clobber|--force|--method PATCH/);
    const cleanup = steps.findIndex((step) => step.name === "Remove the decoded keystores");
    expect(steps[cleanup]?.if).toBe("always()");
    expect(steps.findIndex((step) => step.name === "Prepare user-readable draft notes")).toBeGreaterThan(cleanup);
  });
});

describe("actual draft release-note rendering", () => {
  it("fills verified build facts but leaves runtime acceptance explicitly pending", () => {
    const notes = prepareDraftReleaseNotes(template, record, commit);
    expect(notes).toContain("# T1 Arc v1.7.1");
    expect(notes).toContain(`/blob/${commit}/docs/RELEASE_STATUS.md`);
    expect(notes).toContain(`- APK SHA-256: \`${record.sha256}\`.`);
    expect(notes).toContain(`- Source commit and build record: \`${commit}\`; \`${record.apk}.build.json\`.`);
    expect(notes).toContain("pending, not passes");
    expect(notes).toContain("Clean install: pass/fail and test device.");
    expect(notes).toContain("does not calculate doses");
    expect(notes).toContain("five standalone");
    expect(notes).not.toContain("X.Y.Z");
    expect(notes).not.toContain("<!--");
    expect(notes).not.toContain("/blob/HEAD/");
  });

  it.each([
    { sourceCommit: "c".repeat(40) },
    { applicationId: "io.github.gregorgregor25.t1arc.sideload" },
    { version: "1.7.1-beta" },
    { versionCode: 0 },
    { apk: "different.apk" },
    { sha256: "unknown" },
  ])("rejects inconsistent or private build metadata: %j", (changed) => {
    expect(() => prepareDraftReleaseNotes(template, { ...record, ...changed }, commit)).toThrow();
  });

  it("rejects an incomplete template or mutable capability link", () => {
    expect(() => prepareDraftReleaseNotes("", record, commit)).toThrow(/template/);
    expect(() => prepareDraftReleaseNotes(template.replace("/blob/vX.Y.Z/", "/blob/HEAD/"), record, commit)).toThrow(/immutable/);
  });

  it("runs the actual CLI and refuses to overwrite a pre-existing notes file", () => {
    const directory = mkdtempSync(join(tmpdir(), "t1arc-release-notes-test-"));
    temporaryDirectories.push(directory);
    const input = join(directory, "build.json");
    const output = join(directory, "notes.md");
    writeFileSync(input, JSON.stringify(record));
    const args = [join(root, "scripts/prepare-release-notes.cjs"), input, output];
    const options = { cwd: root, encoding: "utf8" as const, env: { ...process.env, GITHUB_SHA: commit } };
    execFileSync(process.execPath, args, options);
    const notes = readFileSync(output, "utf8");
    expect(notes).toContain(record.sha256);
    expect(spawnSync(process.execPath, args, options).status).not.toBe(0);
    expect(readFileSync(output, "utf8")).toBe(notes);
  });
});
