package io.github.gregorgregor25.t1arc.glucosedisplay

import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GlucoseOnBoardEstimateTest {
  private val now = 1_793_000_000_000L
  private val uk = Locale.UK

  private fun estimate(
    iob: Double? = 1.35,
    cob: Double? = 20.0,
    ageMs: Long = 2 * 60_000L,
    provenance: OnBoardProvenance = OnBoardProvenance.AAPS,
  ) = requireNotNull(OnBoardEstimatePolicy.validated(iob, cob, now - ageMs, provenance, 3L, 7L))

  @Test fun `formats IOB with two decimals and COB in whole grams`() {
    val text = requireNotNull(OnBoardEstimatePolicy.present(estimate(), now, uk))
    assertEquals("IOB 1.35 U · COB 20 g", text.compact)
    assertFalse(text.stale)
    assertEquals("Calculated by AAPS", text.detail)
    assertEquals("Insulin on board 1.35 units, carbs on board 20 grams. Calculated by AAPS.", text.spoken)
  }

  @Test fun `negative IOB and zero COB are values, not missing`() {
    val text = requireNotNull(OnBoardEstimatePolicy.present(estimate(iob = -0.4, cob = 0.0), now, uk))
    assertEquals("IOB -0.40 U · COB 0 g", text.compact)
  }

  @Test fun `a tiny negative IOB rounds to zero without a minus sign`() {
    assertEquals("0.00", OnBoardEstimatePolicy.formatIob(-0.004, uk))
    assertEquals("-0.01", OnBoardEstimatePolicy.formatIob(-0.006, uk))
  }

  @Test fun `regional decimal separator is used`() {
    val text = requireNotNull(OnBoardEstimatePolicy.present(estimate(), now, Locale.forLanguageTag("de-DE")))
    assertEquals("IOB 1,35 U · COB 20 g", text.compact)
  }

  @Test fun `a missing value is left out rather than shown as zero`() {
    assertEquals("IOB 1.35 U",
      OnBoardEstimatePolicy.present(estimate(cob = null), now, uk)?.compact)
    assertEquals("COB 20 g",
      OnBoardEstimatePolicy.present(estimate(iob = null), now, uk)?.compact)
    assertNull(OnBoardEstimatePolicy.validated(null, null, now, OnBoardProvenance.AAPS, 3L, 7L))
  }

  @Test fun `implausible or non-finite values are dropped`() {
    assertNull(OnBoardEstimatePolicy.validated(Double.NaN, -1.0, now, OnBoardProvenance.AAPS, 3L, 7L))
    assertNull(OnBoardEstimatePolicy.validated(250.0, 5_000.0, now, OnBoardProvenance.AAPS, 3L, 7L))
    val partial = OnBoardEstimatePolicy.validated(Double.POSITIVE_INFINITY, 12.0, now, OnBoardProvenance.AAPS, 3L, 7L)
    assertEquals(null, partial?.iobUnits)
    assertEquals(12.0, partial?.cobGrams)
    assertNull(OnBoardEstimatePolicy.validated(1.0, 1.0, 0L, OnBoardProvenance.AAPS, 3L, 7L))
  }

  @Test fun `stale estimates show their own age`() {
    val text = requireNotNull(OnBoardEstimatePolicy.present(estimate(ageMs = 25 * 60_000L), now, uk))
    assertTrue(text.stale)
    assertEquals("IOB 1.35 U · COB 20 g · 25 min ago", text.compact)
    assertTrue(text.spoken.contains("estimated 25 min ago"))
    val boundary = requireNotNull(OnBoardEstimatePolicy.present(estimate(ageMs = 12 * 60_000L), now, uk))
    assertFalse(boundary.stale)
  }

  @Test fun `very old or future-dated estimates are not shown`() {
    assertNotNull(OnBoardEstimatePolicy.present(estimate(ageMs = 60 * 60_000L), now, uk))
    assertNull(OnBoardEstimatePolicy.present(estimate(ageMs = 60 * 60_000L + 1), now, uk))
    assertNotNull(OnBoardEstimatePolicy.present(estimate(ageMs = -2 * 60_000L), now, uk))
    assertNull(OnBoardEstimatePolicy.present(estimate(ageMs = -3 * 60_000L), now, uk))
  }

  @Test fun `lock-screen public version is hidden whenever glucose is hidden`() {
    assertFalse(OnBoardEstimatePolicy.visibleOn(OnBoardSurface.LOCK_SCREEN_PUBLIC_VERSION, true, false))
    assertTrue(OnBoardEstimatePolicy.visibleOn(OnBoardSurface.LOCK_SCREEN_PUBLIC_VERSION, true, true))
    assertTrue(OnBoardEstimatePolicy.visibleOn(OnBoardSurface.NOTIFICATION, true, false))
    assertTrue(OnBoardEstimatePolicy.visibleOn(OnBoardSurface.WIDGET, true, false))
  }

  @Test fun `the display setting hides estimates on every surface`() {
    OnBoardSurface.values().forEach { surface ->
      assertFalse(OnBoardEstimatePolicy.visibleOn(surface, false, true))
    }
  }

  @Test fun `estimates appear only beside glucose from the same source, epoch and selection`() {
    val aaps = estimate()
    assertTrue(OnBoardEstimatePolicy.appliesTo(aaps, "AndroidAPS local", 3L, 7L))
    assertFalse(OnBoardEstimatePolicy.appliesTo(aaps, "Nightscout", 3L, 7L))
    assertFalse(OnBoardEstimatePolicy.appliesTo(aaps, null, 3L, 7L))
    assertFalse(OnBoardEstimatePolicy.appliesTo(aaps, "AndroidAPS local", 4L, 7L))
    assertFalse(OnBoardEstimatePolicy.appliesTo(aaps, "AndroidAPS local", 3L, 8L))
    val nightscout = estimate(provenance = OnBoardProvenance.NIGHTSCOUT)
    assertTrue(OnBoardEstimatePolicy.appliesTo(nightscout, "Nightscout", 3L, 7L))
    assertFalse(OnBoardEstimatePolicy.appliesTo(nightscout, "T1 Arc direct LibreLinkUp", 3L, 7L))
  }

  @Test fun `Nightscout provenance wording`() {
    val text = requireNotNull(OnBoardEstimatePolicy.present(
      estimate(provenance = OnBoardProvenance.NIGHTSCOUT), now, uk))
    assertEquals("Calculated by your looping system via Nightscout", text.detail)
  }

  @Test fun `AAPS status keeps zero COB and returns nothing without estimates`() {
    val withEstimates = AapsLocalReading(id = "a", receivedAt = now, writeEpoch = 3L,
      selectionGeneration = 7L, iobUnits = -0.25, cobGrams = 0.0)
    val parsed = requireNotNull(OnBoardEstimatePolicy.fromAaps(withEstimates))
    assertEquals(-0.25, parsed.iobUnits)
    assertEquals(0.0, parsed.cobGrams)
    assertEquals(OnBoardProvenance.AAPS, parsed.provenance)
    assertEquals(now, parsed.receivedAtMs)
    val glucoseOnly = AapsLocalReading(id = "b", receivedAt = now, writeEpoch = 3L,
      selectionGeneration = 7L, glucoseMgdl = 120.0, glucoseTimestamp = now)
    assertNull(OnBoardEstimatePolicy.fromAaps(glucoseOnly))
  }

  @Test fun `bridge accepts only Nightscout estimates with an exact timestamp`() {
    val valid = mapOf<String, Any?>("provenance" to "nightscout", "iobUnits" to 0.8,
      "cobGrams" to 0, "receivedAt" to (now - 60_000L).toDouble())
    val parsed = requireNotNull(OnBoardEstimatePolicy.fromBridge(valid, 3L, 7L))
    assertEquals(OnBoardProvenance.NIGHTSCOUT, parsed.provenance)
    assertEquals(0.0, parsed.cobGrams)
    assertEquals(now - 60_000L, parsed.receivedAtMs)
    assertNull(OnBoardEstimatePolicy.fromBridge(valid + ("provenance" to "aaps"), 3L, 7L))
    assertNull(OnBoardEstimatePolicy.fromBridge(valid + ("receivedAt" to 1.5), 3L, 7L))
    assertNull(OnBoardEstimatePolicy.fromBridge(valid - "receivedAt", 3L, 7L))
    assertNull(OnBoardEstimatePolicy.fromBridge(
      mapOf("provenance" to "nightscout", "receivedAt" to now.toDouble()), 3L, 7L))
  }
}
