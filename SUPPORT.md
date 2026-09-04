# Getting help with T1 Arc

T1 Arc is an independent open source project, not a medical service. It cannot
provide treatment advice or emergency support. Use the official display and
support route for your medical device when making treatment decisions.

## Installation and everyday use

Start with the [installation guide](docs/GETTING_STARTED.md) and
[troubleshooting guide](docs/TROUBLESHOOTING.md). Public phone builds are only
the APK files attached to this repository's GitHub Releases. Source archives
are not installable Android apps.

If those guides do not solve the problem, search existing issues and open the
closest issue form. Include:

- the T1 Arc version shown in the app or GitHub Release;
- the phone model and Android version;
- the smallest sequence that reproduces the problem;
- the expected and actual result;
- invented sample values or an explicitly safe diagnostic code, if useful.

Do not post exact health readings, databases, backups, provider exports,
credentials, tokens, email addresses, account identifiers or identifying
screenshots. Maintainers will not ask for a real health-data export.

## Regions and external services

Use the regional compatibility issue form for a country-specific provider,
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
