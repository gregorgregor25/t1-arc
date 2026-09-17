const { execFileSync } = require("node:child_process");

/** Capture source identity at build time, including linked Git worktrees. */
function readBuildSource(projectRoot, run = execFileSync) {
  try {
    const options = {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    };
    // An exported source folder inside some other repository is not that
    // repository's checkout. Do not attribute its parent's commit to this app.
    if (run("git", ["rev-parse", "--show-prefix"], options).trim()) {
      return { commit: null, modified: null };
    }
    const commit = run("git", ["rev-parse", "HEAD"], options).trim();
    if (!/^[a-f0-9]{40}$/.test(commit)) return { commit: null, modified: null };
    const changes = run(
      "git",
      ["status", "--porcelain", "--untracked-files=normal"],
      options,
    );
    return { commit, modified: changes.trim().length > 0 };
  } catch {
    // Source archives and machines without Git cannot attest to a commit.
    return { commit: null, modified: null };
  }
}

module.exports = { readBuildSource };
