# Using T1 Arc

## Start with onboarding

The tour explains the local-first data model, regional settings, source
connections and the limits of the app. You can explore the synthetic demo
without connecting a real provider. Demo records stay separate from personal
history. A fresh app launch returns to the private live-data view.

T1 Arc does not calculate insulin doses or replace the official display for a
CGM or pump.

## Today

Today is the main daily overview. It can show:

- current glucose, direction and reading age;
- time in the selected glucose range;
- basal and bolus insulin records;
- meals and carbohydrate totals;
- activity and Health Connect context;
- notes and other manual records.

Tap a card or chart section to inspect the records behind it. Missing data stays
missing instead of being silently estimated.

## History

History supports day, 3-day, 7-day and 30-day views. Use the arrows or date
picker to move through time. Glucose and insulin remain on separate scales and
each imported record keeps its source and timestamp.

## Food

Open Food from Today to search, scan, copy another meal, log quick carbs or use
saved items. Read [Food logging](FOOD_LOGGING.md) for the complete workflow.

## Health

Health Connect is Android's permission-controlled bridge for supported health
records. T1 Arc imports only the record types you allow. Availability depends on
the apps and records on your phone.

The Health screen shows the chosen source, freshness and import status by data
type. Older-history permission is optional because recent records can work
without it.

## Tarv1s

Open **Tarv1s** from the bottom navigation. It is the question interface.
Some exact questions are answered locally.
Broader questions require the user's own OpenAI API key and send a bounded
evidence packet only after the user submits the question. Read the
[Tarv1s BYOK guide](TARV1S_BYOK.md) before enabling it.

## Insights

In the Tarv1s tab, choose **Insights** at the top to review recent periods.
Coverage appears beside each observation. An association is a pattern worth
reviewing, not proof that one event caused another. The app should withhold a
claim when coverage is too weak. Choose **Tarv1s** to return to questions.

## Settings

Settings contains:

- source connections;
- region, locale and measurement units;
- glucose display, alerts, notification, widget and lock-screen choices;
- Health Connect and activity sources;
- encrypted backup, restore and local-data controls;
- **About T1 Arc**, with build details and links to source code and licences.

The overview starts with connection shortcuts. Open **Region and services**
for country and unit preferences. The close button stays at the top while you
scroll. Android Back returns from a detail page to all settings, then to the
previous app screen.

Android keeps final control over notification, accessibility, lock-screen and
Health Connect permissions. T1 Arc opens the relevant system page where Android
does not allow an app to grant its own permission.

## Back up before risky changes

An encrypted portable backup includes supported local records and preferences.
It excludes provider passwords, session cookies and API keys. Keep the backup
password separate from the backup file.

Use the erase control only when you intend to remove the app's local data. It is
not the same as disconnecting one source.
