package io.github.gregorgregor25.t1arc.backup

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class EncryptedDocumentKindTest {
  @Test
  fun backupAndMigrationContainersHaveSeparateFrozenIdentities() {
    val backup = EncryptedDocumentKind.BACKUP
    val migration = EncryptedDocumentKind.MIGRATION

    assertEquals("T1ARCBK1", backup.magicText)
    assertEquals(".t1arc", backup.extension)
    assertEquals("T1ARCMG1", migration.magicText)
    assertEquals(".t1arc-migration", migration.extension)
    assertNotEquals(backup.magicText, migration.magicText)
    assertArrayEquals(
      "T1ARCMG1".toByteArray(Charsets.US_ASCII),
      migration.magic,
    )
  }
}
