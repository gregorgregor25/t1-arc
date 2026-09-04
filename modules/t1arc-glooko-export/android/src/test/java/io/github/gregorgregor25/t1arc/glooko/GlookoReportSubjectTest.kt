package io.github.gregorgregor25.t1arc.glooko

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class GlookoReportSubjectTest {
  @Test
  fun extractsAndNormalisesTheReportHeaderIdentity() {
    assertEquals(
      "gregor scott|apr 29, 1985",
      glookoReportSubject(
        " Gregor   Scott     DOB: Apr 29, 1985                  BG Summary\n",
      ),
    )
  }

  @Test
  fun acceptsDayFirstDobAndRejectsAReportWithoutIdentity() {
    assertEquals(
      "example person|29 apr 1985",
      glookoReportSubject("Example Person DOB: 29 Apr 1985\nDaily Overview"),
    )
    assertNull(glookoReportSubject("Daily Overview\nNo patient header"))
  }
}
