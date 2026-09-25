# T1 Arc technical privacy model

The official app's public [privacy policy](https://t1arc.com/privacy/) explains
the maintainer's handling, optional connections, support reports and deletion
choices. This source document records the implementation underneath it.

This document describes the source code's data flows. It is not a distributor's
legal privacy policy or store data-safety declaration; whoever distributes a
build must review the exact build, hosting, support and store configuration.

## Local storage

Health records, imported provider records, food logs, context, Insights and
Tarv1s conversation state are stored on the Android device. Health databases
use SQLCipher. Provider credentials and the user's selected AI provider API
keys use Android secure storage. Android system backup is disabled.

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
using bundled ML Kit and an English word-recognition model, without sending them to a cloud OCR
service. Temporary photo copies are removed after success, failure or
cancellation; OS cache cleanup is the fallback if deletion fails. The proposed
values remain editable and are not saved as a food until the user chooses to
save. These food additions describe current source behaviour; availability in
a downloaded APK depends on its release.

Optional food, meal and recipe photos are different from temporary label
photos. Saved copies are kept inside the encrypted local database and included
in encrypted portable backups. Product images can be requested from Open Food
Facts image hosts; those hosts receive ordinary network metadata. User-taken
photos are not uploaded to Open Food Facts or used as an automatic nutrition
estimate. Removing a saved photo removes the app copy, not a separate original
chosen from the device or a previously exported backup.

The optional independent-APK watch installer communicates with the selected
watch on the local network. Pairing codes are temporary; its ADB identity is
kept in Android secure storage. Connections close after setup. Disabling watch
debugging does not stop normal paired-watch glucose delivery.

## Network flows chosen by the user

T1 Arc has no maintainer data relay in the normal app path. A connection sends
data directly from the device to the service the user selected:

- LibreLinkUp, Dexcom Share, Medtrum, Glooko, Nightscout, xDrip and Hevy receive
  only the requests required by their configured connector. Credentials go to
  that provider, not to a T1 Arc server.
- Tarv1s uses the same optional bring-your-own-key path for every build. The
  user chooses OpenAI, Google Gemini or Anthropic Claude. For an eligible AI
  question, the device sends the question, relevant bounded evidence and any
  recent shared conversation directly to that selected provider. General
  education questions have no personal evidence packet, and supported exact
  calculations run locally without an AI request. There is no silent provider
  fallback. OpenAI requests include a random safety identifier stored on the
  phone; it is not derived from health readings or account details. The
  selected provider also receives normal network metadata. Keys are supplied
  by the user and are not routed through the maintainer. See
  [Tarv1s data handling](docs/TARV1S_BYOK.md#what-leaves-the-phone).
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

Connected services and the selected AI provider apply their own terms and
privacy policies. T1 Arc must not describe a direct third-party request as
purely local processing. In particular, Google's Gemini API terms require a
billing-enabled project for health information in this route; users should
review the [provider-specific requirements](docs/TARV1S_BYOK.md#choose-a-provider).

## Android and Wear surfaces

Before enabling the optional always-on glucose display, T1 Arc explains its
Accessibility service and asks for agreement. The service observes system
display events to place the glucose overlay. It does not retrieve other apps'
window content or send Accessibility events off the device. The feature can be
disabled without preventing use of the rest of the app.

Health Connect reads occur only after Android permission and retain the source
application identity. Notification capture requires Android notification access
and a matching user rule. Persistent notifications, widgets, Android Auto, Wear
and watch complications can display a bounded glucose snapshot to the relevant
Android system surface. Lock-screen redaction and per-surface controls reduce
exposure but cannot make a visible system surface private from someone who can
see the device.

## Diagnostics and contributions

### Voluntary support and Tarv1s response reports

**Settings → Help and support → Report a problem** lets you describe an app
problem without a GitHub account. You can optionally include a technical summary:
app version/build, Android version, device model and predefined technical event
codes with minute-resolution UTC timestamps. You can inspect the exact report
before consenting to send or export it. Diagnostic fields do not include readings,
conversations, credentials, URLs, raw error messages or stack traces. Free text
can contain information you choose to add, including an email address for a reply.

Selected app lifecycle, foreground refresh and recoverable interface-error events
are kept in the encrypted local database. This is not a complete native crash log.
At most 60 events within the preceding 24 hours are retained, with older events
pruned on the next read or update. You can clear the technical log in Help and
support; erasing this device's data also clears it. These events are excluded from
encrypted health backups. There are no automatic diagnostic uploads.

Saving a report uses Android's file picker to create an **unencrypted text file**
at your chosen location. Sharing passes the preview to an app you choose; its
privacy practices then apply. You control exported copies, and clearing the app's
log does not remove them or emails already sent. Temporary export files are removed
after saving or cancelling; interrupted exports use the existing private temporary
file cleanup. The private delivery and retention rules below apply to both kinds
of in-app report.

The in-app **Report response** flow is a separate, optional contact with the
maintainer. Opening it sends nothing. The user writes a message, can choose to
include the response, edits the text, and explicitly agrees before sending.
For response reports, only that message, selected reason, app version, random report reference and
consent flag are submitted. There are no automatic evidence attachments,
questions, conversation histories, provider credentials or API keys. Users
must remove any sensitive details they do not want to share.

The report travels over HTTPS to a Cloudflare Worker and then to the private
Gmail inbox behind support@t1arc.com. Cloudflare necessarily processes the
request IP and transport metadata. Application logs contain only a generic
delivery-failure category, not report contents or IPs. The Worker has no report
database; the support email contains the report. Abuse controls use short-lived
rate-limit keys derived from the request IP.

Reports may contain health or other personal information if the user chooses
to include it. They are used to investigate and improve the app, not published
as issues. They are retained while being investigated; users can ask
support@t1arc.com to delete a report using its reference. A sent email cannot
be recalled by closing the app. An interrupted send may have been received;
there is no automatic retry. This is not an emergency or medical support channel.

Do not describe this optional support path as automatic health-history
collection, or claim that health information can never reach the maintainer.

### Public diagnostics

Application diagnostics should contain stable outcome categories rather than
credentials, endpoints, filenames, account identifiers or health values. Never
attach a database, backup, provider export, token, account screenshot or exact
health reading to a public issue. Follow [`SECURITY.md`](SECURITY.md) for private
vulnerability reporting and use synthetic fixtures for normal bug reports.

The detailed connector, backup and erase boundaries are documented in
[`docs/INTEGRATION_CONTRACTS.md`](docs/INTEGRATION_CONTRACTS.md).
