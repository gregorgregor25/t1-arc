export interface BuildSource {
  commit: string | null;
  modified: boolean | null;
}

export function parseBuildSource(value: unknown): BuildSource {
  if (typeof value !== "object" || value === null) {
    return { commit: null, modified: null };
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.commit !== "string" ||
    !/^[a-f0-9]{40}$/.test(candidate.commit) ||
    typeof candidate.modified !== "boolean"
  ) {
    return { commit: null, modified: null };
  }
  return { commit: candidate.commit, modified: candidate.modified };
}

export function describeBuildSource(source: BuildSource): string {
  if (!source.commit) return "Not recorded in this build";
  return `${source.commit.slice(0, 12)}${source.modified ? " + local changes" : ""}`;
}

export function buildDetailsText(details: {
  applicationId: string | null;
  version: string | null;
  buildNumber: string | null;
  source: BuildSource;
}): string {
  return [
    "T1 Arc build details",
    `Version: ${details.version ?? "Not available"} (${details.buildNumber ?? "unknown"})`,
    `Package: ${details.applicationId ?? "Not available"}`,
    `Source: ${details.source.commit ?? "Not recorded"}`,
    `Local changes: ${details.source.modified === null ? "Unknown" : details.source.modified ? "Yes" : "No"}`,
  ].join("\n");
}
