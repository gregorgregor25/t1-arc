package io.github.gregorgregor25.t1arc.glucosedisplay

import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GlucoseSurfaceCopyTest {
  private val now = 1_800_000_000_000L
  private val uk = Locale.UK
  private fun minutesAgo(minutes: Long) = now - minutes * 60_000L

  @Test fun `range words follow the glucose appearance categories`() {
    val appearance = GlucoseAppearance(3.0, 3.9, 10.0, 13.9, "rose", "amber", "green", "orange", "purple", "slate")
    assertEquals("Very low", GlucoseSurfaceCopy.rangeWord(appearance.categoryFor(2.8)))
    assertEquals("Low", GlucoseSurfaceCopy.rangeWord(appearance.categoryFor(3.6)))
    assertEquals("In range", GlucoseSurfaceCopy.rangeWord(appearance.categoryFor(6.8)))
    assertEquals("High", GlucoseSurfaceCopy.rangeWord(appearance.categoryFor(11.0)))
    assertEquals("Very high", GlucoseSurfaceCopy.rangeWord(appearance.categoryFor(15.0)))
  }

  @Test fun `only current or delayed low readings get the low fill`() {
    assertTrue(GlucoseSurfaceCopy.lowEmphasis("low", DisplayFreshness.CURRENT))
    assertTrue(GlucoseSurfaceCopy.lowEmphasis("veryLow", DisplayFreshness.DELAYED))
    assertFalse(GlucoseSurfaceCopy.lowEmphasis("low", DisplayFreshness.STALE))
    assertFalse(GlucoseSurfaceCopy.lowEmphasis("veryLow", DisplayFreshness.MISSING))
    assertFalse(GlucoseSurfaceCopy.lowEmphasis("target", DisplayFreshness.CURRENT))
    assertFalse(GlucoseSurfaceCopy.lowEmphasis("high", DisplayFreshness.CURRENT))
  }

  @Test fun `collapsed notification line is age, range word and on-board estimate`() {
    val age = GlucoseSurfaceCopy.age(minutesAgo(2), now, uk)
    assertEquals("2 min ago · In range · IOB 1.20 U · COB 18 g",
      GlucoseSurfaceCopy.readingLine(age, DisplayFreshness.CURRENT, "In range", "IOB 1.20 U · COB 18 g"))
    assertEquals("2 min ago · Low", GlucoseSurfaceCopy.readingLine(age, DisplayFreshness.CURRENT, "Low", null))
    assertEquals("Delayed · 8 min ago · High",
      GlucoseSurfaceCopy.readingLine(GlucoseSurfaceCopy.age(minutesAgo(8), now, uk), DisplayFreshness.DELAYED, "High", null))
  }

  @Test fun `titles keep direction words and calculated marking`() {
    assertEquals(" ↘ Falling slowly", GlucoseSurfaceCopy.directionSuffix("↘", "Falling slowly", calculated = false))
    assertEquals(" ↘ Falling slowly (calculated)", GlucoseSurfaceCopy.directionSuffix("↘", "Falling slowly", calculated = true))
    assertEquals(" mmol/L ↘ Falling slowly", GlucoseSurfaceCopy.directionSuffix("↘", "Falling slowly", false, "mmol/L"))
  }

  @Test fun `expanded summary names age and source, then on-board detail`() {
    assertEquals("2 min ago · from AAPS · IOB 1.20 U · COB 18 g · Calculated by AAPS",
      GlucoseSurfaceCopy.expandedSummary("2 min ago", DisplayFreshness.CURRENT, "AAPS",
        "IOB 1.20 U · COB 18 g", "Calculated by AAPS"))
    assertEquals("Just now", GlucoseSurfaceCopy.expandedSummary("Just now", DisplayFreshness.CURRENT, null, null, null))
    // Provenance never appears without an estimate.
    assertEquals("Delayed · 7 min ago · from Nightscout",
      GlucoseSurfaceCopy.expandedSummary("7 min ago", DisplayFreshness.DELAYED, "Nightscout", null, "Calculated"))
  }

  @Test fun `ages and durations read plainly with regional digits`() {
    assertEquals("Just now", GlucoseSurfaceCopy.age(now - 30_000L, now, uk))
    assertEquals("Just now", GlucoseSurfaceCopy.age(now + 60_000L, now, uk))
    assertEquals("1 min ago", GlucoseSurfaceCopy.age(minutesAgo(1), now, uk))
    assertEquals("1 hr 5 min ago", GlucoseSurfaceCopy.age(minutesAgo(65), now, uk))
    assertEquals("2 hr", GlucoseSurfaceCopy.duration(120, uk))
    assertEquals("1 day", GlucoseSurfaceCopy.duration(24 * 60 + 5, uk))
    assertEquals("3 days", GlucoseSurfaceCopy.duration(3 * 24 * 60, uk))
    assertEquals("0 min", GlucoseSurfaceCopy.duration(-5, uk))
    assertEquals("١٢ min", GlucoseSurfaceCopy.duration(12, Locale.forLanguageTag("ar-EG")))
  }

  @Test fun `stale copy says how long and strikes only the last known value`() {
    assertEquals("No new reading for 26 min", GlucoseSurfaceCopy.staleTitle(minutesAgo(26), now, uk))
    assertEquals("No new reading for 1 hr 30 min", GlucoseSurfaceCopy.staleTitle(minutesAgo(90), now, uk))
    assertEquals("Reading time is ahead of this phone's clock",
      GlucoseSurfaceCopy.staleTitle(now + 3 * 60_000L, now, uk))
    val line = GlucoseSurfaceCopy.staleLine("7.1", "08:14", "AAPS")
    assertEquals("Last known 7.1 at 08:14 · tap to check AAPS", line.text)
    assertEquals("7.1", line.text.substring(line.struckStart, line.struckEnd))
    assertEquals("Last known 126 at 08:14 · tap to check your glucose source",
      GlucoseSurfaceCopy.staleLine("126", "08:14", null).text)
  }

  @Test fun `waiting notification names the selected source, never assuming LibreLinkUp`() {
    val aaps = GlucoseSurfaceCopy.waiting(GlucoseSurfaceCopy.selectedSourceName(AAPS_SOURCE_ID))
    assertEquals("Waiting for a glucose reading", aaps.title)
    assertEquals("T1 Arc is waiting for a reading from AAPS.", aaps.text)
    assertTrue(aaps.bigText.startsWith(aaps.text))
    listOf(null, "none", "something-new").forEach { id ->
      val neutral = GlucoseSurfaceCopy.waiting(GlucoseSurfaceCopy.selectedSourceName(id))
      assertEquals("T1 Arc is waiting for a reading from your glucose source.", neutral.text)
      assertFalse(neutral.bigText.contains("LibreLinkUp"))
    }
    assertEquals("LibreLinkUp", GlucoseSurfaceCopy.selectedSourceName("t1arc-librelinkup"))
    assertEquals("Nightscout", GlucoseSurfaceCopy.selectedSourceName("nightscout"))
    assertEquals("Dexcom Share", GlucoseSurfaceCopy.selectedSourceName("dexcom-share"))
    assertEquals("Medtrum EasyFollow", GlucoseSurfaceCopy.selectedSourceName("medtrum-easyfollow"))
    assertEquals("xDrip", GlucoseSurfaceCopy.selectedSourceName("xdrip-local"))
    assertEquals("your glucose app's notifications", GlucoseSurfaceCopy.selectedSourceName("android-notification"))
  }

  @Test fun `reading source labels become short names and generic labels stay neutral`() {
    assertEquals("AAPS", GlucoseSurfaceCopy.readingSourceName("AndroidAPS local"))
    assertEquals("LibreLinkUp", GlucoseSurfaceCopy.readingSourceName("T1 Arc direct LibreLinkUp"))
    assertEquals("xDrip", GlucoseSurfaceCopy.readingSourceName("xDrip or compatible app"))
    assertEquals("Dexcom Share", GlucoseSurfaceCopy.readingSourceName("Dexcom Share"))
    assertNull(GlucoseSurfaceCopy.readingSourceName("Personal glucose source"))
    assertNull(GlucoseSurfaceCopy.readingSourceName("Saved glucose"))
    assertNull(GlucoseSurfaceCopy.readingSourceName("  "))
    assertNull(GlucoseSurfaceCopy.readingSourceName(null))
  }

  @Test fun `monitoring text names the source but never a reading`() {
    assertEquals("Your chosen alerts are being checked on this phone with readings from AAPS.",
      GlucoseSurfaceCopy.monitoringText(true, "AAPS"))
    assertEquals("Your chosen alerts are being checked on this phone.", GlucoseSurfaceCopy.monitoringText(true, null))
    assertEquals("Your home screen glucose widget is being kept up to date from Nightscout.",
      GlucoseSurfaceCopy.monitoringText(false, "Nightscout"))
    assertEquals("Your home screen glucose widget is being kept up to date.", GlucoseSurfaceCopy.monitoringText(false, null))
  }

  @Test fun `lock screen version never carries a value or on-board estimate`() {
    DisplayFreshness.values().forEach { freshness ->
      val copy = GlucoseSurfaceCopy.redacted(freshness)
      val all = copy.title + " " + copy.text
      assertFalse(all.any(Char::isDigit))
      assertFalse(all.contains("IOB") || all.contains("COB") || all.contains("mmol") || all.contains("mg/dL"))
    }
    assertEquals("Fresh glucose reading", GlucoseSurfaceCopy.redacted(DisplayFreshness.CURRENT).title)
    assertEquals("Unlock to see it", GlucoseSurfaceCopy.redacted(DisplayFreshness.CURRENT).text)
  }

  @Test fun `actions keep Log food and rename Log context to Log something`() {
    assertEquals("Log food", GlucoseSurfaceCopy.LOG_FOOD_ACTION)
    assertEquals("Log something", GlucoseSurfaceCopy.LOG_SOMETHING_ACTION)
  }

  @Test fun `small widget status adds the low word next to the age`() {
    assertEquals("2 min ago", GlucoseSurfaceCopy.compactStatus(DisplayFreshness.CURRENT, "2 min ago", null))
    assertEquals("Low · 1 min ago", GlucoseSurfaceCopy.compactStatus(DisplayFreshness.CURRENT, "1 min ago", "Low"))
    assertEquals("Very low · Delayed · 7 min ago",
      GlucoseSurfaceCopy.compactStatus(DisplayFreshness.DELAYED, "7 min ago", "Very low"))
    assertEquals("Delayed · 7 min ago", GlucoseSurfaceCopy.compactStatus(DisplayFreshness.DELAYED, "7 min ago", null))
    assertEquals("Last known · 26 min ago", GlucoseSurfaceCopy.compactStatus(DisplayFreshness.STALE, "26 min ago", null))
  }

  @Test fun `medium widget lines add direction and range words`() {
    assertEquals(WidgetLines("↘ Gently falling", "In range · 2 min ago"),
      GlucoseSurfaceCopy.mediumLines("↘", "Gently falling", "In range", false, "2 min ago",
        DisplayFreshness.CURRENT, "08:39", null))
    assertEquals(WidgetLines("↓ Falling · Low", "1 min ago"),
      GlucoseSurfaceCopy.mediumLines("↓", "Falling", "Low", true, "1 min ago", DisplayFreshness.CURRENT, "08:39", null))
    assertEquals(WidgetLines("→ Steady", "Delayed · High · 8 min ago"),
      GlucoseSurfaceCopy.mediumLines("→", "Steady", "High", false, "8 min ago", DisplayFreshness.DELAYED, "08:39", null))
    assertEquals(WidgetLines("No new reading", "Last known at 08:14 · 26 min"),
      GlucoseSurfaceCopy.mediumLines("↘", "Gently falling", "In range", false, "26 min ago",
        DisplayFreshness.STALE, "08:14", "26 min"))
    assertEquals(WidgetLines("No new reading", "Last known at 08:14"),
      GlucoseSurfaceCopy.mediumLines("↘", "Gently falling", "In range", false, "Just now",
        DisplayFreshness.STALE, "08:14", null))
  }

  @Test fun `widget descriptions speak the range word and stale state`() {
    assertEquals(
      "Current glucose 6.8 millimoles per litre, Gently falling, in range. Current, updated 2 min ago. " +
        "Insulin on board 1.20 units. Calculated by AAPS.",
      GlucoseSurfaceCopy.widgetDescription("6.8", "millimoles per litre", "Gently falling", "In range",
        DisplayFreshness.CURRENT, "2 min ago", "Insulin on board 1.20 units. Calculated by AAPS."))
    assertEquals(
      "Last known glucose 7.1 millimoles per litre, shown struck through because it is stale. Updated 26 min ago.",
      GlucoseSurfaceCopy.widgetDescription("7.1", "millimoles per litre", "Steady", "In range",
        DisplayFreshness.STALE, "26 min ago", null))
    assertEquals("Current glucose 65 milligrams per decilitre, Falling, very low. Delayed, updated 7 min ago.",
      GlucoseSurfaceCopy.widgetDescription("65", "milligrams per decilitre", "Falling", "Very low",
        DisplayFreshness.DELAYED, "7 min ago", null))
  }
}
