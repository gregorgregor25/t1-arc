# Connections and regional setup

## Two regional choices serve different jobs

The T1 Arc regional profile controls display formats, food search and safe
defaults for a new connection. A provider account region controls which host and
contract that provider connection uses.

For example, a person can use UK number formatting while connecting a provider
account hosted in another supported region. Changing the app profile must not
silently move an existing cloud account to another host.

## Set the app profile

Open **Settings**, then **Region and services**.

Choose a preset, country, locale, glucose unit and other measurement choices.
Automatic options follow the Android device where possible. Manual choices stay
in effect until changed.

Stored health values remain canonical. Formatting and input conversion happen
at the boundary, so a unit change does not repeatedly convert old data.

## Connection status

| Source | What T1 Arc supports | Validation boundary |
| --- | --- | --- |
| LibreLinkUp | Supported regional routes, current glucose and history where the account permits it | UK is the main real-account regression baseline |
| Dexcom Share | International, US and Japan account routes | Routes and fixtures are tested; not every region has a maintainer-owned real account |
| Nightscout | User URL plus token or legacy secret, read-only | Server versions and custom deployments vary |
| Medtrum EasyFollow | Supported server-region and unit choices | Contract and fixture coverage does not equal every real account |
| xDrip | Same-phone local endpoint or a configured remote HTTPS endpoint | Requires a working xDrip web service; an app region does not choose its host |
| Compatible notifications | Parses supported notification formats on the same phone | Android permissions and vendor text can vary |
| Glooko | Local import of the account export and background refresh where supported | UK has real regression evidence; US automatic import remains experimental |
| Health Connect | Permission-controlled Android health records | Record types depend on installed source apps and Android permissions |
| Hevy | Direct API-key connection for strength workouts, exercises and sets | Requires API access on the user's Hevy account |
| Strava | Activities written by the Strava Android app to Health Connect | No direct Strava account sign-in or full Strava history download in T1 Arc |

The detailed provider-by-provider evidence is in the
[regional connection test matrix](REGIONAL_CONNECTION_TEST_MATRIX.md).

## Connect safely

1. Select the account region shown by the provider, not the country you happen
   to be visiting.
2. Enter the credential on the provider's T1 Arc settings page.
3. Verify the connection before relying on background updates.
4. Compare the newest timestamp with the provider's official app.
5. Keep the official medical-device display available.

Credentials and provider sessions are stored through Android secure storage.
Imported supported records are copied into the encrypted local database with
their source and timestamp.

## Add activity from Strava or Hevy

For Strava, first enable its Health Connect connection in the Strava Android
app. In T1 Arc, open **Settings > Strava**, then **Open Health Connect settings**
and allow the relevant exercise records. The status changes after a Strava
activity reaches Health Connect. It does not prove that every past activity
has been copied.

For Hevy, open **Settings > Hevy** and enter your own Hevy API key. T1 Arc imports
strength-workout detail directly. Matching Health Connect and Hevy workouts
are reconciled so a workout can keep the health context and the exercise detail
without being counted twice. No Hevy key is needed for the separate Strava route.

## File imports and pump reports

For Dexcom export history, open **Settings > Dexcom** and the Clarity import
section. Choose the export's date order and timezone before selecting its CSV,
review the preview, then confirm the import. Share provides the current source;
Clarity is a separate historical import, not a live reading.

Glooko also accepts manual ZIP/CSV imports and supported Daily Overview reports.
Use the timezone and date order of the export, not a guess based on where the
phone is now. Pump-report activity and pauses describe the report's recorded
period; they are not live pump status. Import files stay private on the phone.

## Large Glooko imports

A first Glooko export can take several minutes to read and organize locally.
The current screen can look stationary during the CPU-heavy ZIP processing step.
Keep the app open until the button becomes available again or a result appears.

This path completed on the physical UK regression account during release QA,
but finer progress and elapsed-time feedback remain a known usability
improvement.

## Travel, time zones and daylight-saving changes

T1 Arc stores instants separately from display context. Travel changes how a
record is grouped and shown without changing the actual event time. Weekly
schedules are evaluated in the configured local schedule context so a timezone
or daylight-saving transition does not rewrite the schedule itself.

After travel, check the selected region, provider region and timezone display.
Do not reconnect an account to a different host merely because the phone moved.

## What implementation cannot prove

Contract tests, sanitized fixtures and source review can prove that routes and
formats are implemented. They cannot prove that every provider account in every
country still returns the same undocumented response. Regional bug reports and
small fixture-based pull requests are welcome. Never attach live credentials or
unedited exports to an issue.
