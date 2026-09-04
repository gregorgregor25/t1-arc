package io.github.gregorgregor25.t1arc.glooko

import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class GlookoCredentialCommitGateTest {
  @Test
  fun activeCommitBlocksCredentialMutationUntilReleased() {
    val token =
      requireNotNull(
        GlookoCredentialCommitGate.beginCommit(7L) { true },
      )
    try {
      try {
        GlookoCredentialCommitGate.mutateCredentials { fail("must not run") }
        fail("An active import token must block credential mutation")
      } catch (_: IllegalStateException) {
        // Expected: saving another account cannot overlap the SQLite commit.
      }
    } finally {
      assertTrue(GlookoCredentialCommitGate.endCommit(token))
    }

    var mutated = false
    GlookoCredentialCommitGate.mutateCredentials { mutated = true }
    assertTrue(mutated)
    assertFalse(GlookoCredentialCommitGate.endCommit(token))
  }

  @Test
  fun staleGenerationCannotAcquireCommitToken() {
    assertNull(
      GlookoCredentialCommitGate.beginCommit(8L) { false },
    )
  }

  @Test
  fun dataResetIsMutuallyExclusiveWithCommitsAndCredentialMutation() {
    val commit =
      requireNotNull(GlookoCredentialCommitGate.beginCommit(9L) { true })
    assertNull(GlookoCredentialCommitGate.beginDataReset())
    assertTrue(GlookoCredentialCommitGate.endCommit(commit))

    val manualCommit = requireNotNull(GlookoCredentialCommitGate.beginDataCommit())
    assertNull(GlookoCredentialCommitGate.beginDataReset())
    assertTrue(GlookoCredentialCommitGate.endCommit(manualCommit))

    val reset = requireNotNull(GlookoCredentialCommitGate.beginDataReset())
    var currentGeneration = 9L
    try {
      assertNull(GlookoCredentialCommitGate.beginCommit(9L) { true })
      assertNull(GlookoCredentialCommitGate.beginDataCommit())
      try {
        GlookoCredentialCommitGate.mutateCredentials { fail("must not run") }
        fail("An active data reset must block credential mutation")
      } catch (_: IllegalStateException) {
        // Expected: account identity cannot change halfway through deletion.
      }
    } finally {
      assertTrue(
        GlookoCredentialCommitGate.finishDataReset(reset) {
          currentGeneration = 10L
        },
      )
    }

    // A pre-reset export remains stale even after the exclusive token ends.
    assertNull(
      GlookoCredentialCommitGate.beginCommit(9L) {
        currentGeneration == 9L
      },
    )
    val afterReset =
      requireNotNull(
        GlookoCredentialCommitGate.beginCommit(10L) {
          currentGeneration == 10L
        },
      )
    assertTrue(GlookoCredentialCommitGate.endCommit(afterReset))
    assertFalse(GlookoCredentialCommitGate.finishDataReset(reset) {})
  }

  @Test
  fun credentialReadFailsClosedDuringDataReset() {
    val reset = requireNotNull(GlookoCredentialCommitGate.beginDataReset())
    try {
      assertNull(GlookoCredentialCommitGate.readCredentials { "secret" })
    } finally {
      assertTrue(GlookoCredentialCommitGate.finishDataReset(reset) {})
    }
    assertTrue(
      GlookoCredentialCommitGate.readCredentials { "secret" } == "secret",
    )
  }
}
