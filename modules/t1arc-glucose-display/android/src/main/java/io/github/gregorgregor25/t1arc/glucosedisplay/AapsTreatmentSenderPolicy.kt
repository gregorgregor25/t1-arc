package io.github.gregorgregor25.t1arc.glucosedisplay

/**
 * Package names AAPS is published under. Android names the sender of a
 * broadcast only from Android 14, and only when the sender opts in to share
 * its identity, which AAPS's xDrip+ sync plugin does not do.
 */
internal val AAPS_TREATMENT_SENDER_PACKAGES: Set<String> = setOf("info.nightscout.androidaps")

internal enum class AapsTreatmentSenderDecision {
  /** Android named the sender, and it was AAPS. */
  ACCEPT_VERIFIED,
  /** Android did not name the sender; accepted only because the user opted in. */
  ACCEPT_UNVERIFIED,
  REJECT,
}

/**
 * Decides whether to accept one xDrip+ treatment broadcast. Pure Kotlin with
 * no Android types, so it runs in JVM unit tests.
 *
 * The receiver needs no permission and AAPS does not support an
 * authenticated local channel, so this route is opt-in and off by default.
 * A sender Android names that is not AAPS is always rejected, even with the
 * switch on.
 */
internal object AapsTreatmentSenderPolicy {
  /**
   * @param senderPackages packages Android names for the sending app, or null
   *   when Android does not supply the sender's identity. An empty collection
   *   means Android named a sender whose packages could not be found.
   * @param localRouteEnabled the user's opt-in switch on the AAPS card.
   */
  fun decide(
    senderPackages: Collection<String>?,
    localRouteEnabled: Boolean,
  ): AapsTreatmentSenderDecision = when {
    !localRouteEnabled -> AapsTreatmentSenderDecision.REJECT
    senderPackages == null -> AapsTreatmentSenderDecision.ACCEPT_UNVERIFIED
    senderPackages.any { it in AAPS_TREATMENT_SENDER_PACKAGES } -> AapsTreatmentSenderDecision.ACCEPT_VERIFIED
    else -> AapsTreatmentSenderDecision.REJECT
  }

  /**
   * Android reports an unavailable identity as a negative UID (-1, INVALID_UID)
   * and has no sender API before Android 14 (API 34).
   */
  fun senderIdentityAvailable(sdkInt: Int, sentFromUid: Int): Boolean = sdkInt >= 34 && sentFromUid >= 0
}
