package io.github.gregorgregor25.t1arc.glucosedisplay

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GlucoseDisplayPreferenceFenceTest {
  @Test
  fun `disable waits for an ongoing phone publication then durably disables before cancel`() {
    val fence = GlucoseDisplaySurfaceFence()
    val publicationEntered = CountDownLatch(1)
    val releasePublication = CountDownLatch(1)
    val disableStarted = CountDownLatch(1)
    val disableReturned = CountDownLatch(1)
    val enabled = AtomicBoolean(true)
    val notificationVisible = AtomicBoolean(false)
    val events = mutableListOf<String>()

    val publication = thread {
      fence.publishIfEnabled(enabled::get) {
        synchronized(events) { events += "publish:start" }
        publicationEntered.countDown()
        check(releasePublication.await(2, TimeUnit.SECONDS))
        notificationVisible.set(true)
        synchronized(events) { events += "publish:end" }
      }
    }
    assertTrue(publicationEntered.await(2, TimeUnit.SECONDS))

    val disable = thread {
      disableStarted.countDown()
      fence.disable(
        persistDisabledAndAodOff = {
          enabled.set(false)
          synchronized(events) { events += "commit" }
        },
        cancel = {
          notificationVisible.set(false)
          synchronized(events) { events += "cancel" }
        },
      )
      disableReturned.countDown()
    }

    assertTrue(disableStarted.await(2, TimeUnit.SECONDS))
    assertFalse(disableReturned.await(100, TimeUnit.MILLISECONDS))
    releasePublication.countDown()
    publication.join(2_000)
    disable.join(2_000)

    assertFalse(publication.isAlive)
    assertFalse(disable.isAlive)
    assertFalse(notificationVisible.get())
    assertEquals(listOf("publish:start", "publish:end", "commit", "cancel"), events)
    assertFalse(
      fence.publishIfEnabled(enabled::get) {
        notificationVisible.set(true)
      }
    )
  }

  @Test
  fun `failed display preference commit never proceeds to surface cancellation`() {
    val fence = GlucoseDisplaySurfaceFence()
    val cancelled = AtomicBoolean(false)

    val failure =
      runCatching {
        fence.disable(
          persistDisabledAndAodOff = {
            error("Glucose display privacy preferences could not be saved.")
          },
          cancel = { cancelled.set(true) },
        )
      }

    assertTrue(failure.isFailure)
    assertFalse(cancelled.get())
  }

  @Test
  fun `persisted off settings request cleanup after process recreation`() {
    val persisted =
      PersistedGlucoseSurfaceState(
        displayEnabled = false,
        aodDesired = false,
        androidAutoEnabled = false,
        alertMonitoringEnabled = false,
        lockScreenVisible = false,
      )

    // A fresh policy instance models a new Android process with no in-memory
    // notification or overlay ownership state.
    val cleanup = GlucoseSurfaceStartupPolicy.resolve(persisted)

    assertTrue(cleanup.cancelDisplayNotification)
    assertTrue(cleanup.removeAodOverlay)
    assertTrue(cleanup.cancelAndroidAuto)
    assertTrue(cleanup.cancelGlucoseAlerts)
  }

  @Test
  fun `private lock screen cancels orphaned alerts after process recreation`() {
    val cleanup =
      GlucoseSurfaceStartupPolicy.resolve(
        PersistedGlucoseSurfaceState(
          displayEnabled = false,
          aodDesired = false,
          androidAutoEnabled = true,
          alertMonitoringEnabled = true,
          lockScreenVisible = false,
        )
      )

    assertTrue(cleanup.cancelGlucoseAlerts)
  }
}

class GlucoseAlertOwnershipFenceTest {
  @Test
  fun `startup repair cancels alerts when owner remains enabled but lock screen is private`() {
    val fence = GlucoseAlertOwnershipFence()
    val cancelled = AtomicBoolean(false)

    fence.cancelIfUnownedOrPrivate(
      isOwned = { true },
      isLockScreenVisible = { false },
      cancel = { cancelled.set(true) },
    )

    assertTrue(cancelled.get())
  }

