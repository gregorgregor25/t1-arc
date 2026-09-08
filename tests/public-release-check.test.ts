import { afterEach, describe, expect, it, vi } from "vitest";

import { checkPublicRelease, OFFICIAL_PHONE_PACKAGE, OFFICIAL_REPOSITORY } from "@/data/updates/publicRelease";

const installed = { applicationId: OFFICIAL_PHONE_PACKAGE, version: "1.7.1", buildNumber: "28" };
const tag = "v1.8.0";
const apk = `T1-Arc-${tag}.apk`;
const release = {
  draft: false, prerelease: false, tag_name: tag,
  html_url: `${OFFICIAL_REPOSITORY}/releases/tag/${tag}`,
  body: "A simpler way to explore your records.",
  assets: [apk, `${apk}.build.json`, `${apk}.sha256`].map((name) => ({
    name, state: "uploaded", browser_download_url: `${OFFICIAL_REPOSITORY}/releases/download/${tag}/${name}`,
  })),
};
const metadata = { applicationId: OFFICIAL_PHONE_PACKAGE, version: "1.8.0", versionCode: 29, apk, sha256: "a".repeat(64) };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const fetcher = (first: unknown = release, second: unknown = metadata) => vi.fn<typeof fetch>()
  .mockResolvedValueOnce(response(first)).mockResolvedValueOnce(response(second));

afterEach(() => vi.useRealTimers());

describe("manual public APK update check", () => {
  it("offers only a verified official phone release with a higher installed version code", async () => {
    const request = fetcher();
    expect(await checkPublicRelease(installed, { fetcher: request })).toEqual({
      kind: "available", version: "1.8.0", notes: release.body,
      releaseUrl: release.html_url, apkUrl: release.assets[0]?.browser_download_url,
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]?.[0]).toBe("https://api.github.com/repos/gregorgregor25/t1-arc/releases/latest");
    for (const [, options] of request.mock.calls) {
      expect(options?.credentials).toBe("omit");
      expect(options?.body).toBeUndefined();
      expect(JSON.stringify(options)).not.toMatch(/Authorization|health|api.key|1\.7\.1/);
    }
  });

  it.each([null, "app.daymark.personal", "io.github.gregorgregor25.t1arc.test"])("does not send a fork or unknown package to the official update path: %s", async (applicationId) => {
    const request = fetcher();
    expect((await checkPublicRelease({ ...installed, applicationId }, { fetcher: request })).kind).toBe("incompatible");
    expect(request).not.toHaveBeenCalled();
  });

  it.each([null, "", "nan", "0", "-3", "28.5"])("does not guess the native build number: %s", async (buildNumber) => {
    const request = fetcher();
    expect((await checkPublicRelease({ ...installed, buildNumber }, { fetcher: request })).kind).toBe("unavailable");
    expect(request).not.toHaveBeenCalled();
  });

  it("distinguishes private or unreleased from current", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response({}, 404));
    expect(await checkPublicRelease(installed, { fetcher: request })).toMatchObject({ kind: "unavailable", message: expect.stringContaining("private") });
  });

  it.each([403, 429])("handles GitHub rate limits (%i) without claiming an update", async (status) => {
    expect(await checkPublicRelease(installed, { fetcher: vi.fn<typeof fetch>().mockResolvedValue(response({}, status)) }))
      .toMatchObject({ kind: "unavailable", message: expect.stringContaining("limiting") });
  });

  it.each([
    { ...release, draft: true }, { ...release, prerelease: true },
    { ...release, tag_name: "v1.8.0-beta" }, { ...release, assets: [] },
    { ...release, html_url: "https://github.com.evil.test/release" },
    { ...release, assets: release.assets.map((asset) => ({ ...asset, browser_download_url: "https://evil.test/release" })) },
    { ...release, assets: release.assets.map((asset) => ({ ...asset, state: "new" })) },
  ])("refuses incomplete, nonpublic or unexpected release locations", async (candidate) => {
    const request = fetcher(candidate);
    expect((await checkPublicRelease(installed, { fetcher: request })).kind).toBe("unavailable");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...metadata, versionCode: "29" }, { ...metadata, versionCode: 0 },
    { ...metadata, sha256: "invalid" }, { ...metadata, version: "1.9.0" },
    { ...metadata, apk: "T1-Arc-Wear-v1.8.0.apk" },
  ])("rejects malformed or mismatching APK metadata", async (candidate) => {
    expect((await checkPublicRelease(installed, { fetcher: fetcher(release, candidate) })).kind).toBe("unavailable");
  });

  it("rejects a release built for a different package", async () => {
    expect((await checkPublicRelease(installed, { fetcher: fetcher(release, { ...metadata, applicationId: "different" }) })).kind).toBe("incompatible");
  });

  it("does not offer a downgrade when the local test build is ahead", async () => {
    expect(await checkPublicRelease({ ...installed, buildNumber: "30" }, { fetcher: fetcher() })).toMatchObject({ kind: "current", message: expect.stringContaining("ahead") });
  });

  it("reports matching version numbers without claiming the installed APK is identical", async () => {
    expect(await checkPublicRelease({ ...installed, version: "1.8.0", buildNumber: "29" }, { fetcher: fetcher() }))
      .toEqual({ kind: "current", message: "Your version number matches the latest public release. Build details above identify your installed build." });
  });

  it("does not trust a redirected metadata response from another host", async () => {
    const foreign = response(metadata);
    Object.defineProperty(foreign, "url", { value: "https://evil.test/data" });
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(response(release)).mockResolvedValueOnce(foreign);
    expect((await checkPublicRelease(installed, { fetcher: request })).kind).toBe("error");
  });

  it("accepts the GitHub signed asset CDN", async () => {
    const asset = response(metadata);
    Object.defineProperty(asset, "url", { value: "https://release-assets.githubusercontent.com/github-production-release-asset/test?token=signed" });
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(response(release)).mockResolvedValueOnce(asset);
    expect((await checkPublicRelease(installed, { fetcher: request })).kind).toBe("available");
  });

  it("stops a stalled network request within the timeout", async () => {
    vi.useFakeTimers();
    const request = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    const operation = checkPublicRelease(installed, { fetcher: request, timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    expect(await operation).toMatchObject({ kind: "error", message: expect.stringContaining("timed out") });
  });
});
