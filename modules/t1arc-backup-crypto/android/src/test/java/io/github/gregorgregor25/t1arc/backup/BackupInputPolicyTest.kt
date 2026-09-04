package io.github.gregorgregor25.t1arc.backup

import java.io.ByteArrayInputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class BackupInputPolicyTest {
  @Test
  fun unknownDocumentProviderLengthIsAcceptedForBoundedStreaming() {
    validateEncryptedInputLength(
      byteLength = -1L,
      minimumBytesExclusive = 52L,
      maximumBytes = 100L,
    )
  }

  @Test
  fun knownEncryptedLengthsStillFailClosed() {
    assertThrows(IllegalArgumentException::class.java) {
      validateEncryptedInputLength(
        byteLength = 52L,
        minimumBytesExclusive = 52L,
        maximumBytes = 100L,
      )
    }
    assertThrows(IllegalArgumentException::class.java) {
      validateEncryptedInputLength(
        byteLength = 101L,
        minimumBytesExclusive = 52L,
        maximumBytes = 100L,
      )
    }
    validateEncryptedInputLength(
      byteLength = 53L,
      minimumBytesExclusive = 52L,
      maximumBytes = 100L,
    )
  }

  @Test
  fun maximumCreatablePlaintextProducesARestorableEncryptedBoundary() {
    val expectedRawDeflateBound =
      MAX_BACKUP_PLAINTEXT_BYTES +
        (MAX_BACKUP_PLAINTEXT_BYTES shr 12) +
        (MAX_BACKUP_PLAINTEXT_BYTES shr 14) +
        (MAX_BACKUP_PLAINTEXT_BYTES shr 25) +
        7L
    val expectedEncryptedBytes =
      expectedRawDeflateBound +
        10L + // gzip header
        8L + // gzip trailer
        44L + // T1 Arc fixed header, salt and nonce
        16L // AES-GCM tag

    assertEquals(expectedEncryptedBytes, MAX_BACKUP_ENCRYPTED_BYTES)
    validateEncryptedInputLength(
      byteLength = MAX_BACKUP_ENCRYPTED_BYTES,
      minimumBytesExclusive = 52L,
      maximumBytes = MAX_BACKUP_ENCRYPTED_BYTES,
    )
    val error = assertThrows(IllegalArgumentException::class.java) {
      validateEncryptedInputLength(
        byteLength = MAX_BACKUP_ENCRYPTED_BYTES + 1L,
        minimumBytesExclusive = 52L,
        maximumBytes = MAX_BACKUP_ENCRYPTED_BYTES,
      )
    }
    assertEquals(ENCRYPTED_BACKUP_LIMIT_MESSAGE, error.message)
  }

  @Test
  fun unknownLengthStreamCannotReadPastItsEncryptedByteLimit() {
    val source = ByteArrayInputStream(byteArrayOf(1, 2, 3, 4, 5, 6))
    val bounded = MaximumByteInputStream(source, 5L, "too large")
    val accepted = ByteArray(5)

    assertEquals(5, bounded.read(accepted))
    assertArrayEquals(byteArrayOf(1, 2, 3, 4, 5), accepted)
    val error = assertThrows(IllegalArgumentException::class.java) {
      bounded.read()
    }
    assertEquals("too large", error.message)
  }

  @Test
  fun skippingCannotBypassTheEncryptedByteLimit() {
    val source = ByteArrayInputStream(ByteArray(6) { it.toByte() })
    val bounded = MaximumByteInputStream(source, 5L, "too large")

    assertThrows(IllegalArgumentException::class.java) {
      bounded.skip(6)
    }
  }
}
