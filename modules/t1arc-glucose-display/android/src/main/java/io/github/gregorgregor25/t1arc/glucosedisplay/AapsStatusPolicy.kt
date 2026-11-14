package io.github.gregorgregor25.t1arc.glucosedisplay

/** Longest an IOB/COB-only status may wait in the native queue for the JS sync. */
internal const val AAPS_MAX_SYNC_DEFERRAL_MS = 15 * 60_000L

/** What makes one glucose value distinct within a source selection. */
internal data class AapsGlucoseIdentity(
  val writeEpoch: Long,
  val selectionGeneration: Long,
  val timestampMs: Long,
  val mgdl: Double,
  val trend: String?,
) {
  companion object {
    fun of(reading: AapsLocalReading): AapsGlucoseIdentity? {
      val mgdl = reading.glucoseMgdl ?: return null
      val timestamp = reading.glucoseTimestamp ?: return null
      return AapsGlucoseIdentity(reading.writeEpoch, reading.selectionGeneration,
        timestamp, mgdl, reading.trend)
    }
  }
}

/** The sender may have queued an intent before a privacy erase or source change. */
internal object AapsStatusPolicy {
  fun acceptsCaptured(
    capturedEpoch: Long,
    capturedGeneration: Long,
    currentEpoch: Long,
    currentGeneration: Long,
    selectedSource: String?,
  ): Boolean = capturedEpoch == currentEpoch &&
    capturedGeneration == currentGeneration && selectedSource == AAPS_SOURCE_ID

  fun samePayload(previous: AapsLocalReading?, next: AapsLocalReading): Boolean =
    previous != null && previous.copy(id = next.id, receivedAt = next.receivedAt) == next

  /**
   * AAPS sends a status about once a minute, and IOB alone changes almost
   * every time. Only a new or corrected glucose value needs the JS sync
   * straight away; the phone surfaces, watch and alarms are updated natively.
   * A status without glucose never counts, so an intermittent field cannot
   * turn every other status into a change.
   */
  fun glucoseChanged(previous: AapsGlucoseIdentity?, next: AapsLocalReading): Boolean {
    val identity = AapsGlucoseIdentity.of(next) ?: return false
    return identity != previous
  }

  /**
   * Other statuses stay in the encrypted queue for the next sync, which drains
   * it whatever started it. A due time-based alert check still gets its sync,
   * and the deferral bound keeps stored IOB/COB history moving when glucose
   * stops and no collector timer is running.
   */
  fun requestsSync(
    glucoseChanged: Boolean,
    lastRequestElapsedMs: Long?,
    nowElapsedMs: Long,
    alertCheckAtMs: Long? = null,
    nowWallMs: Long = 0L,
  ): Boolean = glucoseChanged || lastRequestElapsedMs == null ||
    nowElapsedMs - lastRequestElapsedMs >= AAPS_MAX_SYNC_DEFERRAL_MS ||
    (alertCheckAtMs != null && alertCheckAtMs > 0L && nowWallMs >= alertCheckAtMs)

  fun publishGlucose(
    previousTimestamp: Long?, previousMmolL: Double?, previousTrend: String?,
    incomingTimestamp: Long, incomingMmolL: Double, incomingTrend: String,
  ): Boolean = previousTimestamp == null || incomingTimestamp > previousTimestamp ||
    (incomingTimestamp == previousTimestamp &&
      (incomingMmolL != previousMmolL || incomingTrend != previousTrend))
}
