import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

describe("public GitHub APK release", () => {
  it("keeps private packaging out of the normal quality workflow", () => {
    const workflow = source(".github/workflows/quality.yml");

    expect(workflow).toContain("name: T1 Arc quality");
    expect(workflow).not.toContain("private-android-release");
    expect(workflow).not.toContain("T1ARC_PRIVATE_TEST_BUILD");
    expect(workflow).not.toContain(".sideload");
    expect(workflow.match(/NODE_ENV: production/g)).toHaveLength(3);
  });

  it("creates only a verified draft from protected production signing", () => {
    const workflow = source(".github/workflows/release.yml");

    expect(workflow).toContain("name: Prepare signed Android release");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("environment: production");
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("T1ARC_RELEASE_KEYSTORE_BASE64");
    expect(workflow).toContain("T1ARC_RELEASE_STORE_PASSWORD");
    expect(workflow).toContain("T1ARC_RELEASE_KEY_ALIAS");
    expect(workflow).toContain("T1ARC_RELEASE_KEY_PASSWORD");
    expect(workflow).toContain(
      "Confirm protected signing secrets are configured",
    );
    expect(workflow).toContain("NODE_ENV: production");
    expect(workflow).toContain(":app:assembleRelease");
    expect(workflow).toContain(
      "-ExpectedApplicationId io.github.gregorgregor25.t1arc",
    );
    expect(workflow).toContain('"apk=T1-Arc-v$version.apk"');
    expect(workflow).toContain("$env:APK_NAME.sha256");
    expect(workflow).toContain("gh release create");
    expect(workflow).toContain("--draft");
    expect(workflow).toContain('git show-ref --verify --quiet "refs/tags/$expectedTag"');
    expect(workflow).toContain('git/matching-refs/tags/$RELEASE_TAG');
    expect(workflow).toContain('"release/$APK_NAME.build.json"');
    expect(workflow).toContain('$source.commit -cne $env:GITHUB_SHA');
    expect(workflow).toContain('$source.modified -ne $false');
    expect(workflow).toContain('-ExpectedSourceCommit $env:GITHUB_SHA');
    expect(workflow).toContain('-RequireCleanSource');
    expect(workflow).not.toContain("T1ARC_PRIVATE_TEST_BUILD");
    expect(workflow).not.toContain(".sideload");
  });

  it("documents the same APK name and update identity for users", () => {
    const readme = source("README.md");
    const installGuide = source("docs/GETTING_STARTED.md");
    const releaseStatus = source("docs/RELEASE_STATUS.md");

    for (const document of [readme, installGuide, releaseStatus]) {
      expect(document).toContain("T1-Arc-vX.Y.Z.apk");
    }
    expect(installGuide).toContain("Do not uninstall the existing app");
    expect(releaseStatus).toContain("io.github.gregorgregor25.t1arc");
  });
});
