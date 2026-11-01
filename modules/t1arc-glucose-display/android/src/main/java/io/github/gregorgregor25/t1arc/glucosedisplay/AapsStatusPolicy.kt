package io.github.gregorgregor25.t1arc.glucosedisplay

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

  fun publishGlucose(
    previousTimestamp: Long?, previousMmolL: Double?, previousTrend: String?,
    incomingTimestamp: Long, incomingMmolL: Double, incomingTrend: String,
  ): Boolean = previousTimestamp == null || incomingTimestamp > previousTimestamp ||
    (incomingTimestamp == previousTimestamp &&
      (incomingMmolL != previousMmolL || incomingTrend != previousTrend))
}
