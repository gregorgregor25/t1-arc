# Security policy

T1 Arc processes sensitive health and account data. Protecting users takes
priority over public reproduction convenience.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private
security advisory/reporting feature for this repository. If private reporting
is unavailable, open a minimal public issue asking the maintainer to enable a
private channel; include no technical exploit detail or personal data.

Never send credentials, tokens, email addresses, account identifiers, provider
responses, notification contents, databases, backups, exports, exact health
readings or identifying screenshots. Create a synthetic reproduction with
invented values. Maintainers will not ask for a real health-data export.

Include affected versions, platform/version, impact, the smallest synthetic
reproduction and any safe diagnostic code. Allow maintainers time to validate
and ship a fix before disclosure.

## Scope

Reports are especially useful for:

- exposure or retention of local health data, credentials or decrypted backup
  material;
- bypasses of erase/write epochs, source ownership or privacy-mode fences;
- unsafe Android component export, intent, WebView or network configuration;
- backup authentication, encryption, temporary-file or restore-integrity flaws;
- cross-account/provider credential confusion;
- leakage through logs, notifications, widgets, Android Auto or Wear surfaces;
- release signing, update identity or dependency supply-chain compromise.

Clinical disagreement, unsupported provider regions and incorrect calculations
without a security boundary impact belong in normal issue forms, still using
synthetic values.

## Supported versions

Security fixes target the latest source and latest released build. Older builds
may receive a fix when safe upgrade compatibility requires it. Exact retained
technical identities are documented in the compatibility ledger and must not be
removed as part of an unrelated security cleanup.

## Repository and release controls

`npm run verify:public-source` is a blocking repository gate for tracked
private-data/build/signing artifacts, non-example environment files,
high-confidence credential patterns and dependency licence metadata. It is a
defence-in-depth check, not proof that a secret never existed in an external CI
store or an unreviewed Git host. Maintainers must review repository settings,
release credentials and the proposed public history before a tag.

Release packaging fails closed without explicit signing configuration.
The public release workflow reads the production identity only from a protected
GitHub environment, verifies the final APK and creates a draft for exact-asset
testing. A release that cannot update the previous official APK in place must
not be published.