  @Test
  fun `fresh startup repairs crash after private commit before public alert cancellation`() {
    val owner = AtomicBoolean(true)
    val lockScreenVisible = AtomicBoolean(true)
    val activeAlert = AtomicReference<String?>("public")

    // Model a process death after the checked private preference commit but
    // before the old process reaches its in-fence notification cancellation.
    lockScreenVisible.set(false)

    val cleanup =
      GlucoseSurfaceStartupPolicy.resolve(
        PersistedGlucoseSurfaceState(
          displayEnabled = false,
          aodDesired = false,
          androidAutoEnabled = true,
          alertMonitoringEnabled = owner.get(),
          lockScreenVisible = lockScreenVisible.get(),
        )
      )
    val restartedFence = GlucoseAlertOwnershipFence()
    if (cleanup.cancelGlucoseAlerts) {
      restartedFence.cancelIfUnownedOrPrivate(
        isOwned = owner::get,
        isLockScreenVisible = lockScreenVisible::get,
        cancel = { activeAlert.set(null) },
      )
    }

    assertTrue(cleanup.cancelGlucoseAlerts)
    assertTrue(owner.get())
    assertFalse(lockScreenVisible.get())
    assertNull(activeAlert.get())
  }

  @Test
  fun `private transition waits for deferred public delivery then cancels it`() {
    val fence = GlucoseAlertOwnershipFence()
    val lockScreenVisible = AtomicBoolean(true)
    val activeAlert = AtomicReference<String?>(null)
    val deliveryEntered = CountDownLatch(1)
    val releaseDelivery = CountDownLatch(1)
    val transitionStarted = CountDownLatch(1)
    val transitionReturned = CountDownLatch(1)

    val delivery = thread {
      fence.notifyIfOwned({ true }) {
        val capturedVisibility = if (lockScreenVisible.get()) "public" else "private"
        deliveryEntered.countDown()
        check(releaseDelivery.await(2, TimeUnit.SECONDS))
        activeAlert.set(capturedVisibility)
      }
    }
    assertTrue(deliveryEntered.await(2, TimeUnit.SECONDS))

    val transition = thread {
      transitionStarted.countDown()
      fence.updateLockScreenVisibility(
        visible = false,
        persist = { lockScreenVisible.set(false) },
        cancelAlertsWhenPrivate = { activeAlert.set(null) },
      )
      transitionReturned.countDown()
    }
    assertTrue(transitionStarted.await(2, TimeUnit.SECONDS))
    assertFalse(transitionReturned.await(100, TimeUnit.MILLISECONDS))

    releaseDelivery.countDown()
    delivery.join(2_000)
    transition.join(2_000)

    assertFalse(delivery.isAlive)
    assertFalse(transition.isAlive)
    assertFalse(lockScreenVisible.get())
    assertNull(activeAlert.get())
  }

  @Test
  fun `alert prepared before private transition posts only a private payload afterward`() {
    val fence = GlucoseAlertOwnershipFence()
    val lockScreenVisible = AtomicBoolean(true)
    val activeAlert = AtomicReference<String?>(null)
    val preparationEntered = CountDownLatch(1)
    val releasePreparation = CountDownLatch(1)

    val delivery = thread {
      preparationEntered.countDown()
      check(releasePreparation.await(2, TimeUnit.SECONDS))
      fence.notifyIfOwned({ true }) {
        activeAlert.set(if (lockScreenVisible.get()) "public" else "private")
      }
    }
    assertTrue(preparationEntered.await(2, TimeUnit.SECONDS))

    fence.updateLockScreenVisibility(
      visible = false,
      persist = { lockScreenVisible.set(false) },
      cancelAlertsWhenPrivate = { activeAlert.set(null) },
    )
    releasePreparation.countDown()
    delivery.join(2_000)

    assertFalse(delivery.isAlive)
    assertEquals("private", activeAlert.get())
  }

