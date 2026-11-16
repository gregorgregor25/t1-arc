package io.github.gregorgregor25.t1arc.glucosedisplay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Field shapes follow AAPS's xDrip+ sync plugin (DataSyncSelectorXdripImpl). */
class AapsTreatmentPolicyTest {
  private val received = 1_700_000_000_000L
  private val time = received - 5 * 60_000L

  private fun row(vararg fields: Pair<String, Any?>) = mapOf(*fields)
  private fun sanitize(row: Map<String, Any?>) = AapsTreatmentPolicy.sanitizeRow(row, received)

  @Test fun smbKeepsItsAmountTypeAndAStableTimeBasedIdentity() {
    val result = sanitize(row(
      "eventType" to "Correction Bolus", "date" to time, "insulin" to 0.3,
      "type" to "SMB", "isSMB" to true, "isValid" to true,
      "created_at" to "2023-11-14T22:08:20.000Z", "pumpId" to 4_812L,
    ))!!
    assertEquals("bolus-$time", result["identifier"])
    assertEquals(time, result["date"])
    assertEquals(0.3, result["insulin"] as Double, 0.0)
    assertEquals("SMB", result["type"])
    assertEquals(true, result["isSMB"])
    assertEquals(4_812L, result["pumpId"])
    // Only listed fields are kept.
    assertFalse(result.containsKey("created_at"))
  }

  @Test fun anEditOrDeletionKeepsTheSameIdentitySoItReplacesTheEarlierCopy() {
    val first = sanitize(row("eventType" to "Meal Bolus", "date" to time, "insulin" to 4.0))!!
    val withdrawn = sanitize(row("eventType" to "Meal Bolus", "date" to time, "insulin" to 4.0, "isValid" to false))!!
    assertEquals(first["identifier"], withdrawn["identifier"])
    assertEquals(false, withdrawn["isValid"])
  }

  @Test fun carbsAreSeparateFromABolusAtTheSameTimeAndDropTheirMillisecondDuration() {
    val carbs = sanitize(row("eventType" to "Meal Bolus", "date" to time, "carbs" to 45.0, "duration" to 10_800_000L))!!
    val bolus = sanitize(row("eventType" to "Meal Bolus", "date" to time, "insulin" to 4.0))!!
    assertEquals("carbs-$time", carbs["identifier"])
    assertFalse(carbs.containsKey("duration"))
    assertTrue(carbs["identifier"] != bolus["identifier"])
  }

  @Test fun temporaryTargetsUseTheirTimestampFieldAndKeepRecordedUnits() {
    val result = sanitize(row(
      "eventType" to "Temporary Target", "timestamp" to time, "duration" to 60,
      "durationInMilliseconds" to 3_600_000L, "targetBottom" to 7.5, "targetTop" to 7.5,
      "units" to "mmol", "reason" to "Activity",
    ))!!
    assertEquals("temporary-target-$time", result["identifier"])
    assertEquals(60.0, result["duration"] as Double, 0.0)
    assertEquals("mmol", result["units"])
    assertEquals("Activity", result["reason"])
  }

  @Test fun extendedBolusesNeedTheirEnteredTotal() {
    val result = sanitize(row(
      "eventType" to "Combo Bolus", "date" to time, "enteredinsulin" to 2.0,
      "splitNow" to 0, "splitExt" to 100, "duration" to 60, "isEmulatingTempBasal" to false,
    ))!!
    assertEquals("extended-$time", result["identifier"])
    assertNull(sanitize(row("eventType" to "Combo Bolus", "date" to time)))
  }

  @Test fun unsupportedOrImplausibleRecordsAreRejected() {
    assertNull(sanitize(row("eventType" to "Temp Basal", "date" to time, "rate" to 1.0)))
    assertNull(sanitize(row("eventType" to "Note", "date" to time, "notes" to "text")))
    assertNull(sanitize(row("eventType" to "Meal Bolus", "insulin" to 2.0)))
    assertNull(sanitize(row("eventType" to "Meal Bolus", "date" to received + 10 * 60_000L, "insulin" to 2.0)))
    assertNull(sanitize(row("eventType" to "Meal Bolus", "date" to received - 8L * 24 * 60 * 60_000L, "insulin" to 2.0)))
    // An out-of-range amount is dropped, leaving no treatment to record.
    assertNull(sanitize(row("eventType" to "Meal Bolus", "date" to time, "insulin" to 250.0)))
    assertNull(sanitize(row("eventType" to "Meal Bolus", "date" to time, "insulin" to Double.NaN)))
  }

  @Test fun textIsTrimmedAndControlCharactersRemoved() {
    val result = sanitize(row(
      "eventType" to "Site Change", "date" to time, "notes" to "  new site\u0000\n " + "x".repeat(400),
    ))!!
    val notes = result["notes"] as String
    assertTrue(notes.startsWith("new site"))
    assertTrue(notes.length <= 240)
    assertFalse(notes.contains('\u0000'))
  }

  @Test fun broadcastsAreCappedAndCarryTheirSelectionAndEpoch() {
    val rows = (0 until 250).map {
      row("eventType" to "Correction Bolus", "date" to time - it * 1_000L, "insulin" to 0.1)
    }
    var next = 0
    val result = AapsTreatmentPolicy.sanitize(rows, received, 4L, 9L) { "id-${next++}" }
    assertEquals(AapsTreatmentPolicy.MAX_RECORDS_PER_BROADCAST, result.size)
    assertTrue(result.all { it.writeEpoch == 4L && it.selectionGeneration == 9L && it.receivedAt == received })
    assertEquals("id-0", result.first().id)
    assertTrue(AapsTreatmentPolicy.sanitize(rows, received, -1L, 9L).isEmpty())
    assertFalse(AapsTreatmentPolicy.acceptsPayloadLength(0))
    assertFalse(AapsTreatmentPolicy.acceptsPayloadLength(AapsTreatmentPolicy.MAX_PAYLOAD_CHARS + 1))
  }
}
