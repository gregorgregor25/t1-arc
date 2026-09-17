package io.github.gregorgregor25.t1arc.glucosedisplay

import org.junit.Assert.assertEquals
import org.junit.Test

class T1ArcAppLinksTest {
  @Test
  fun `native actions emit canonical T1 Arc links`() {
    val links =
      listOf(
        T1ArcAppLinks.TODAY,
        T1ArcAppLinks.LOG_FOOD,
        T1ArcAppLinks.LOG_CONTEXT,
        T1ArcAppLinks.INSIGHTS,
        T1ArcAppLinks.SOURCES,
      )

    assertEquals(
      listOf(
        "t1arc://today",
        "t1arc://today/log-food",
        "t1arc://today/log-context",
        "t1arc://insights",
        "t1arc://sources",
      ),
      links,
    )
  }
}
