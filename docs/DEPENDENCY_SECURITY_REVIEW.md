# 1.7.14 dependency security review and 1.7.15–1.7.18 carry-forward

Reviewed on 5 October 2026 against source commit
`e505758596d0b7bfc599c6135756d6d1792840dc`. At that point the release
was blocked; the later conditional, narrow exceptions below retain the full
production audit and guard requirements.

## Dependency exposure

`braces` 3.0.3 is installed through Micromatch and Metro tooling. `node-forge`
1.4.0 is used by Expo CLI and `@expo/code-signing-certificates`. Neither is
directly imported by the application source. Expo's certificate helpers do
perform signature verification; absence from the phone bundle does not make
their build/development uses automatically safe. Android APK signing uses the
Gradle/Android signing toolchain, not this JavaScript library.

A production Android JavaScript export was generated with:

```powershell
$env:NODE_ENV='production'
npx expo export --platform android --source-maps --no-bytecode --output-dir .qa/security-exposure/android-export
```

Its source map contained 1,630 modules and no modules from `braces`,
`micromatch`, `node-forge` or `@expo/code-signing-certificates`. This is evidence
for that JavaScript build configuration, not verification of a final signed APK,
all platform configurations, or the security of the build environment.

The initial 1.7.14 review's package-lock.json SHA-256 was
`32a613189bba624fafff09d4fb5ed7f55469296d75a18ca4c2e16ada71dc9bb1`.

After Linux CI required current Expo compatibility patches, the dependency
review was repeated on 5 October. Expo was updated to 57.0.26, alongside its
background-task, camera, constants, document-picker, task-manager and
modules-core patches. The reviewed CLI, Metro, Micromatch, Braces and Forge
package versions/integrities and the advisory graph did not change. Expo
dependency parity and all 21 Doctor checks passed. The **1.7.14 reviewed
lockfile SHA-256** was
`46a5236e77448db6bb8be995af93d6d68a9e1967f56950a3dfebef9c167354ae`.
Fresh guarded Linux build evidence is still required for this refreshed graph.

## Candidate patches and isolated checks

### Braces

