# T1 Arc technical privacy model

This document describes the source code's data flows. It is not a distributor's
legal privacy policy or store data-safety declaration; whoever distributes a
build must review the exact build, hosting, support and store configuration.

## Local storage

Health records, imported provider records, food logs, context, Insights and
Tarv1s conversation state are stored on the Android device. Health databases
use SQLCipher. Provider credentials and the user's OpenAI API key use Android
secure storage. Android system backup is disabled.

User-created portable backups are passphrase encrypted. They exclude provider
credentials, session tokens, browser cookies and replaceable source ZIP/PDF
downloads. Temporary decrypted material is bounded and owned by the operation
that created it; cancellation, failure and success paths remove it.

Bundled food catalogues are public reference data stored separately from the
private health database. Canadian, French and German indexes are prepared
locally on first use; the larger US branded index is optional and also prepared
from a bundled asset. Removing that index leaves saved foods and meals intact.
Successful barcode lookups can be cached locally without logging a meal.

Android label capture processes the photo and recognised text on the phone
using a bundled text-recognition model, without sending them to a cloud OCR
service. Temporary photo copies are removed after success, failure or
cancellation; OS cache cleanup is the fallback if deletion fails. The proposed
values remain editable and are not saved as a food until the user chooses to
save. These food additions describe current source behaviour; availability in
a downloaded APK depends on its release.

## Network flows chosen by the user

T1 Arc has no maintainer data relay in the normal app path. A connection sends
data directly from the device to the service the user selected:

- LibreLinkUp, Dexcom Share, Medtrum, Glooko, Nightscout, xDrip and Hevy receive
  only the requests required by their configured connector. Credentials go to
  that provider, not to a T1 Arc server.
- Tarv1s uses the same bring-your-own-key path for every build. The device sends
  the user's question and the bounded evidence needed to answer it directly to
  OpenAI. A random safety identifier stored on the phone accompanies those
  requests; it is not derived from health readings or account details. OpenAI
  also receives normal network metadata. The key is not supplied by or routed
  through the maintainer. See [Tarv1s data handling](docs/TARV1S_BYOK.md#what-leaves-the-phone).
- **About T1 Arc > Check for updates** makes a manual, unauthenticated request
  to GitHub for public release and build metadata. It does not send health
  records, provider credentials or a device identifier. GitHub still receives
  ordinary network metadata such as the IP address. Opening the release page
  or downloading an APK uses GitHub and its asset hosts. Nothing downloads or
  installs automatically; Android asks before an update is installed.
- Submitted branded-food text or a barcode, plus selected country/language
  context, can be sent to Open Food Facts. A US barcode miss can trigger the
  documented low-rate USDA exact-GTIN fallback. These services also see the
  phone's network address. Bundled CoFID, USDA, MEXT, CNF, Ciqual and BLS
  reference search, and the enabled optional US branded index, are offline.
- Google's ML Kit SDK can send performance and usage diagnostics to Google
  over HTTPS. For bundled features, Google lists device/app information,
  per-installation identifiers, latency, image format/resolution, input/output
  sizes, feature versions and event/error codes. These identifiers are not
  intended to uniquely identify a person or physical device. The SDK may also
  contact Google for maintenance information. This is separate from label
  photos and recognised text, which remain on-device. See Google's
  [ML Kit privacy terms](https://developers.google.com/ml-kit/terms) and
  [Android data disclosure](https://developers.google.com/ml-kit/android-data-disclosure).

Provider services and OpenAI apply their own terms and privacy policies. T1 Arc
must not describe a direct third-party request as purely local processing.

## Android and Wear surfaces

Health Connect reads occur only after Android permission and retain the source
application identity. Notification capture requires Android notification access
and a matching user rule. Persistent notifications, widgets, Android Auto, Wear
and watch complications can display a bounded glucose snapshot to the relevant
Android system surface. Lock-screen redaction and per-surface controls reduce
exposure but cannot make a visible system surface private from someone who can
see the device.

## Diagnostics and contributions

Application diagnostics should contain stable outcome categories rather than
credentials, endpoints, filenames, account identifiers or health values. Never
attach a database, backup, provider export, token, account screenshot or exact
health reading to a public issue. Follow [`SECURITY.md`](SECURITY.md) for private
vulnerability reporting and use synthetic fixtures for normal bug reports.

The detailed connector, backup and erase boundaries are documented in
[`docs/INTEGRATION_CONTRACTS.md`](docs/INTEGRATION_CONTRACTS.md).
