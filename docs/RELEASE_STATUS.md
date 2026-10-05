# Downloads and release support

## Download T1 Arc

Open the [latest GitHub Release](https://github.com/gregorgregor25/t1-arc/releases/latest)
on your Android phone. Under **Assets**, choose the **phone APK**: its name
starts with `T1-Arc-v` and ends with `.apk`. The number between them changes with
updates. No computer or build tools are needed.

| File | Do I need it? |
| --- | --- |
| Phone APK, starting `T1-Arc-v` | Yes, to install T1 Arc on an Android phone |
| Companion APK, starting `T1-Arc-Wear-` | Only for manual watch installation; the guided phone installer already includes it |
| APK with Meridian, Chronograph, Atelier, Pace or Summit in its name | Optional separate face for Wear OS 4 or newer; supported Wear OS 6 watches can use the bundled faces instead |
| `.sha256` and `.build.json` files | Optional checksum and build information; these are not apps |
| **Source code** ZIP or TAR archive | For contributors; cannot be installed on a phone |

The phone needs Android 8.0 or newer. The companion needs Wear OS 3 or newer.
Follow the [phone installation guide](GETTING_STARTED.md) and
[watch setup guide](WATCH_SETUP.md) for the appropriate route.

## What the app includes

- Glucose, insulin, food and health history together, with inspectable records.
- Supported provider connections, Health Connect, Hevy and manual logging.
- Encrypted local storage and encrypted portable backups.
- Food search, barcode scanning, saved foods, recipes and on-device label reading.
- Tarv1s local factual answers and optional broader questions using an eligible
  ChatGPT plan or your own OpenAI, Google Gemini or Anthropic Claude API key.
- Notifications, widgets, optional alerts and a Wear OS companion with five faces.

See [the main screens](USING_T1_ARC.md), [food logging](FOOD_LOGGING.md),
[Tarv1s costs and setup](TARV1S_BYOK.md) and [data freshness](DATA_FRESHNESS.md).

The API-key routes use each user's saved key and model. There is no shared
maintainer API key or hosted AI relay. ChatGPT is a separate, optional plan
connection; its model choices come from the connected account. Switching
providers does not silently retry with another service. API use is billed by
the chosen provider; see the official pricing links in Tarv1s settings. No
model has a Recommended label in this release.

### 1.7.14 changes

Release preparation on 5 October 2026 is blocked by the required production
dependency audit. The lockfile updates brace-expansion to 5.0.12, but
braces 3.0.3 ([advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm))
and node-forge 1.4.0 ([advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv))
have no published patched versions at the time of verification. Their dependent
packages produce 17 high-severity audit findings. Do not bypass this check or
use the audit tool's incompatible Expo/React Native downgrades. The public
privacy disclosure is published; exact public APK and device verification
remain pending a passing release build. Version 1.7.14 is not yet published.

The 1.7.14 source adds **Continue with ChatGPT** alongside the three API-key
providers. It uses an eligible ChatGPT plan; local answers remain available
without any AI connection. In a signed, production-package private phone
build, a real account completed two record-free answers with no API-key fallback.
Codex also checked sign-out revocation, explicit sign-in cancellation and normal
returning-account reconnect through Edge's **Return to T1 Arc** link. OpenAI's
API-key connection stayed active during reconnect until ChatGPT was explicitly
selected. The account's own catalogue offered five models, without GPT-6.1.
These private checks do not substitute for testing the exact public APK. See
[connection details](CHATGPT_CONNECTION.md). The 1.7.14 source also adds a
targeted guard against the Gemini severity wording described below; that guard
does not establish general clinical accuracy.

The Today chart now starts with a compact four-hour view, allows eight-,
twelve- and twenty-four-hour views, and lets users inspect readings alongside
nearby recorded meals and notes. OpenAI API-key users can select GPT-6.1 Sol;
availability through a ChatGPT plan depends on that account's model catalogue.

The private.5 phone update (code 66) retained the installed Galaxy Watch 8 companion:
it remained ready and accepted a queued glucose snapshot. The watch protocol
did not change, and no watch reinstall or debugging was required.

## Known limitations

- **Imports can be delayed.** Glooko is historical data, not live pump status.
  Health Connect and Hevy depend on their originating apps and Android scheduling.
  A successful check does not guarantee new records.
- **Label recognition needs review.** Small print, curved packs, glare,
  decimals and multiple columns can cause missing or incorrect values. Check
  every proposed amount against the pack; manual entry remains available.
  The recogniser currently supports English nutrition headings.
- **Provider coverage varies.** LibreLinkUp UK, Glooko EU and Hevy have real-account
  evidence. Nightscout and xDrip have been checked with real server/app software
  and synthetic readings. Dexcom and Medtrum have no real-account verification;
  US Glooko is experimental. See the [capability matrix](REGIONAL_CAPABILITY_MATRIX.md).
- **Android controls background operation and permissions.** Power restrictions
  can affect displays and alerts. Android Auto remains experimental. Keep your
  medical device’s official display and alerts available.
- **Watch support is version dependent.** Phone-only setup and glucose delivery
  have been checked on a Galaxy Watch 8. Older watches and other manufacturers
  do not yet have equivalent physical-device coverage.
- **The interface is English.** Regional formatting and food catalogues do not
  mean translated screens. Curated clinical references have the documented
  GB/NICE boundary; this is not clinical certification.
- **Backups exclude credentials and Android permissions.** Reconnect sources
  after restoring. Earlier-connection Tarv1s conversations may be kept in a
  read-only archive and are not used as evidence in new replies.
- **AI explanations need review.** A phone test of Gemini 3.8 gave a useful
  HbA1c and time-in-range explanation but phrased clinical severity as if a CGM
  trace and variability statistics alone could establish it. Glucose patterns
  cannot establish clinical severity without context. The owner accepted this
  wording limitation for this release; do not use Tarv1s as the sole basis for
  treatment decisions. See [provider validation](AI_PROVIDER_TESTING.md).

## Know which version you have

Open **Settings → About T1 Arc** for the version, package and source revision.
**Share build details** shares these without health records or keys.

Repository changes do not alter an installed APK. Each release’s build record
identifies its source and checksums. **Check for updates** offers compatible
published releases, excludes drafts and GitHub prereleases, and never downloads
or installs automatically.

## Update without losing your data

Create an encrypted backup, then install the new official phone APK over the
existing app. **Do not uninstall first:** that removes local app data. Official
updates retain the same package and signing identity. A private test build may
also use that package and signing identity, so check its version and provenance
before installing another APK.

The official phone package is `io.github.gregorgregor25.t1arc`; it appears in
**About T1 Arc** alongside the installed build details.

If Android reports a signature conflict, follow the
[update guide](GETTING_STARTED.md#update-t1-arc). Report problems through
[Help and support](../SUPPORT.md), without posting private health or account data.

## For contributors and maintainers

The [release procedure](RELEASING.md) and
[first-launch checklist](PUBLIC_LAUNCH_CHECKLIST.md) cover source review,
signing, recovery, access controls and testing the exact release artifacts.
