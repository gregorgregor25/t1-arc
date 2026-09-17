package io.github.gregorgregor25.t1arc.wear.data

/** Rejects delayed phone payloads after the watch has observed a privacy clear. */
internal object WearPrivacyEpochPolicy {
    enum class Transition {
        REJECT,
        ACCEPT_CURRENT,
        ADVANCE_AND_CLEAR_PRIVATE_STATE,
    }

    fun validIncomingEpoch(incoming: Long): Long? =
        incoming.takeIf { it >= 0L }

    fun accepts(current: Long, incoming: Long): Boolean {
        return transition(current, incoming) != Transition.REJECT
    }

    fun transition(current: Long, incoming: Long): Transition {
        val resolved = validIncomingEpoch(incoming)
            ?: return Transition.REJECT
        if (current < 0L || resolved < current) return Transition.REJECT
        return if (resolved == current) {
            Transition.ACCEPT_CURRENT
        } else {
            Transition.ADVANCE_AND_CLEAR_PRIVATE_STATE
        }
    }
}
