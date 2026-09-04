package io.github.gregorgregor25.t1arc.wear.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WearPrivacyEpochTest {
    @Test
    fun `newer clear rejects delayed current and history payloads`() {
        assertTrue(WearPrivacyEpochPolicy.accepts(current = 8L, incoming = 8L))
        assertTrue(WearPrivacyEpochPolicy.accepts(current = 8L, incoming = 9L))
        assertFalse(WearPrivacyEpochPolicy.accepts(current = 8L, incoming = 7L))
        assertTrue(
            WearPrivacyEpochPolicy.transition(8L, 9L) ==
                WearPrivacyEpochPolicy.Transition.ADVANCE_AND_CLEAR_PRIVATE_STATE,
        )
        assertTrue(
            WearPrivacyEpochPolicy.transition(9L, 9L) ==
                WearPrivacyEpochPolicy.Transition.ACCEPT_CURRENT,
        )
    }

    @Test
    fun `explicit epoch zero is accepted only before a privacy epoch advances`() {
        assertTrue(WearPrivacyEpochPolicy.accepts(current = 0L, incoming = 0L))
        assertFalse(WearPrivacyEpochPolicy.accepts(current = 1L, incoming = 0L))
    }

    @Test
    fun `invalid negative payload epoch fails closed`() {
        assertFalse(WearPrivacyEpochPolicy.accepts(current = 0L, incoming = -1L))
    }
}
