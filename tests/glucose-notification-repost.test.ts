import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Gradle does not run in this test suite, so these source contracts pin the
// battery rule for the ongoing glucose notification: post once per visible
// change, never skip a new reading, and keep alarm foreground handling as is.
const kotlin = readFileSync(
  'modules/t1arc-glucose-display/android/src/main/java/io/github/gregorgregor25/t1arc/glucosedisplay/T1ArcGlucoseDisplayModule.kt',
  'utf8',
);

function between(start: string, end: string) {
  const from = kotlin.indexOf(start);
  expect(from).toBeGreaterThanOrEqual(0);
  const to = kotlin.indexOf(end, from + start.length);
  expect(to).toBeGreaterThan(from);
  return kotlin.slice(from, to);
}

describe('ongoing glucose notification posts', () => {
  it('builds its key from the reading, value, trend, age, on-board text and alarm warning', () => {
    const key = between('private fun contentKey(context: Context): String {', 'private fun stillShown');
    for (const input of [
      'snapshot.timestampMs',
      'snapshot.mmolL',
      'snapshot.trend',
      'GlucoseSurfaceCopy.age(snapshot.timestampMs, now, locale)',
      'GlucoseSurfaceCopy.staleTitle(snapshot.timestampMs, now, locale)',
      'onBoard?.compact',
      'onBoard?.detail',
      'T1ArcGlucoseAlarmEngine.ongoingWarning',
      'T1ArcGlucoseDisplayState.lockScreenVisible(context)',
      'T1ArcGlucoseDisplayState.displayColor(context, snapshot, freshness)',
      'T1ArcGlucoseDisplayState.displayGlucoseUnit(context)',
    ]) {
      expect(key).toContain(input);
    }
  });

  it('skips only an identical post that is still on screen, and updates widgets on change', () => {
    const notify = between('  fun notify(context: Context) {', '  fun cancel(context: Context) {');
    expect(notify).toContain('if (key != null && key == shownKey && stillShown(manager)) {');
    const skip = notify.indexOf('return@publishIfEnabled');
    const post = notify.indexOf('manager.notify(NOTIFICATION_ID, build(context))');
    expect(skip).toBeGreaterThan(0);
    expect(post).toBeGreaterThan(skip);
    expect(notify.indexOf('T1ArcGlucoseWidget.updateAll(context)')).toBeGreaterThan(post);
    expect(notify.indexOf('T1ArcAodAccessibilityService.snapshotChanged()')).toBeGreaterThan(post);
    const cancel = between('  fun cancel(context: Context) {', 'private object T1ArcReviewNotification');
    expect(cancel).toContain('shownKey = null');
  });

  it('calls startForeground only for a new instance, a mode change or a service type change', () => {
    const start = between('override fun onStartCommand(', 'private fun aapsSelected()');
    expect(start).toContain('resolvedMode == foregroundStartedMode &&');
    expect(start).toContain('foregroundType == foregroundStartedType');
    expect(start).toContain('resolvedMode == GlucoseCollectorForegroundMode.GLUCOSE_DISPLAY &&');
    expect(start).toContain(
      '(if (alarmPlaybackActive) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK else 0)',
    );
    expect(start).toContain('foregroundStartedMode = resolvedMode');
    expect(start).toContain('if (refreshShownNotification) T1ArcGlucoseNotification.notify(this)');
    // The disable fence still returns before any post.
    expect(start.indexOf('return@mutate null')).toBeLessThan(start.indexOf('refreshShownNotification = true'));
  });

  it('leaves the alarm playback foreground path unchanged', () => {
    const alarm = between('fun setAlarmPlaybackForeground(', '/** False when the request');
    expect(alarm).toContain('service.startForeground(');
    expect(alarm).not.toContain('shownKey');
    expect(alarm).not.toContain('foregroundStartedMode');
  });
});
