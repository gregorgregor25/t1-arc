# Local glucose alarms (development build)

This phone-only feature is being developed on `codex/aaps-local-source`. It does
not change AAPS, the sensor connection, insulin delivery or the Wear companion
protocol. It evaluates the glucose source already selected in T1 Arc.

**T1 Arc's alarms are a back-up.** Keep your sensor maker's alarms, or your AAPS
alarms, turned on as well. T1 Arc never calculates insulin doses, suggests
treatment or controls a pump.

## Setup

Open T1 Arc's glucose alert settings. Choose the low and high thresholds you
want; a very-high threshold must be entered before that category can be enabled.
Existing low/high preferences seed the editing form. Opening settings does not
migrate ownership, enable sounds or play a sample.

For each category choose **Steady pulse**, **Two notes**, or **Choose audio file**.
Files chosen through Android's document picker are copied into the app's private
storage. Supported files must be playable audio without video, 0.1–60 seconds
long and at most 10 MiB. Up to 24 custom sounds may be stored. Selecting or
importing a sound does not play it. **Play** previews at most six seconds;
**Stop preview** is beside each Play control. Android's alarm volume also applies.

**Allow alarm sounds** is an explicit choice. The first time, save the settings
while T1 Arc is open to arm audio. Saving with audio enabled can sound an
existing unresolved alert. A settings save is not an acknowledgement. The
notification permission and alarm volume need to allow the intended behaviour;
use **Allow precise alarm timing** to open Android's Alarms & reminders
permission page. Without that permission, Android can delay snooze expiry and
missing-reading checks.

### Defaults

Everything new is quiet until the user turns it on:

| Setting | Default |
| --- | --- |
| Allow T1 Arc alerts / Allow alarm sounds | Off / off |
| Urgent low | On, 3.0 mmol/L (54 mg/dL), Steady pulse (only acts once alerts are on) |
| Low | On, 3.9 mmol/L |
| High | On, 13.9 mmol/L, alerts straight away |
| Very high | Off, no level chosen |
| Missing readings | Off |
| Only alert if high lasts | Straight away (0 minutes) |
| Pause low alerts after a logged hypo treatment | 15 minutes |

Older saved choices (configuration version 1) are upgraded on read. The master
switch and the sound switch are never changed. Urgent low follows the existing
low switch: it is on when low alerts were on, at 3.0 mmol/L, or 0.2 mmol/L
below a low threshold that is already at or under 3.0 mmol/L. If that would be
below 2.0 mmol/L, urgent low stays off. Urgent low uses the low sound, the high
delay is 0 and the hypo pause is 15 minutes. The upgrade never turns sound on.

### Urgent low

Urgent low (default 3.0 mmol/L, 54 mg/dL; 2.0–4.0 mmol/L allowed) takes priority
over low and must be below the low level when both are on. It:

- can be snoozed for at most 30 minutes;
- reminds at least every 30 minutes while it lasts, even if reminders are set
  to “Never” or a longer interval, or after **Silence this alert**;
- is never quietened by the night schedule;
- is never paused by a logged hypo treatment;
- is never delayed.

A reading that falls from low into urgent low sounds a new alert straight away.
A reading that rises from urgent low back into low continues the same episode,
so it does not sound a second time.

### Only alert if high lasts

**Only alert if high lasts** (0, 5, 10, 15, 20 or 30 minutes) applies to high
and very high only. The alert waits until glucose has stayed above the level for
that long, counted from the first reading above it. Time already spent high
counts when glucose rises into very high. While waiting there is no notification
and no sound. Missing readings cannot confirm a waiting high. Urgent low, low and
missing-reading alerts are never delayed.

If readings stop while a high is waiting, the missing-reading alert (when it is
on) sounds as usual; the waiting high never hides it. The waiting high is kept
separately, unconfirmed. When readings return and glucose is still above the
level, the time since the first high reading counts, so the high alert sounds
straight away if the chosen time has already passed. A reading back in range
ends it. Once the waiting time has passed without readings, T1 Arc checks again
at its normal one-minute cadence rather than repeatedly.

### Pause after a logged hypo treatment

When a new **Treating a hypo** entry is saved, ordinary low alerts pause for the
chosen time (0, 10, 15, 20 or 30 minutes; 0 turns this off), counted from the
treatment time. The saved-entry message says how long low alerts are paused and
that urgent low alerts still sound. A treatment logged more than the chosen time
ago does not pause anything. A low that is already sounding is snoozed until the
pause ends and is checked again then. Editing an older entry does not start a
pause. The pause does nothing while alerts are off or low alerts are off.

### Night schedule

The optional night schedule follows the phone's local clock. Ordinary high
glucose is shown inside the app silently during this period, without a new
notification that could vibrate a mirrored watch. Urgent low, low, very high and
missing-reading alerts keep their chosen sounds when audio is armed. No
thresholds or alert settings are copied into AAPS.

## Snooze and silence

The active alert offers **5, 10, 15, 20, 30 minutes**, **1 hour**, and **Snooze
until…**. Urgent low offers only choices up to 30 minutes. The custom option
opens Android's clock-face picker and confirms the end time and duration,
including “Tomorrow” when appropriate. Snooze is limited to the next 24 hours
(30 minutes for urgent low). Nonexistent clock times during a daylight-saving
change are rejected rather than silently moved.