[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
lists versions through 3.0.3 as affected and no patched version. The registry's
latest version was still 3.0.3.

[Upstream PR 75](https://github.com/micromatch/braces/pull/75), inspected at
`bdb6fda18f2aba1ae63d78786cb4460b478459ba`, proposes nesting-depth guards.
The proposal was unmerged at review time. An isolated copy was compared with
the installed package using 4,999 nested brace pairs (9,998 characters):

- Stock expansion raised an uncontrolled call-stack overflow.
- The candidate rejected the input with its explicit depth-limit error.
- Eleven ordinary pattern cases produced matching compile and expand outputs.
- Explicitly disabling the guard with `maxDepth: Infinity` still permitted
  stack exhaustion. This is a configuration limitation to assess, not evidence
  that default protection is ineffective. Raw stack failures vary with the
  execution path and available stack; not every stock invocation overflowed.

These checks establish a useful candidate, not complete compatibility or
security review of all options and caller-supplied syntax trees.

### Node-forge

[GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv)
lists versions through 1.4.0 as affected and no patched version. The registry's
latest version was still 1.4.0.

[Upstream PR 1152](https://github.com/digitalbazaar/forge/pull/1152), inspected
at `ceba34402e329f0365134f23fe19898756527d65`, checks the child count of the
nested ASN.1 DigestAlgorithm structure. It was unmerged at review time.
Its proposed regression vector was run against the stock library and an
isolated copy with that condition applied:

- Stock verification accepted the malformed DigestInfo regression vector.
- The patched copy rejected it as invalid DigestInfo.
- A generated valid SHA-256 RSA signature verified with both copies.

The upstream regression uses the internal `_skipPaddingChecks` testing option.
This isolates the parser defect; it does not demonstrate a successful attack
against the application's normal configuration. A single parser regression
and valid-signature smoke test are not comprehensive cryptographic assurance.

## Initial release decision before exception approval

No proposed patch was applied to installed project dependencies or shipped
code. Neither dependency was renamed, assigned an invented safe version,
removed from audit scope, or added to an advisory allowlist. All investigation
copies and executable probes remain in ignored local QA directories.

A local source patch alone leaves the affected package versions in the
lockfile, so the unchanged required npm audit still reports them. Making the
report disappear by changing package identity would not establish a fix.

Proceed when either an appropriately reviewed patched upstream distribution
is available, or a genuine compatible replacement/removal is implemented and
verified. Pin the resulting dependency graph, rerun the regression and normal
behaviour checks, then require the existing security and build checks to pass.
At that initial review stage, the exact signed public APK still needed
device/update verification, including the user's saved OpenAI provider and
existing Wear companion compatibility. The 1.7.17 outcome is recorded below.

## Completed exposure assessment and approved conditional exception

The owner explicitly approved the conditional exception on 5 October 2026,
after reviewing its residual risks. The workflow now evaluates only that
narrow exception and adds mandatory guarded-build and APK evidence gates.
Branch and environment protections remain unchanged.

### Execution evidence

Both installed Metro file-map implementations use `micromatch.some` in their
watcher `common.js` helpers. That API delegates to Picomatch, not the separate
Micromatch `parse`, `braces` and `braceExpand` APIs that invoke Braces. The
watcher patterns are generated from package.json, configured extensions and
health-check names; discovered file paths are matching inputs, not patterns.

A local CommonJS probe rejected Braces `compile`/`expand` calls and Forge RSA
public-key construction, a prerequisite for its normal verification path.
Self-tests deliberately invoked all three hooks and confirmed rejection.
With this probe inherited through NODE_OPTIONS:

- Android production prebuild with `--no-clean --no-install` completed; both
  process reports recorded zero affected calls or module loads.
- A cold production Android export (`--clear --source-maps --no-bytecode`)
  completed. Braces modules were loaded 11 times, with zero compile/expand
  calls. Forge was not loaded.
- The new source map again contained 1,630 modules and none from the four
  affected/tooling packages listed above.

These are local Windows checks. They do not establish coverage of every
JavaScript entry point or replace a Linux clean prebuild and Gradle release
build. The probe deliberately blocks a conservative Forge prerequisite, not
every cryptographic operation. It records no function inputs or credentials.

The observed Android paths do not expose either reported vulnerable operation
to user-supplied health records or network requests. The packages remain
vulnerable in the dependency tree, and development/iOS/updates paths are not
covered by the proposed Android release exception. Compromised dependencies
or changes to build configuration remain separate risks.

### Approved scope and mandatory acceptance conditions

Independent review considered a conditional exception defensible for owner
consideration. The 5 October approval for 1.7.14 had these limits:

1. T1 Arc Android **1.7.14 only**, on the exact independently reviewed PR head.
   Retain the current pinned lockfile hash recorded above and package versions Braces 3.0.3
   and node-forge 1.4.0. Source/configuration or dependency drift requires
   renewed assessment; this original approval did not extend to future releases.
2. Only **GHSA-vfj7-8cjw-p6xm** and **GHSA-86w9-cpqp-85rv**, including findings
   derived solely from those two advisories, may be accepted. Keep the full
   audit report visible and preserve their high-severity classifications.
3. Expire the exception at **2026-10-12 00:00 UTC**, even if no fix exists.
   This expires permission to use the exception for builds; it does not add
   an expiry or disable functionality in an installed app.
   Fail closed on expiry, unrecognised findings, audit/network/report errors,
   package/version/hash drift, or an incomplete evidence check. Do not disable
   the audit command or use `continue-on-error` to ignore its result.
4. Before accepting the exception, repeat guarded execution for the Linux
   clean Android prebuild and actual Gradle release bundling path. Reject any
   call to an affected function. Verify the exact APK's bundled code and
   source-map evidence, rather than relying only on this local export.
5. Keep branch reviews, environment protection, all other tests and final
   device checks. Owner acceptance explicitly covers residual **build-tool
   risk**, including the Forge signature-verification issue; it does not
   assert that either library is fixed or universally unexploitable.

This creates a controlled route to release without waiting for an upstream
version. Successful execution of all conditions above is still mandatory;
approval alone is not release verification. Full audit JSON remains visible in
workflow logs, including accepted high-severity findings. The audit evaluator
checks the complete dependency graph, package identities, lock hash and expiry.
Guard records are durable before a rejected call, so catching its exception
cannot hide an attempted use. Bundle source maps are inspected and the exact
generated bundle must match the bytes inside the signed APK before drafting.

## Corrected 1.7.15 candidate: renewed scope

On 6 October 2026 the owner asked to finish the corrected release after the
1.7.14 signed draft was held for personal-answer defects, and agreed to carry
the same exception into **Android 1.7.15, phone code 70**. The Wear companion
uses code 71 under the existing even-phone/odd-Wear rule. This authorizes
preparation and review; it does not claim that a new build or device check has
passed. The 1.7.14 draft remains unpublished and must not be published as-is.

The package-lock.json changes are the root package version fields from 1.7.14
to 1.7.15 and one patched transitive dependency, `source-map-js` 1.2.1 to
1.2.2. PostCSS already accepts `^1.2.1`; no direct dependency, override or
other package-graph change was added. The 1.7.15 candidate lockfile SHA-256 is
`ae84beab6e319bce89b43040b9e5097f197741d368ab6540155c7058e2a2e2cf`.
An independent reviewer must confirm the lockfile diff and source changes on
the intended PR head before accepting this renewed scope.

The fresh 6 October audit surfaced a third, newly recognized high-severity
finding: `source-map-js` 1.2.1,
[GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).
The advisory identifies 1.2.2 as patched for invalid indexed source-map
section offsets. Updating that one package within PostCSS's existing range
removes this finding rather than extending the exception. A clean `npm ci
--ignore-scripts` resolved 1.2.2 through Expo Metro Config and PostCSS. An
ordinary indexed map resolved its source location; negative, fractional,
infinite and oversized line offsets, plus a nested offset exceeding the limit,
were rejected. A fresh full npm audit reported 17 high findings, no others,
and no `source-map-js`/GHSA-68fv-2mgg-jv7q finding. This local verification
does not replace the required audit and guarded-build checks on the final PR
head and protected release build.

The renewed exception covers only GHSA-vfj7-8cjw-p6xm for braces 3.0.3 and
GHSA-86w9-cpqp-85rv for node-forge 1.4.0 in the Android 1.7.15 release path.
It keeps the unchanged **2026-10-12 00:00 UTC** expiry, full visible audit,
severity labels, guarded Linux clean prebuild and actual Gradle bundling,
source-map inspection, exact signed APK bundle comparison, branch/environment
protections and final device checks. It fails closed for new advisories,
dependency or hash drift, missing evidence, audit errors and expiry. No other
version or platform is covered. At the time of this 1.7.15 scope review, its
signed build and fresh evidence were pending; the 1.7.14 signed build did not
fulfill those gates. The later 1.7.15 outcome and 1.7.16 scope follow below.

## Corrected 1.7.16 candidate: unchanged advisory scope

The protected 1.7.15 signing workflow
[`37448754652`](https://github.com/gregorgregor25/t1-arc/actions/runs/37448754652)
passed, but device testing found a current-period personal-answer presentation
regression in Q18. That draft remains unpublished; its signed-build result does
not establish acceptance of the corrected app. Preparation of **Android 1.7.16,
phone code 72** continues the same narrowly approved conditional exception;
this is no claim of a new waiver. The
generated Wear companion uses code 73; its glucose protocol is unchanged.

Compared with the independently reviewed 1.7.15 lockfile, the 1.7.16 lockfile
changes only root package version metadata. No dependency package, version,
integrity, override or advisory scope was added. Its SHA-256 is
`9929a5cd1cef55c5ff829d6b162b8e7fbcf7f6bb9d3737225e880ab948f83ad6`.
This version/hash assertion still requires independent verification on the
intended 1.7.16 PR head.

Only GHSA-vfj7-8cjw-p6xm for braces 3.0.3 and GHSA-86w9-cpqp-85rv for
node-forge 1.4.0 remain excepted for this Android release path. The exception
still expires **2026-10-12 00:00 UTC**. It does not cover the patched
`source-map-js` advisory, new findings, iOS, other versions, or altered package
graphs. Full audit visibility, severity labels, guarded Linux clean prebuild
and actual Gradle bundling, source-map inspection, exact signed APK bundle
comparison, unchanged branch/environment protections and final device checks
remain mandatory. The 1.7.16 audit, guarded build and downloaded signed-artifact
comparison passed. Its signing workflow was
[`37460460216`](https://github.com/gregorgregor25/t1-arc/actions/runs/37460460216),
from clean source `1ae30d3639e3b2ccafb10b110366296f8c1bf2c5`. Publication remains
held because phone backups exposed a pre-existing Health Connect read-window
reconciliation issue. These checks cannot stand in for 1.7.17 acceptance.

## Health Connect correction and 1.7.17 signed-build outcome

Android 1.7.17, phone code 74 and generated Wear code 75, carries forward the
same two-advisory exception and unchanged **2026-10-12 00:00 UTC** expiry.
The correction changes how absent Health Connect rows are reconciled at read
boundaries. The watch glucose protocol is unchanged. The advisory scope and
expiry have not expanded. During the first 1.7.17 CI run, Expo's live compatibility
check required freshly published SDK 57 patches: `expo` 57.0.27,
`expo-constants` 57.0.21 and `expo-sqlite` 57.0.4. The candidate updates those
three direct dependencies and their resolved transitive patches; it does not
disable or bypass that check. All 844 non-root installation paths remain
present, with no added or removed paths; 25 non-root entries changed version
and associated metadata. Several transitive resolutions also move within their
unchanged permitted ranges; those are included in the reviewed graph rather
than described as mandatory Expo changes. This graph received independent
review rather than the earlier root-version-only comparison. The committed
lockfile LF SHA-256 is
`550d9537bbcdf0ace0ca44d57ca8d6044444e44e41018d76bfe0a8df59efb6b9`.
A fresh production audit reported 16 high findings from the two original leaf
advisories, with no other severity. `@expo/metro-file-map` is no longer affected
and was removed from the affected-package allowlist. The affected leaf versions
remain braces 3.0.3 and node-forge 1.4.0; the separately patched source-map-js
remains 1.2.2. Unreviewed lock drift or a renewed finding on the patched Expo
file-map package still fails closed. Quality checks, the full guarded audit,
Linux signed build, source-map inspection and exact downloaded-APK bundle
comparison completed for source `d0db9ca88990590b59717df4c9fde3e57c60ff2d`
in workflow `37478472400`. The signed phone APK then installed in place on a
Pixel 10 Pro XL running Android 17. This evidence applies to that exact
artifact and does not expand the advisory scope or move the **2026-10-12
00:00 UTC** expiry. Neither dependency has thereby been fixed; later guarded
builds still fail closed on expiry, drift or a new finding. Publication status
is shown by [GitHub Releases](https://github.com/gregorgregor25/t1-arc/releases).

## 1.7.18: patched shell-quote after a fresh publication audit

A later audit on 6 October 2026 reported one additional critical finding:
`shell-quote` 1.10.0, [GHSA-pqg4-j6r4-53mv](https://github.com/advisories/GHSA-pqg4-j6r4-53mv).
The guard rejected it as a new affected package; the signed 1.7.17 draft was
not published. React Native depends on this package through `react-devtools-core`.
It appears in development tooling, but that is not a reason to bypass the audit.

Android 1.7.18, phone code 76 and generated Wear code 77, updates the package
to 1.12.0 within its existing compatible range. This is the only non-root
lockfile package change from 1.7.17; root metadata changes to the new version.
The normalized LF lockfile SHA-256 is
`d18397e12a360ed6b2f1b2767cb22ba45fce0e147f8f4da3c1ce497981802cd7`.
The corrected audit returns to the same 16 high findings from the two original
advisories, with no critical finding. `shell-quote` is not added to an
exception. The existing package/path scope and **2026-10-12 00:00 UTC** expiry
are unchanged. New findings, drift, expiry or failed build evidence still
block release. Fresh checks and the signed artifact identity are required for
this source, as recorded in the release build and published release notes.
