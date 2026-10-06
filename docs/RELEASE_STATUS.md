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

### 1.7.17 release verification and changes

Release preparation on 5 October 2026 identified two outstanding production
dependency advisories. The lockfile updates brace-expansion to 5.0.12, but
braces 3.0.3 ([advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm))
and node-forge 1.4.0 ([advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv))
have no published patched versions at the time of verification. Their dependent
packages initially produced 17 high-severity audit findings. A newly recognized
`source-map-js` advisory was fixed by updating that transitive package to its
patched 1.2.2 release within PostCSS's existing version range; it is not part
of the exception. The owner approved a
conditional exception for Android 1.7.14 on 5 October and carried it into the
unpublished 1.7.15 and 1.7.16 drafts. The corrected Android 1.7.17 candidate
continues that same two-advisory scope without claiming a new waiver. Its first
CI run required newly published Expo SDK 57 patches: Expo 57.0.27, Constants
57.0.21 and SQLite 57.0.4. Those updates and their resolved transitive patches
received fresh graph review, an exact lock hash pin and all original build checks.
The resulting production audit contains 16 high findings from the same two
advisories; Expo's patched file-map package is removed from the allowlist.
The exact version and committed lock hash are pinned in the audit guard and
recorded in the dependency review. The exception still expires **12 October
2026 at 00:00 UTC**; new findings, dependency drift, failed evidence or expiry
block a new guarded build. The exact 1.7.17 source, lockfile, guarded Linux
build, source map and signed APK bundle were independently checked. The public
privacy disclosure is published. The signed phone APK from build run
`37478472400` was verified on a Pixel 10 Pro XL running Android 17 and
installed in place without removing the existing app. Publication status is
shown by [GitHub Releases](https://github.com/gregorgregor25/t1-arc/releases).
The held 1.7.14, 1.7.15 and 1.7.16 drafts have not been published and must
not be published as-is.
The [dependency security review](DEPENDENCY_SECURITY_REVIEW.md) records bundle
exposure checks and isolated tests of the proposed upstream patches.

The 1.7.17 signed candidate includes **Continue with ChatGPT** alongside the three API-key
providers. It uses an eligible ChatGPT plan; local answers remain available
without any AI connection. In a signed, production-package private phone
build, a real account completed two record-free answers with no API-key fallback.
Codex also checked sign-out revocation, explicit sign-in cancellation and normal
returning-account reconnect through Edge's **Return to T1 Arc** link. OpenAI's
API-key connection stayed active during reconnect until ChatGPT was explicitly
selected. That earlier catalogue did not offer GPT-6.1. On the signed 1.7.17
phone, the connected account offered GPT-6 Astra and GPT-5.6 Sol, Terra and
Luna; GPT-6.1 Sol is an OpenAI API-key option, not a promised ChatGPT plan
option. The signed 1.7.15 workflow passed, but on-device Q18 testing found a current-period
personal-answer presentation regression, so that draft remains held. The
1.7.16 signed build also passed, but publication was held after phone backup
comparisons exposed a pre-existing Health Connect reconciliation boundary
issue. A record overlapping the start of a read could be absent from that
response yet included in local absence-based deletion. The 1.7.17 candidate
aligns deletion with the complete read window; it still respects explicit
Health Connect deletion events. Source regression checks, signed-build tests
and the in-place phone update completed. See
[connection details](CHATGPT_CONNECTION.md). The candidate also adds a
targeted guard against the Gemini severity wording described below; that guard
does not establish general clinical accuracy.

The Today chart now starts with a compact four-hour view, allows eight-,
twelve- and twenty-four-hour views, and lets users inspect readings alongside
nearby recorded meals and notes. The compact chart and meal inspector were
checked on the signed phone. OpenAI API-key users can select GPT-6.1 Sol;
availability through a ChatGPT plan depends on that account's model catalogue.

Tarv1s now keeps requested sleep records in personal glucose/sleep answers and
distinguishes a request not to assume causation from an exclusion of records.
Supported exact personal calculations remain local even when a model is
selected. For broader personal questions, the provider can select from locally
approved findings or reviewed claims; the app assembles the factual answer.
Some personal modes send bounded selected records, and local prose may follow
an actual model call. General education uses no new personal-record packet.
When imports include daily basal totals but no detailed basal timeline, it can
report supported daily sums, averages and comparisons while explaining that
hourly delivery cannot be reconstructed. It excludes missing, partial and
conflicting days from complete-period figures rather than treating them as zero.
Natural-language completed-day requests use full local calendar days, and
cross-domain basal/glucose comparisons use the corresponding complete dates
without claiming cause. These corrections passed source tests, private replay
and targeted checks in the signed 1.7.17 APK.

The 1.7.17 candidate adds comparisons across matched calendar dates. Sleep is
grouped by the date its recorded sessions ended and shown beside that calendar
day's glucose; this does not describe glucose during sleep. Daily basal totals
are paired with the same date's glucose summaries. Comparisons require usable
records and adequate sensor coverage, identify missing dates and never imply
causation or basal delivery timing. Source tests and targeted signed-device
checks completed.

The installed Galaxy Watch 8 companion remained connected with an active face;
a glucose update was queued after the phone-only 1.7.17 update. The watch
protocol did not change, and no companion reinstall or watch debugging was
required. A visible acknowledgement on the watch screen was not captured.

Targeted Tarv1s testing on the signed phone submitted **16 questions**: six
each with ChatGPT and OpenAI, and two each with Claude and Gemini. Ten personal
questions completed hosted evidence selection, four general-education questions
completed through the selected provider, and two Q08 questions used the local
route without a model call. The eight omitted provider/case combinations were
not run. Tested personal numeric facts agreed with independent checks of the
phone's stored records; this is a targeted check, not a full 30-question suite
or a guarantee of answer quality. General-education Q25 answers had known
inaccuracies, most notably Claude's 90-day and same-day-lab claims and its
time-in-range wording. Broad Q22 answers were less useful than intended as
they tended to list records rather than explain a pattern. These known
answer-quality limits remain in this release, with improvements planned for
the next version; see
[provider validation](AI_PROVIDER_TESTING.md).

## Known limitations

- **Imports can be delayed.** Glooko is historical data, not live pump status.
  Health Connect and Hevy depend on their originating apps and Android scheduling.
  A successful check does not guarantee new records.
- **Older sampled Health Connect records need a refresh for complete bounds.**
  Newly read samples retain their original interval boundaries. Older imported
  samples without those boundaries stay protected during absence-based cleanup;
  a missing partial-window result does not prove they were deleted. A full
  Health Connect re-read can populate bounds for records still available from
  the source. Explicit source deletion events remain respected. If a legacy
  sample's parent was deleted before bounds were stored and its change token
  has expired, a full scan cannot safely identify that sample as stale.
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