Snooze applies to that alert episode. A new urgent low, a new low or a
transition from high to very high gets a separate episode. Controls carrying an
old episode ID cannot silence a newer alert. The end time remains visible, and
snooze can be cancelled early. Expiry evaluates the current reading before
deciding whether to sound.

**Silence this alert** acknowledges the current episode. It does not claim
glucose has recovered. The chosen repeat interval controls further reminders
while the excursion continues. Closing the controls alone does not silence it.
Actual alarm playback is bounded to a 60-second burst; previews are separately
bounded and cannot replace a playing alarm.

## Restarts, updates and readiness

Arming follows the saved choices only. Once **Allow T1 Arc alerts** and **Allow
alarm sounds** have been saved, they stay armed after:

- an app update (`MY_PACKAGE_REPLACED`);
- a phone restart (`BOOT_COMPLETED`, after the first unlock);
- Android closing T1 Arc in the background.

Nobody needs to open the settings screen again. Alerts the user turned off stay
off. Previously, audio arming lived in an in-memory flag that only a settings
save could set, so any process restart left alarms silently disarmed.

Limits:

- Settings are stored in credential-encrypted storage protected by an Android
  Keystore key, so alarms restart after the first unlock following a reboot,
  not on the lock screen before it. `LOCKED_BOOT_COMPLETED` is therefore not
  used.
- Force-stopping T1 Arc stops Android from delivering any broadcast to it.
  Opening T1 Arc once restarts monitoring automatically.
- Android 15 does not allow a media-playback foreground service to start from
  `BOOT_COMPLETED`. The monitor starts as a special-use service, and alarm audio
  is added only when an alert plays.
- At target SDK 36, background alarm audio needs a running non-short foreground
  service. Android 17's extra while-in-use requirement applies at target SDK 37,
  and is waived for `USAGE_ALARM` audio when exact alarms are allowed. Recheck
  this before raising the target SDK.

When Android needs the user to change something, T1 Arc shows a persistent
warning on the alert settings screen and a short, value-free line in its
ongoing notification (“Alarm sound needs attention · open T1 Arc” or
“Alarms need attention · open T1 Arc”). Warnings
cover: notifications blocked for the app or the “Glucose alarms” category,
the background monitor not running, a blocked alarm sound, alarm volume at zero,
T1 Arc's sound level at 0%, Do Not Disturb set to total silence, precise alarm
timing not allowed, a missing custom sound file (the built-in Steady pulse
plays instead), and saved choices that cannot be read securely.

## Reliability boundaries

- Native Android code owns evaluation, persistence, playback and snooze once the
  new settings have been explicitly saved. The old JavaScript notification path
  is then fenced off. AAPS intake does not require the React screen to be open.
- Source selection, measurement timestamps, validity, privacy epochs and stale
  readings remain part of the decision. Missing readings do not establish
  recovery, and an old measurement is not repeatedly presented as a fresh low.
- Timers use elapsed time within the current boot. A snooze or hypo pause from
  before a restart does not carry over; the current reading is checked again.
- Alarm playback uses Android alarm audio with an eligible foreground-service
  lifecycle. Ringer vibrate mode is distinct from alarm volume. Permission,
  audio-focus, device routing and service restrictions can still prevent sound.
- The existing watch companion continues receiving glucose as before. Dedicated
  watch alarms or remote acknowledgement are not added by this phone update.

The built-in sounds are original listening concepts. Neither their waveform,
volume ramp nor this implementation has been clinically validated to wake a
person during hypoglycaemia. Silent automated tests and a muted emulator do not
prove audible speaker output, overnight waking, Bluetooth routing or screen-off
reliability on a particular phone. Those checks require an explicitly approved
device test before relying on this development feature overnight.

## Data and verification

Configuration, episode state and imported names are encrypted locally using an
Android Keystore key. Audio files stay in private app storage. They are not sent
to Tarv1s or any server.

Encrypted portable backups (preferences format version 7) include the alarm
choices: thresholds, which levels are on, sound choices, repeat interval,
volume and ramp, night schedule, high delay and hypo pause. They never include
**Allow T1 Arc alerts** or **Allow alarm sounds**, so a restore always leaves
alarms switched off for the user to check and turn on. Custom sounds are stored
as a reference only (an opaque ID and the name the user saw), never the audio.
On restore, a custom sound that is not on the phone is replaced by the built-in
sound for that level (Steady pulse for urgent low, low and missing readings; Two
notes for high and very high), and the restore summary says so. Backups made in
preferences format 1–6 still restore; they carry only the older common low/high
choices, and the existing alarm choices on the phone are disarmed but otherwise
kept. Restoring first disables both the native alarm owner and its audio.
Full local-data erasure disables the native owner and removes its files.

Automated coverage (Kotlin) exercises arming from saved choices across
restarts, readiness warnings, threshold ordering, urgent-low priority,
hysteresis, snooze and repeat caps, the high delay, the hypo pause, night
schedule interaction, very-high escalation, duplicate observations, freshness,
acknowledgement, snooze expiry, source changes and clock changes. TypeScript
tests cover validation, the version 1 upgrade, the snooze cap, the backup round
trip, older backup versions, missing custom sounds and daylight-saving time
selection. Android runtime checks must distinguish a posted notification from
successful audio playback.

Platform references: [Android 17 background audio restrictions](https://developer.android.com/about/versions/17/changes/bg-audio),
[foreground-service types](https://developer.android.com/develop/background-work/services/fgs/service-types),
and [alarm audio attributes](https://developer.android.com/reference/android/media/AudioAttributes#USAGE_ALARM).
