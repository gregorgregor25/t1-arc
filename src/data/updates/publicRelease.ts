export const OFFICIAL_REPOSITORY = "https://github.com/gregorgregor25/t1-arc";
export const OFFICIAL_PHONE_PACKAGE = "io.github.gregorgregor25.t1arc";
const LATEST_RELEASE_API = "https://api.github.com/repos/gregorgregor25/t1-arc/releases/latest";

export interface InstalledAppIdentity {
  applicationId: string | null;
  version: string | null;
  buildNumber: string | null;
}

export type PublicReleaseCheck =
  | { kind: "available"; version: string; notes: string; releaseUrl: string; apkUrl: string }
  | { kind: "current"; message: string }
  | { kind: "unavailable" | "incompatible" | "error"; message: string };

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function isExactUrl(value: unknown, expected: string) {
  return typeof value === "string" && value === expected;
}

function assertResponseHost(response: Response, original: string) {
  // GitHub redirects public asset downloads to its signed asset CDN.
  const url = new URL(response.url || original);
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !["api.github.com", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(url.hostname)) {
    throw new Error("Unexpected release host");
  }
}

async function readJson(response: Response, original: string): Promise<unknown> {
  assertResponseHost(response, original);
  if (Number(response.headers.get("content-length")) > 262_144) throw new Error("Oversized release metadata");
  const text = await response.text();
  if (text.length > 262_144) throw new Error("Oversized release metadata");
  return JSON.parse(text) as unknown;
}

/** Manual, unauthenticated check. No health data, credentials or device identifier are sent. */
export async function checkPublicRelease(
  installed: InstalledAppIdentity,
  options: { fetcher?: typeof fetch; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<PublicReleaseCheck> {
  if (installed.applicationId !== OFFICIAL_PHONE_PACKAGE) {
    return { kind: "incompatible", message: "This installation uses a different Android package. The public APK will not update it in place. Keep this app and its data until you have planned a backup and move." };
  }
  const code = Number(installed.buildNumber);
  if (!installed.version || !/^\d+$/.test(installed.buildNumber ?? "") || !Number.isSafeInteger(code) || code < 1) {
    return { kind: "unavailable", message: "This app's installed version could not be confirmed. You can read the public release notes, but an update cannot be checked safely." };
  }
  const fetcher = options.fetcher ?? fetch;
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const timeout = setTimeout(abort, options.timeoutMs ?? 15_000);
  try {
    const response = await fetcher(LATEST_RELEASE_API, {
      signal: controller.signal,
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      credentials: "omit",
    });
    if (response.status === 404) return { kind: "unavailable", message: "No public release is available to check. The repository may still be private, or its releases may still be drafts." };
    if (response.status === 403 || response.status === 429) return { kind: "unavailable", message: "GitHub is limiting update checks right now. Try again later." };
    if (!response.ok) throw new Error("Release request failed");
    const release = object(await readJson(response, LATEST_RELEASE_API));
    const tag = typeof release.tag_name === "string" ? release.tag_name : "";
    if (release.draft !== false || release.prerelease !== false || !/^v\d+\.\d+\.\d+$/.test(tag)) {
      return { kind: "unavailable", message: "No supported public release was found. Drafts and prereleases are not offered as updates." };
    }
    const version = tag.slice(1);
    const apk = `T1-Arc-${tag}.apk`;
    const base = `${OFFICIAL_REPOSITORY}/releases/download/${tag}`;
    const releaseUrl = `${OFFICIAL_REPOSITORY}/releases/tag/${tag}`;
    const assets = Array.isArray(release.assets) ? release.assets.map(object) : [];
    const hasAsset = (name: string) => assets.some((asset) => asset.name === name &&
      asset.state === "uploaded" && isExactUrl(asset.browser_download_url, `${base}/${name}`));
    if (!isExactUrl(release.html_url, releaseUrl) || !hasAsset(apk) || !hasAsset(`${apk}.sha256`) || !hasAsset(`${apk}.build.json`)) {
      return { kind: "unavailable", message: "The latest release does not include all the phone APK verification files. It cannot be offered as an update yet." };
    }
    const metadataUrl = `${base}/${apk}.build.json`;
    const metadataResponse = await fetcher(metadataUrl, { signal: controller.signal, credentials: "omit" });
    if (!metadataResponse.ok) throw new Error("Release metadata unavailable");
    const metadata = object(await readJson(metadataResponse, metadataUrl));
    if (metadata.applicationId !== installed.applicationId) {
      return { kind: "incompatible", message: "The release's Android package does not match this app. It cannot update this installation in place." };
    }
    if (metadata.version !== version || metadata.apk !== apk || !Number.isSafeInteger(metadata.versionCode) ||
        Number(metadata.versionCode) < 1 || typeof metadata.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(metadata.sha256)) {
      return { kind: "unavailable", message: "The release's version details could not be verified. No update will be offered until its metadata is complete." };
    }
    if (Number(metadata.versionCode) <= code) {
      return { kind: "current", message: Number(metadata.versionCode) === code && version === installed.version
        ? "Your version number matches the latest public release. Build details above identify your installed build."
        : "There is no newer public build for this installation. Your installed build may be ahead of the public release." };
    }
    return {
      kind: "available", version, releaseUrl, apkUrl: `${base}/${apk}`,
      notes: typeof release.body === "string" && release.body.trim()
        ? release.body.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, 4_000)
        : "Release notes are available on GitHub.",
    };
  } catch {
    return { kind: "error", message: controller.signal.aborted
      ? "The update check timed out or was cancelled. Your installed app is unchanged. Try again when you have a connection."
      : "The public release could not be checked. Your installed app is unchanged. Check your connection and try again." };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}
