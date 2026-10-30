# Dependency update status (30 October 2026)

This change stays on Expo SDK 57 and React Native 0.86.3. It updates compatible
patches, React Navigation 7, Vite 8 and node-forge 1.4.2. The former
`node-forge` 1.4.0 security exception must not be carried forward: its exact
lockfile scope expired on 12 October 2026. The `braces` advisory in that
exception was [withdrawn on 23 October](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
The [forge 1.4.1 security fixes](https://github.com/digitalbazaar/forge/blob/main/CHANGELOG.md)
are included in 1.4.2.

The high-severity [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
is addressed with an exact override to the patched Zod 4.6.7 root API. Expo
SDK 57's CLI declares Zod 3, so regression checks exercise its actual DevTools
and MCP schemas against the override. Do not redirect imports to `zod/v3`:
the compatibility implementation still processes oversized constrained arrays.

The low-severity [deepmerge advisory](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)
remains in 4.3.1, with no patched upstream release. Its only direct production
consumer is Expo's build-time configuration package. The app does not import
deepmerge. Configuration and plugin changes must come from reviewed source.
Downgrading to 4.1.1 is not a fix: that version lacks the later prototype-property
guard, despite falling outside the advisory's published range.

The audit gate permits only this reviewed low advisory and its exact expected
dependency graph until 13 November 2026. It retains npm's complete report and
labels the result `reviewed-low`, never clean. New advisories, dependency drift,
an expired review, and every high or critical finding block the build. Reassess
this allowance and remove it when a compatible upstream fix is available.
Do not use `npm audit fix --force`: its suggested Expo downgrade is incompatible
with this app. SDK 58 still depends on the same affected packages and does not
itself resolve these advisories.

[Expo's SDK matrix](https://docs.expo.dev/versions/v58.0.0/) requires React
Native 0.88 and React 19.3 for SDK 58. The automated Expo 58 PR retains React
Native 0.86.3 and React 19.2.3, so the SDK migration needs a coordinated native
build and device review, including the installed Wear companion. The automated
test-and-lint PR also moves to TypeScript 7, which removes the
`ts.preProcessFile` API used by `scripts/check-source-reachability.mjs`.

Dependabot version ignores in `.github/dependabot.yml` prevent routine PRs for
those known incompatible versions while allowing SDK 57 patches. GitHub's
[ignore rules](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/manage-your-dependency-security/controlling-dependencies-updated)
can also suppress security-update PRs for the ignored ranges. Security alerts
remain visible; triage those manually until the coordinated migration is ready.