  @Test
  fun `test alert prepared before private transition cannot post a public example afterward`() {
    val fence = GlucoseAlertOwnershipFence()
    val lockScreenVisible = AtomicBoolean(true)
    val activeTestAlert = AtomicReference<String?>(null)
    val testPrepared = CountDownLatch(1)
    val releaseTestDelivery = CountDownLatch(1)

    val testDelivery = thread {
      testPrepared.countDown()
      check(releaseTestDelivery.await(2, TimeUnit.SECONDS))
      fence.notifyIfOwned({ true }) {
        activeTestAlert.set(
          if (lockScreenVisible.get()) "public-example" else "private-example"
        )
      }
    }
    assertTrue(testPrepared.await(2, TimeUnit.SECONDS))

    fence.updateLockScreenVisibility(
      visible = false,
      persist = { lockScreenVisible.set(false) },
      cancelAlertsWhenPrivate = { activeTestAlert.set(null) },
    )
    releaseTestDelivery.countDown()
    testDelivery.join(2_000)

    assertFalse(testDelivery.isAlive)
    assertEquals("private-example", activeTestAlert.get())
  }

  @Test
  fun `switching an existing public alert private cancels it after commit`() {
    val fence = GlucoseAlertOwnershipFence()
    val lockScreenVisible = AtomicBoolean(true)
    val activeAlert = AtomicReference<String?>("public")
    val events = mutableListOf<String>()

    fence.updateLockScreenVisibility(
      visible = false,
      persist = {
        lockScreenVisible.set(false)
        events += "commit"
      },
      cancelAlertsWhenPrivate = {
        activeAlert.set(null)
        events += "cancel"
      },
    )

    assertFalse(lockScreenVisible.get())
    assertNull(activeAlert.get())
    assertEquals(listOf("commit", "cancel"), events)
  }

  @Test
  fun `failed lock screen preference commit keeps existing public alert`() {
    val fence = GlucoseAlertOwnershipFence()
    val activeAlert = AtomicReference<String?>("public")
    val cancelled = AtomicBoolean(false)

    val failure =
      runCatching {
        fence.updateLockScreenVisibility(
          visible = false,
          persist = { error("Lock-screen glucose privacy preference could not be saved.") },
          cancelAlertsWhenPrivate = {
            cancelled.set(true)
            activeAlert.set(null)
          },
        )
      }

    assertTrue(failure.isFailure)
    assertFalse(cancelled.get())
    assertEquals("public", activeAlert.get())
  }

  @Test
  fun `deferred production alert cannot post after owner disable returns`() {
    val fence = GlucoseAlertOwnershipFence()
    val owner = AtomicBoolean(true)
    val preparationEntered = CountDownLatch(1)
    val releasePreparation = CountDownLatch(1)
    val posted = AtomicBoolean(false)
    val cancelled = AtomicBoolean(false)

    val staleShow = thread {
      preparationEntered.countDown()
      check(releasePreparation.await(2, TimeUnit.SECONDS))
      fence.notifyIfOwned(owner::get) { posted.set(true) }
    }
    assertTrue(preparationEntered.await(2, TimeUnit.SECONDS))

    fence.updateOwner(
      enabled = false,
      persist = {
        owner.set(false)
        true
      },
      cancel = { cancelled.set(true) },
    )
    releasePreparation.countDown()
    staleShow.join(2_000)

    assertFalse(staleShow.isAlive)
    assertTrue(cancelled.get())
    assertFalse(posted.get())
  }

  @Test
  fun `isolated production show refuses an unowned alert`() {
    val fence = GlucoseAlertOwnershipFence()
    val posted = AtomicBoolean(false)

    assertFalse(fence.notifyIfOwned({ false }) { posted.set(true) })
    assertFalse(posted.get())
  }

  @Test
  fun `failed owner commit does not cancel alerts or change ownership`() {
    val fence = GlucoseAlertOwnershipFence()
    val owner = AtomicBoolean(true)
    val cancelled = AtomicBoolean(false)

    val failure =
      runCatching {
        fence.updateOwner(
          enabled = false,
          persist = { error("Glucose alert monitoring ownership could not be saved.") },
          cancel = { cancelled.set(true) },
        )
      }

    assertTrue(failure.isFailure)
    assertTrue(owner.get())
    assertFalse(cancelled.get())
  }
}
