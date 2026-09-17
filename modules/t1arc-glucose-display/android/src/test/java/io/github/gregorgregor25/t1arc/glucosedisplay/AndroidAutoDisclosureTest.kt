package io.github.gregorgregor25.t1arc.glucosedisplay

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidAutoDisclosureTest {
  @Test
  fun `disabled display never exposes glucose`() {
    assertFalse(shouldExposeAndroidAutoGlucose(enabled = false, projected = false))
    assertFalse(shouldExposeAndroidAutoGlucose(enabled = false, projected = true))
  }

  @Test
  fun `enabled display remains private outside a projection`() {
    assertFalse(shouldExposeAndroidAutoGlucose(enabled = true, projected = false))
  }

  @Test
  fun `enabled live projection may expose glucose`() {
    assertTrue(shouldExposeAndroidAutoGlucose(enabled = true, projected = true))
  }
}
