# 1.7.14 dependency security review

Reviewed on 5 October 2026 against source commit
`e505758596d0b7bfc599c6135756d6d1792840dc`. The release remains blocked;
this review does not waive the production dependency audit.

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

The reviewed package-lock.json SHA-256 was
`32a613189bba624fafff09d4fb5ed7f55469296d75a18ca4c2e16ada71dc9bb1`.

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

## Release decision

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
The exact signed public APK still needs device/update verification, including
the user's saved OpenAI provider and existing Wear companion compatibility.
