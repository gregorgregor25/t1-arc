# Dependency update status (30 October 2026)

This change stays on Expo SDK 57 and React Native 0.86.3. It updates compatible
patches, React Navigation 7, Vite 8 and node-forge 1.4.2. The former
`node-forge` 1.4.0 security exception must not be carried forward: its exact
lockfile scope expired on 12 October 2026. The `braces` advisory in that
exception was [withdrawn on 23 October](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
The [forge 1.4.1 security fixes](https://github.com/digitalbazaar/forge/blob/main/CHANGELOG.md)
are included in 1.4.2.

The current production audit still reports a high-severity
[Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) through
Expo CLI and lower-severity
[deepmerge findings](https://github.com/advisories/GHSA-gcqx-w48m-w2h4).
Expo SDK 57's latest CLI depends on `zod ^3.25.76`; the available patched Zod
version is 4.6.6, outside that range. Deepmerge 4.3.1 is the latest published
version and has no patched release. The security audit remains fail-closed.
Do not use `npm audit fix --force`: its suggested Expo downgrade is incompatible
with this app. Assess a compatible upstream fix or the SDK 58 migration before
clearing the high advisory.

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
