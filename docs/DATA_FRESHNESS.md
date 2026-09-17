# How current is my data?

Different sources arrive at different times. A successful connection check
means the source answered; it does **not** mean it supplied a new record.
Distinguish **when T1 Arc checked** from **when the measurement happened**.

## What to expect

| Source | What reaches T1 Arc | Timing and limits |
| --- | --- | --- |
| LibreLinkUp, Dexcom Share, Medtrum | Readings made available by the provider’s cloud | The sensor/controller must upload first. T1 Arc cannot recover a reading the cloud has not received. Check the reading time. |
| Nightscout | Glucose from your configured site | Depends on its uploader and site availability. Older-history retrieval is separate from current readings. |
| xDrip | Readings from its configured local or HTTPS endpoint | Same-phone access avoids a cloud hop, but xDrip must be running and receiving readings. |
| Notification capture | Readings in supported notifications | Depends on the publishing app, Android notification access and the configured rule. |
| **Glooko** | **Delayed insulin, pump and glucose history** | **Not live pump status.** Automatic recent-history checks become due about hourly. Records may already be behind when Glooko supplies them; there is no guaranteed fixed delay. |
| Health Connect | Records another app has written and you allowed T1 Arc to read | Foreground checks become due about every five minutes. A wearable may sync to its own app before that app writes to Health Connect. |
| Hevy | Saved strength workouts and changes | Automatic checks become due about every 30 minutes. You can also use **Sync new and changed workouts**. |
| Manually selected files | History contained in that export | Import a new file for newer data. Import time does not change the dates inside it. |

These are scheduling intervals, not delivery guarantees. Android can defer
background work; internet access, battery restrictions, source availability and
permissions also matter. Opening the app lets due work resume. Historical
backfills and Glooko reports have their own slower schedules and may finish later.

## Why today’s totals can change later

A bolus can appear on a pump before Glooko makes it available to T1 Arc. Until
it arrives, today’s imported insulin total may be incomplete. Later imports can
fill that gap and change the total. An incomplete imported total does not prove
that no insulin was delivered.

Sleep, activity and meals can also arrive later. Tarv1s and Insights review the
records currently stored in T1 Arc; missing or delayed sources limit their
answers. A saved answer is a snapshot and does not rewrite itself when more
records arrive.

## If glucose stops updating

1. Compare the **reading time** in T1 Arc with the provider’s official app.
2. If both are old, check the uploading device and provider connection.
3. If the official app is current but T1 Arc is behind, open that source in
   T1 Arc Settings and use its connection check. Check the account region,
   network/VPN and any visible error.
4. If it repeats, use **Settings → Help and support → Report a problem** and
   review the optional technical summary before sending.

Current glucose is marked delayed after six minutes and stale after twelve.
A stale value remains a last-known reading, never a new measurement. Keep the
official sensor or pump display and alerts available.

See [connections](CONNECTIONS_AND_REGIONS.md),
[troubleshooting](TROUBLESHOOTING.md) and [support](../SUPPORT.md).
