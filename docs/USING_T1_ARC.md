# Using T1 Arc

## Start with onboarding

The tour explains the local-first data model, regional settings, source
connections and the limits of the app. You can explore the synthetic demo
without connecting a real provider. Demo records stay separate from personal
history. A fresh app launch returns to the private live-data view.

T1 Arc does not calculate insulin doses or replace the official display for a
CGM or pump.

You do not need to customise the app to get started. The choices below are
optional and do not change the underlying health records.

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

Choose **Edit** beside **At a glance** to move your priorities up or down. Today
shows the first three with available data. A priority without records is skipped,
not replaced with zero. **Use default order** restores the original order.

If a connection needs attention, open its small status row to see the last
available record time and a route to connection settings. An ordinary delay in a
successful history import is not presented as a broken connection.

### When you start a new sensor

Choose **Started a new sensor** beside the glucose area, or **New sensor** from
the logging menu. Check the start time and save it. No extra journal entry is
required.

The note records the change; it does not start the sensor or change any alerts.
**Waiting for readings** can explain the gap while the connected source has not
sent a new reading. The old glucose value keeps its real age and freshness. There
is no fixed one-hour countdown because warm-up time varies by sensor.

The waiting note clears when a fresh reading from the recorded source confirms
that readings have resumed. The sensor-change record stays in history. Tap the
waiting note to edit its time or remove it if you added it by mistake. Continue
to use your sensor's official app for its actual warm-up status.

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

Choose **Edit view** to hide sections you do not want to see. This does not
delete records, revoke permissions or stop imports. **Show all sections** brings
them back. Display choices in the demo are separate from your personal view.

## Tarv1s

Open **Tarv1s** from the bottom navigation. It is the question interface.
Some exact questions are answered locally.
Broader questions require the user's own OpenAI API key and send a bounded
evidence packet only after the user submits the question. Read the
[Tarv1s BYOK guide](TARV1S_BYOK.md) before enabling it.

Starter questions reflect records available in the app. You can still ask in
your own words. For a personal answer, **View calculation and records** opens
supporting details; important gaps and limitations remain visible in the answer.

Where **Ask Tarv1s about this** is available, it opens a question about the
selected period or event. Check the dates above the message, then tap Send. Merely
opening the question does not send it to OpenAI.

### Keep something useful

Choose **Save to notebook** under an answer. **Saved · Open notebook** opens the
saved item, where you can add your own note or question. **My notebook** in Tarv1s
also opens it directly, including when you have not saved an answer yet. You can
add a standalone question for your next appointment there.

Saved answers are snapshots, not new analyses of later records. Items associated
with a different connection appear separately under **Other saved records**.
This includes restored items whose connection does not match. They are not
silently used to analyse your current data.

**Prepare appointment notes** lets you choose up to five items and preview the
summary. Share the text or save printable HTML. A saved glucose chart is included
only when its original evidence could be captured; not every answer has a chart.
The summary is a selection of your records and questions, not a complete medical
record.

The notebook stays on your phone. Shared text and exported HTML are **not
encrypted**. Check the preview and choose the destination yourself. Removing an
item from the notebook does not remove its conversation or health records.

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

### Check for an APK update

Open **About T1 Arc**, then **Check for updates**. This is a manual check against
the official GitHub repository. It does not send health records or automatically
download or install anything. If the repository is private or no suitable public
release exists, the app says so.

When an update is offered, review **What's changed**, make an encrypted backup,
then choose **Open release and download**. Android asks before installing and
checks whether the APK can update this installation. If it rejects the update,
do not uninstall the existing app to force it through.

## Back up before risky changes

An encrypted portable backup includes supported local records and preferences.
It excludes provider passwords, session cookies and API keys. Keep the backup
password separate from the backup file.

Backup settings show the last successfully saved backup recorded by this
installation. Under **Backups and moving to a new phone**, you can enable a
weekly reminder in that settings panel. It is a quiet note, not a notification
or an automatic upload.

Keep a copy somewhere you choose outside the phone. A backup in Downloads alone
will not protect you if the phone is lost. On a new phone, review the restore
preview, reconnect your sources and API key, and grant Android permissions again.
Check the restored history before removing the old installation.

Use **Erase all data from this device** only when you intend to remove health history,
conversations and all notebook items, including archived items. Visual preferences
remain. This is not the same as disconnecting one source, and it does not delete
exported files, shared copies or backups you saved elsewhere.
