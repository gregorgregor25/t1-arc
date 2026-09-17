package io.github.gregorgregor25.t1arc.foodlabel

import java.io.File
import java.io.RandomAccessFile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class FoodLabelImagePolicyTest {
  @get:Rule val temporary = TemporaryFolder()
  private val imageName = "label-01234567-89ab-cdef-0123-456789abcdef.jpg"

  @Test fun acceptsOnlyTheOwnedDirectoryAndCaptureName() {
    val directory = temporary.newFolder(LABEL_IMAGE_DIRECTORY)
    val image = File(directory, imageName).apply { writeBytes(byteArrayOf(1)) }
    assertEquals(image.canonicalFile, ownedLabelImage(temporary.root, image.path))
    val sibling = File(temporary.root, imageName).apply { writeBytes(byteArrayOf(1)) }
    assertThrows(IllegalArgumentException::class.java) { ownedLabelImage(temporary.root, sibling.path) }
    assertThrows(IllegalArgumentException::class.java) {
      ownedLabelImage(temporary.root, File(directory, "../$imageName").path)
    }
    assertTrue(sibling.exists())
  }

  @Test fun rejectsMissingEmptyAndOversizedFiles() {
    val directory = temporary.newFolder(LABEL_IMAGE_DIRECTORY)
    val image = File(directory, imageName)
    assertThrows(IllegalArgumentException::class.java) { ownedLabelImage(temporary.root, image.path) }
    image.createNewFile()
    assertThrows(IllegalArgumentException::class.java) { ownedLabelImage(temporary.root, image.path) }
    RandomAccessFile(image, "rw").use { it.setLength(MAX_LABEL_IMAGE_BYTES + 1) }
    assertThrows(IllegalArgumentException::class.java) { ownedLabelImage(temporary.root, image.path) }
  }

  @Test fun boundsDecodedImageDimensions() {
    assertEquals(1, labelImageSampleSize(1_200, 2_560))
    assertEquals(2, labelImageSampleSize(4_032, 3_024))
    assertEquals(8, labelImageSampleSize(12_000, 8_000))
    assertThrows(IllegalArgumentException::class.java) { labelImageSampleSize(-1, 10) }
    assertThrows(IllegalArgumentException::class.java) { labelImageSampleSize(10, 0) }
  }

  @Test fun crashSweepRemovesOnlyOldOwnedImages() {
    val directory = temporary.newFolder(LABEL_IMAGE_DIRECTORY)
    val now = System.currentTimeMillis()
    val old = File(directory, imageName).apply { writeText("old"); setLastModified(now - 7_200_000) }
    val recent = File(directory, imageName.replace("01234567", "abcdefab")).apply { writeText("in flight") }
    val unrelated = File(directory, "other.jpg").apply { writeText("unrelated"); setLastModified(now - 7_200_000) }
    val camera = File(temporary.newFolder("Camera"), imageName).apply { writeText("other camera use"); setLastModified(now - 7_200_000) }
    clearAbandonedLabelImages(temporary.root, now)
    assertTrue(!old.exists())
    assertTrue(recent.exists())
    assertTrue(unrelated.exists())
    assertTrue(camera.exists())
  }
}
