# Getting help with T1 Arc

T1 Arc is an independent open source project, not a medical service. It cannot
provide treatment advice or emergency support. Use the official display and
support route for your medical device when making treatment decisions.

## Installation and everyday use

In the app, open **Settings → Help and support → Report a problem**. Describe
the steps, expected result and what happened. You can include a small technical
diagnostic summary, review the exact contents and explicitly consent before
sending it privately to **support@t1arc.com**. No GitHub account is needed.
Include your email address in your message only if you want a reply; it is not
attached automatically. Keep the report reference when following up.

If sending fails, use **Save report to a file** or **Share report** and email it
to support@t1arc.com. A saved report is plain, unencrypted text. Remove personal
information you do not want to share. The technical summary contains predefined
event codes, not raw system logs or a full crash dump. Never send an API key,
password, backup or database. If the app will not open, email support directly
with your app version, device model and the steps that led to the problem.

GitHub remains an optional **public** route for non-sensitive issues and feature
requests. Do not paste a private support report into a public issue without
checking it first.

For everyday questions, feedback and updates, you can also join the
[T1 Arc community on Reddit](https://www.reddit.com/r/T1Arc/).
No technical knowledge or GitHub account is needed. Reddit posts are public:
keep personal health records, account details and support reports private.

Start with the [installation guide](docs/GETTING_STARTED.md) and
[troubleshooting guide](docs/TROUBLESHOOTING.md). Use the official GitHub phone
APK, not a source archive. Source archives cannot be installed as Android apps.

If those guides do not solve the problem,
[search existing issues](https://github.com/gregorgregor25/t1-arc/issues) and
[open the closest issue form](https://github.com/gregorgregor25/t1-arc/issues/new/choose).
For an everyday-use question, [ask a usage question](https://github.com/gregorgregor25/t1-arc/issues/new?template=question.yml)
and describe the step that is unclear; a crash or developer log is not required.
Include:

- the T1 Arc version shown in the app or GitHub Release;
- the phone model and Android version;
- the smallest sequence that reproduces the problem;
- the expected and actual result;
- invented sample values or an explicitly safe diagnostic code, if useful.

Do not post exact health readings, databases, backups, provider exports,
credentials, tokens, email addresses, account identifiers or identifying
screenshots. Maintainers will not ask for a real health-data export.

## Regions and external services

Use the [regional compatibility form](https://github.com/gregorgregor25/t1-arc/issues/new?template=regional-compatibility.yml)
for a country-specific provider,
food catalogue, unit, timezone, language, Android Auto or Wear OS problem. A
country, service name, app version and non-sensitive error code are normally
enough to begin. The [regional capability matrix](docs/REGIONAL_CAPABILITY_MATRIX.md)
separates implemented behaviour from routes that still need field reports.

External services can change without a T1 Arc release. Check the service's own
status and account region before reporting a connection problem.

## Security or privacy problems

Do not disclose a suspected vulnerability in a public issue. Follow the
[security policy](SECURITY.md) and use GitHub private vulnerability reporting.

## Source contributions

People using the APK do not need to build T1 Arc. Developers who want to change
the source should read [CONTRIBUTING.md](CONTRIBUTING.md) and the
[development guide](docs/DEVELOPMENT.md).

Guide corrections, accessibility feedback and synthetic examples are welcome.
See the [first small PR path](CONTRIBUTING.md#your-first-small-pull-request).
Maintainers respond as time allows; this is not a monitored support service.
Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).
