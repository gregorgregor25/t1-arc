package io.github.gregorgregor25.t1arc.glucosedisplay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertNotNull
import org.junit.Test

class AapsBroadcastParserTest {
  private val timestamp = 1_700_000_000_000L
  private val received = timestamp + 60_000L
  private val glucose = mapOf<String, Any?>(
    "glucoseMgdl" to 122.0,
    "glucoseTimeStamp" to timestamp,
    "slopeArrow" to "FortyFiveUp",
    "units" to "mmol",
  )

  private fun parse(fields: Map<String, Any?>) =
    AapsBroadcastParser.parseFields(fields, received, 2L, 3L)

  @Test fun exactDevBuildFieldsPreserveUnitsTimestampTrendAndSignedContext() {
    val result = parse(glucose + mapOf(
      "deltaMgdl" to 6.0, "avgDeltaMgdl" to 2.5,
      "iob" to -0.25, "bolusIob" to 0.1, "basalIob" to -0.35,
      "cob" to 0.0, "futureCarbs" to 4.0,
    ))!!
    assertEquals(122.0, result.glucoseMgdl!!, 0.0)
    assertEquals(timestamp, result.glucoseTimestamp)
    assertEquals("slightUp", result.trend)
    assertEquals("FortyFiveUp", result.rawTrend)
    assertEquals("mmol", result.displayUnits)
    assertEquals(-0.25, result.iobUnits!!, 0.0)
    assertEquals(0.0, result.cobGrams!!, 0.0)
    assertEquals(4.0, result.futureCarbsGrams!!, 0.0)
  }

  @Test fun allSourceArrowCategoriesRetainTheirDistinctWireMeaning() {
    val arrows = mapOf("TripleDown" to "tripleDown", "DoubleDown" to "doubleDown",
      "SingleDown" to "down", "FortyFiveDown" to "slightDown", "Flat" to "flat",
      "FortyFiveUp" to "slightUp", "SingleUp" to "up", "DoubleUp" to "doubleUp",
      "TripleUp" to "tripleUp")
    for ((wire, direction) in arrows) {
      val result = parse(glucose + ("slopeArrow" to wire))!!
      assertEquals(wire, result.rawTrend)
      assertEquals(direction, result.trend)
    }
  }

  @Test fun noneArrowUsesTheAapsScreenCalculationFromDelta() {
    val none = glucose + ("slopeArrow" to "NONE")
    assertEquals("flat", parse(none + ("deltaMgdl" to 0.0))!!.trend)
    assertEquals("NONE", parse(none + ("deltaMgdl" to 0.0))!!.rawTrend)
    assertEquals("slightUp", parse(none + ("deltaMgdl" to 7.0))!!.trend)
    assertEquals("down", parse(none + ("deltaMgdl" to -12.0))!!.trend)
    assertNull(parse(mapOf("iob" to 0.5, "deltaMgdl" to 7.0))!!.trend)
  }

  @Test fun aapsScreenThresholdsMatchTrendCalculatorBoundaries() {
    val cases = listOf(-17.5 to "doubleDown", -17.4 to "down", -10.0 to "down",
      -9.9 to "slightDown", -5.0 to "slightDown", -4.9 to "flat", 5.0 to "flat",
      5.1 to "slightUp", 10.0 to "slightUp", 10.1 to "up", 17.5 to "up",
      17.6 to "doubleUp", 200.0 to "doubleUp")
    for ((delta, direction) in cases) {
      assertEquals("delta $delta", direction, AapsBroadcastParser.directionFromAapsDelta(delta))
    }
  }

  @Test fun deltaWinsOverAStaleBroadcastArrowLikeTheAapsScreen() {
    val result = parse(glucose + mapOf("slopeArrow" to "SingleUp", "deltaMgdl" to -6.0))!!
    assertEquals("slightDown", result.trend)
    assertEquals("SingleUp", result.rawTrend)
  }

  @Test fun missingAndUnknownTrendsDoNotInventAnArrow() {
    val none = parse(glucose + ("slopeArrow" to "NONE"))!!
    assertNull(none.trend)
    assertEquals("NONE", none.rawTrend)
    assertNull(parse(glucose - "slopeArrow")!!.trend)
    assertNull(parse(glucose + ("slopeArrow" to "not-an-arrow"))!!.trend)
  }

  @Test fun unavailableCobIsDifferentFromZeroAndFieldsCanBeAbsent() {
    val unavailable = parse(mapOf("iob" to -0.1, "cob" to -1.0))!!
    assertNull(unavailable.cobGrams)
    assertNull(unavailable.glucoseMgdl)
    val zero = parse(mapOf("iob" to 0.0, "cob" to 0.0))!!
    assertEquals(0.0, zero.cobGrams!!, 0.0)
    assertNotNull(zero.iobUnits)
  }

  @Test fun invalidGlucoseDoesNotBecomeAReading() {
    assertNull(parse(glucose + ("glucoseMgdl" to Double.NaN)))
    assertNull(parse(glucose + ("glucoseMgdl" to Double.POSITIVE_INFINITY)))
    assertNull(parse(glucose + ("glucoseMgdl" to "122")))
    assertNull(parse(glucose + ("glucoseTimeStamp" to 1_700_000_000_000.5)))
    assertNull(parse(glucose + ("glucoseTimeStamp" to 1_500_000_000_000L)))
    assertNull(parse(glucose + ("glucoseTimeStamp" to received + 120_001L)))
    assertNull(parse(glucose + ("glucoseMgdl" to 8.0)))
  }

  @Test fun invalidContextDoesNotBecomeZero() {
    assertNull(parse(mapOf("iob" to Double.NaN, "cob" to -1.0)))
    assertNull(parse(mapOf("iob" to "0.5", "cob" to -1.0)))
    assertNull(parse(mapOf("iob" to 101.0, "cob" to -1.0)))
    assertNull(parse(mapOf("cob" to Double.POSITIVE_INFINITY)))
  }
}
