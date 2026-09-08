const { readFileSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");

/** Fill build facts only. Device acceptance and editorial changes remain pending. */
function prepareDraftReleaseNotes(template, record, expectedCommit) {
  if (!record || typeof record !== "object" || Array.isArray(record) ||
      !/^[a-f0-9]{40}$/.test(expectedCommit ?? "") ||
      record.sourceCommit !== expectedCommit) {
    throw new Error("Draft notes require the exact workflow source commit.");
  }
  if (typeof record.version !== "string" || !/^\d+\.\d+\.\d+$/.test(record.version) ||
      record.apk !== `T1-Arc-v${record.version}.apk` ||
      record.applicationId !== "io.github.gregorgregor25.t1arc" ||
      !Number.isSafeInteger(record.versionCode) || record.versionCode < 1 ||
      typeof record.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(record.sha256)) {
    throw new Error("Draft notes require a verified public APK build record.");
  }
  if (typeof template !== "string" || !template.startsWith("# T1 Arc vX.Y.Z") ||
      !template.includes("## What changed") || !template.includes("## Verification")) {
    throw new Error("The reviewed release-notes template is missing or incomplete.");
  }
  const body = template
    .replace(/<!--[\s\S]*?-->\s*/g, "")
    .replaceAll("/blob/vX.Y.Z/", `/blob/${expectedCommit}/`)
    .replaceAll("X.Y.Z", record.version)
    .replace(/^(- APK SHA-256:).*$/m, `$1 \`${record.sha256}\`.`)
    .replace(/^(- Source commit and build record:).*$/m,
      `$1 \`${expectedCommit}\`; \`${record.apk}.build.json\`.`);
  if (/\/blob\/HEAD\//.test(body)) {
    throw new Error("Draft capability links must name an immutable source revision.");
  }
  return body.replace(/^(# T1 Arc [^\r\n]+)(\r?\n)/,
    "$1$2$2> Draft for maintainer review. Complete the change summary and exact-APK$2" +
    "> acceptance results before the owner approves publication. Unfilled checks$2" +
    "> below are pending, not passes.$2");
}

if (require.main === module) {
  try {
    const [recordPath, outputPath] = process.argv.slice(2);
    if (!recordPath || !outputPath || process.argv.length !== 4) {
      throw new Error("Usage: node scripts/prepare-release-notes.cjs BUILD_RECORD OUTPUT");
    }
    const template = readFileSync(resolve(__dirname, "../docs/RELEASE_NOTES_TEMPLATE.md"), "utf8");
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    writeFileSync(outputPath, prepareDraftReleaseNotes(template, record, process.env.GITHUB_SHA),
      { encoding: "utf8", flag: "wx" });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Could not prepare release notes.");
    process.exitCode = 1;
  }
}

module.exports = { prepareDraftReleaseNotes };
