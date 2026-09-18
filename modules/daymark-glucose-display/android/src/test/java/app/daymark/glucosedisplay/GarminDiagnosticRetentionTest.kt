package app.daymark.glucosedisplay

import org.junit.Assert.*
import org.junit.Test

class GarminDiagnosticRetentionTest {
  @Test fun retainsOnlyRecentEventsIncludingBoundaryAndRejectsFutureClock() {
    val now = GarminDiagnosticRetention.MAX_AGE_MS + 100
    val rows = listOf(99L, 100L, now, now + 1).map { GarminDiagnosticEvent(it, GarminDiagnosticKind.RETRY) }
    assertEquals(listOf(100L, now), GarminDiagnosticRetention.prune(rows, now).map { it.at })
  }

  @Test fun boundsJournalToNewestEventsWithoutLosingDeliveryCorrelation() {
    val rows = (1L..3000L).map { GarminDiagnosticEvent(it, GarminDiagnosticKind.SEND_ATTEMPT, 1234, 2) }
    val kept = GarminDiagnosticRetention.prune(rows, 3000)
    assertEquals(2000, kept.size)
    assertEquals(1001L, kept.first().at)
    assertEquals(3000L, kept.last().at)
    assertTrue(kept.all { it.revision == 1234L && it.attempt == 2 })
  }

  @Test fun eventSchemaCannotAcceptFreeTextPayloadsOrIdentifiers() {
    val fields = GarminDiagnosticEvent::class.java.declaredFields.filterNot { it.isSynthetic || java.lang.reflect.Modifier.isStatic(it.modifiers) }
    assertEquals(setOf("at", "kind", "revision", "attempt"), fields.map { it.name }.toSet())
    assertTrue(fields.all { it.type.isPrimitive || it.type == GarminDiagnosticKind::class.java })
  }
}
