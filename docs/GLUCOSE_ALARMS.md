# Local glucose alarms (development build)

This phone-only feature is being developed on `codex/aaps-local-source`. It does
not change AAPS, the sensor connection, insulin delivery or the Wear companion
protocol. It evaluates the glucose source already selected in T1 Arc.

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

**Allow alarm sounds** is an explicit choice. Save the settings while T1 Arc is
open to arm audio. Saving with audio enabled can sound an existing unresolved
alert. A settings save is not an acknowledgement. The notification permission
and alarm volume need to allow the intended behaviour; use **Allow precise alarm
timing** to open Android's Alarms & reminders permission page. Without that
permission, Android can delay snooze expiry and missing-reading checks.

The optional night schedule follows the phone's local clock. Ordinary high
glucose is shown inside the app silently during this period, without a new
notification that could vibrate a mirrored watch. Low and very-high categories
keep their chosen sounds when audio is armed. Freshness warnings are separate.
No thresholds or alert settings are copied into AAPS.

## Snooze and silence

The active alert offers **5, 10, 15, 20, 30 minutes**, **1 hour**, and **Snooze
until…**. The custom option opens Android's clock-face picker and confirms the
end time and duration, including “Tomorrow” when appropriate. Snooze is limited
to the next 24 hours. Nonexistent clock times during a daylight-saving change
are rejected rather than silently moved.

Snooze applies to that alert episode. A new low or a transition from high to
very high gets a separate episode. Controls carrying an old episode ID cannot
silence a newer alert. The end time remains visible, and snooze can be cancelled
early. Expiry evaluates the current reading before deciding whether to sound.

**Silence this alert** acknowledges the current episode. It does not claim
glucose has recovered. The chosen repeat interval controls further reminders
while the excursion continues. Closing the controls alone does not silence it.
Actual alarm playback is bounded to a 60-second burst; previews are separately
bounded and cannot replace a playing alarm.

## Reliability boundaries

- Native Android code owns evaluation, persistence, playback and snooze once the
  new settings have been explicitly saved. The old JavaScript notification path
  is then fenced off. AAPS intake does not require the React screen to be open.
- Source selection, measurement timestamps, validity, privacy epochs and stale
  readings remain part of the decision. Missing readings do not establish
  recovery, and an old measurement is not repeatedly presented as a fresh low.
- Timers use elapsed time within the current boot. Audio must be re-armed from
  the settings screen after process recreation or a phone restart. The readiness
  display reports this instead of claiming audio coverage has automatically
  resumed. Force-stopping the app prevents background monitoring.
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
to Tarv1s or any server. Portable backups retain common low/high thresholds and
category choices, but exclude audio arming, sounds, custom files, night settings
and the very-high configuration. The older portable format supports reminder
intervals of 0, 30, 60 or 120 minutes; shorter native intervals export as 0 (no
automatic reminder), so review the interval after restoration. Restoring these
choices first disables both the native alarm owner and its audio; existing local
sound files remain available. Configure and test alarms again on another phone.
Full local-data erasure disables the native owner and removes its files.

Automated coverage exercises threshold ordering, very-high escalation,
hysteresis, duplicate observations, freshness, acknowledgement, snooze expiry,
source changes, clock changes and quiet hours; TypeScript tests cover validation,
legacy handover and daylight-saving time selection. Android runtime checks must
distinguish a posted notification from successful audio playback.

Platform references: [Android 17 background audio restrictions](https://developer.android.com/about/versions/17/changes/bg-audio),
[foreground-service types](https://developer.android.com/develop/background-work/services/fgs/service-types),
and [alarm audio attributes](https://developer.android.com/reference/android/media/AudioAttributes#USAGE_ALARM).
