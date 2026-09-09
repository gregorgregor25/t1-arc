# Download, install and update T1 Arc

You do not need to build T1 Arc. The official Android phone app is distributed
as a signed APK on GitHub Releases.

**The first public APK is not available yet.** These instructions describe the
download and update process once it is published. Check [Release status](RELEASE_STATUS.md)
before downloading; the old private test drafts are not the current app.

## Before installing

- Use a phone running Android 8.0 or newer.
- Download only from
  [github.com/gregorgregor25/t1-arc/releases](https://github.com/gregorgregor25/t1-arc/releases).
- The app file is named `T1-Arc-vX.Y.Z.apk`.
- Files named **Source code** are for developers and cannot be installed as an
  Android app.

If the latest release has no APK under **Assets**, no public build is available
yet.

## Install on an Android phone

1. On the phone, open the
   [latest T1 Arc release](https://github.com/gregorgregor25/t1-arc/releases/latest).
2. Expand **Assets** if GitHub has collapsed the list.
3. Tap `T1-Arc-vX.Y.Z.apk` and allow the download.
4. Open the downloaded file from the browser notification or the Files app.
5. If Android blocks it, choose **Settings** and allow installs from the browser
   or Files app currently opening the APK. Return to the installer afterwards.
6. Choose **Install**, then **Open**.

Android's wording differs between phones. The permission applies to the app
that opens the APK, not to every download on the phone. You can turn it off
again after installation.

## First run

The onboarding tour explains local storage, regional choices, connections and
the limits of the app. Start with the synthetic demo if you want to explore
without connecting personal data. The demo is a temporary viewing mode. A
fresh app launch returns to the private live-data view, and no example record
is copied into personal history.

Before relying on a live glucose source:

1. choose the correct country, locale and glucose unit;
2. connect the provider region used by the account;
3. compare the newest reading and timestamp with the provider's official app;
4. keep the official medical-device display available.

Some optional display features open Android system settings. Always-on display
access can require **Allow restricted settings** in T1 Arc's Android app-info
menu before Accessibility can be enabled. T1 Arc cannot approve that permission
for itself.

## Update T1 Arc

Open **About T1 Arc > Check for updates** for a manual check against the official
GitHub repository. If an update is offered, review **What's changed** and open
its release page. Nothing downloads or installs automatically. You can also
watch the repository's Releases or check the Releases page yourself.

The check does not offer draft or GitHub prerelease builds. It also explains
when a private or development package cannot be updated by the public APK.
An unavailable update check does not change your installation.

When a compatible public APK is available:

1. Create an encrypted T1 Arc backup first.
2. Download the newer `T1-Arc-vX.Y.Z.apk` from the latest release.
3. Open it and choose **Update**.
4. Open T1 Arc and confirm that local records, settings and connections are
   still present.

Do not uninstall the existing app before an update. Android removes local app
data when an app is uninstalled. Official releases use the same package name
and signing identity so Android can update them in place.

If Android says the package conflicts with an existing app or the signature is
invalid, stop. Do not remove the working app to force the installation. Open a
bug report with the T1 Arc versions involved and no personal health data.

## Check which build is installed

Open the settings menu and choose **About T1 Arc**. This shows the version,
Android package and source revision. **Share build details** copies those
details into Android's share sheet without including health records or keys.

If two icons have the same name, open each app and compare its package. Keep
both until you know where your records are. A private test package and an
official package have separate storage; installing one does not move data from
the other. Older test builds may not have an About page.

A package ending in `.sideload` is a private test installation, not the official
public package. Renaming its APK file does not turn it into an official update.
Keep it installed until an encrypted backup has been verified and restored into
the official app. Review the restored records, reconnect sources and the
optional OpenAI key, and grant Android permissions again. Phone and Wear
companion package IDs and signing certificates must match for their data link.

## Verify a download

Each release includes a file named `T1-Arc-vX.Y.Z.apk.sha256`. It contains the
SHA-256 checksum of the APK. This is useful for checking that a copied download
matches the release asset.

On Windows PowerShell:

```powershell
Get-FileHash .\T1-Arc-vX.Y.Z.apk -Algorithm SHA256
```

On macOS or Linux:

```bash
sha256sum T1-Arc-vX.Y.Z.apk
```

The value must exactly match the checksum file from the same release.

The release also includes `T1-Arc-vX.Y.Z.apk.build.json`, a small text record
linking that checksum to the source commit, package and version. You do not
need it to install the app. It helps maintainers identify the exact build in
a bug report. The checksum checks file identity, not whether the app is safe.

## Backups and changing phones

Create an encrypted portable backup in T1 Arc, keep its password separately,
then restore it in T1 Arc on the new phone. Backups deliberately exclude
provider passwords, session cookies and API keys, so those connections must be
set up again.

Do not post a backup, database, provider export, credential or identifying
screenshot in a GitHub issue.

## Need help?

Read [Troubleshooting](TROUBLESHOOTING.md), then use the repository's issue form
if the problem repeats. You do not need development tools or Android logs to
make a useful report. Include the T1 Arc version shown in the release or app
information screen, the Android version, the phone model, and a reproduction
using invented values.
