package io.github.gregorgregor25.t1arc.communityreminder

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateNoticeVersionTest {
  @Test fun acceptsOnlyPlainPublicVersions() {
    assertTrue(UpdateNotice.isPublicVersion("1.7.22"))
    assertTrue(UpdateNotice.isPublicVersion("12.0.1000"))
    assertFalse(UpdateNotice.isPublicVersion("1.7.21-aaps.4"))
    assertFalse(UpdateNotice.isPublicVersion("1.7"))
    assertFalse(UpdateNotice.isPublicVersion(""))
    assertFalse(UpdateNotice.isPublicVersion("v1.7.22"))
    assertFalse(UpdateNotice.isPublicVersion("1.7.22\nInstall now"))
    assertFalse(UpdateNotice.isPublicVersion("1.7.22 "))
  }

  @Test fun namesTheVersionInTheTitle() {
    assertEquals("T1 Arc 1.7.22 is available", UpdateNotice.title("1.7.22"))
  }
}
