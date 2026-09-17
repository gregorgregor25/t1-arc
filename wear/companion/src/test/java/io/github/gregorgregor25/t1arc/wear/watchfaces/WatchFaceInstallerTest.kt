package io.github.gregorgregor25.t1arc.wear.watchfaces

import io.github.gregorgregor25.t1arc.watchfaces.WatchFaceProtocol
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CompletableFuture

class WatchFaceInstallerTest {
    private val face = BundledFace("pace", "example.app.watchfacepush.pace", 2, "new", "pace.apk", "hash", "token")
    private val slot = FaceSlot("fresh-slot", face.packageName, 2, "new")

    private class FakeBackend : FaceBackend {
        var slots = FaceSlots(emptyList(), 1)
        var active = false
        var adds = 0
        var updates = 0
        var activations = 0
        var updatedSlot: String? = null
        var pending: CompletableFuture<FaceSlot>? = null
        var failure: Throwable? = null
        override fun list() = CompletableFuture.completedFuture(slots)
        override fun isActive(packageName: String) = CompletableFuture.completedFuture(active)
        override fun add(face: BundledFace): CompletableFuture<FaceSlot> {
            adds++
            return result(face)
        }
        override fun update(slotId: String, face: BundledFace): CompletableFuture<FaceSlot> {
            updates++
            updatedSlot = slotId
            return result(face)
        }
        private fun result(face: BundledFace): CompletableFuture<FaceSlot> =
            failure?.let { failedFaceOperation(it) } ?: pending ?:
                CompletableFuture.completedFuture(FaceSlot("new-slot", face.packageName, face.versionCode, face.revision))
        override fun activate(slotId: String): CompletableFuture<Unit> {
            activations++
            return CompletableFuture.completedFuture(Unit)
        }
    }

    @Test fun addsWithoutClaimingActivation() {
        val backend = FakeBackend()
        val result = WatchFaceInstaller(backend).install(face).join()
        assertEquals(1, backend.adds)
        assertFalse(result.active)
        assertTrue(result.changed)
        assertEquals(0, backend.activations)
    }

    @Test fun replacementUsesFreshSlotAndPreservesKnownActiveState() {
        val backend = FakeBackend().apply {
            slots = FaceSlots(listOf(slot.copy(packageName = "example.app.watchfacepush.meridian")), 0)
            active = true
        }
        val result = WatchFaceInstaller(backend).install(face).join()
        assertEquals("fresh-slot", backend.updatedSlot)
        assertEquals(1, backend.updates)
        assertTrue(result.active)
    }

    @Test fun selectingSameRevisionDoesNotReinstall() {
        val backend = FakeBackend().apply { slots = FaceSlots(listOf(slot), 0) }
        val result = WatchFaceInstaller(backend).install(face).join()
        assertFalse(result.changed)
        assertEquals(0, backend.updates)
        assertEquals(0, backend.adds)
    }

    @Test fun newerInstalledVersionIsNeverDowngraded() {
        val backend = FakeBackend().apply { slots = FaceSlots(listOf(slot.copy(versionCode = 3)), 0) }
        assertTrue(WatchFaceInstaller(backend).install(face).isCompletedExceptionally)
        assertEquals(0, backend.updates)
    }

    @Test fun requestLedgerRejectsDelayedDuplicatesAfterRestart() {
        var saved = emptyList<String>()
        val first = InstallRequestLedger({ saved }, { saved = it })
        assertTrue(first.claim("phone:first"))
        assertTrue(first.claim("phone:second"))
        val restarted = InstallRequestLedger({ saved }, { saved = it })
        assertFalse(restarted.claim("phone:first"))
        assertEquals(listOf("phone:first", "phone:second"), saved)
    }

    @Test fun requestLedgerIsBoundedAndFailsClosedOnStorageFailure() {
        var saved = emptyList<String>()
        val ledger = InstallRequestLedger({ saved }, { saved = it })
        repeat(100) { assertTrue(ledger.claim("phone:" + it)) }
        assertEquals(64, saved.size)
        assertEquals("phone:36", saved.first())
        val broken = InstallRequestLedger({ emptyList() }, { throw IllegalStateException("Storage failed") })
        assertThrows(IllegalStateException::class.java) { broken.claim("phone:new") }
    }

    @Test fun newRevisionWithSameVersionIsUpdated() {
        val backend = FakeBackend().apply { slots = FaceSlots(listOf(slot.copy(revision = "old")), 0) }
        assertTrue(WatchFaceInstaller(backend).install(face).join().changed)
        assertEquals(1, backend.updates)
    }

    @Test fun inFlightOperationRejectsSecondInstallUntilPlatformFinishes() {
        val pending = CompletableFuture<FaceSlot>()
        val backend = FakeBackend().apply { this.pending = pending }
        val installer = WatchFaceInstaller(backend)
        val first = installer.install(face)
        assertTrue(installer.isBusy())
        assertTrue(installer.install(face).isCompletedExceptionally)
        assertEquals(1, backend.adds)
        pending.complete(slot)
        assertEquals(slot, first.join().face)
        assertFalse(installer.isBusy())
    }

    @Test fun failureReleasesOwnershipAndDoesNotRemovePriorFace() {
        val backend = FakeBackend().apply {
            slots = FaceSlots(listOf(slot.copy(revision = "old")), 0)
            failure = IllegalStateException("Platform refused update")
        }
        val installer = WatchFaceInstaller(backend)
        assertTrue(installer.install(face).isCompletedExceptionally)
        assertFalse(installer.isBusy())
        assertEquals(1, backend.updates)
        assertEquals(0, backend.adds)
        assertEquals("old", backend.slots.installed.single().revision)
    }

    @Test fun noAvailableSlotFailsWithoutTryingInstallation() {
        val backend = FakeBackend().apply { slots = FaceSlots(emptyList(), 0) }
        val installer = WatchFaceInstaller(backend)
        assertTrue(installer.install(face).isCompletedExceptionally)
        assertEquals(0, backend.adds)
        assertFalse(installer.isBusy())
    }

    @Test fun activationPersistsAttemptBeforeCallingPlatform() {
        val backend = FakeBackend().apply { slots = FaceSlots(listOf(slot), 0) }
        var recorded = false
        WatchFaceInstaller(backend).activate {
            assertEquals(0, backend.activations)
            recorded = true
        }.join()
        assertTrue(recorded)
        assertEquals(1, backend.activations)
    }

    @Test fun alreadyActiveDoesNotConsumeTheActivationAttempt() {
        val backend = FakeBackend().apply { slots = FaceSlots(listOf(slot), 0); active = true }
        WatchFaceInstaller(backend).activate { fail("Already active must not consume permission") }.join()
        assertEquals(0, backend.activations)
    }

    @Test fun failedAttemptPersistencePreventsActivation() {
        val backend = FakeBackend().apply { slots = FaceSlots(listOf(slot), 0) }
        val installer = WatchFaceInstaller(backend)
        assertTrue(installer.activate { throw IllegalStateException("Could not save") }.isCompletedExceptionally)
        assertEquals(0, backend.activations)
        assertFalse(installer.isBusy())
    }

    @Test fun commandProtocolRejectsArbitraryPackagesAndOldVersions() {
        val request = "14a0c470-b125-41a1-bc13-3668c120d19a"
        assertTrue(WatchFaceProtocol.validCommand(1, request, "status", null))
        assertTrue(WatchFaceProtocol.validCommand(1, request, "install", "meridian"))
        assertFalse(WatchFaceProtocol.validCommand(2, request, "install", "meridian"))
        assertFalse(WatchFaceProtocol.validCommand(1, request, "install", "../other.apk"))
        assertFalse(WatchFaceProtocol.validCommand(1, request, "uninstall", "meridian"))
        assertFalse(WatchFaceProtocol.validCommand(1, request, "status", "pace"))
        assertFalse(WatchFaceProtocol.validCommand(1, "bad", "install", "pace"))
    }

    @Test fun privateIdentityIsInsideTheCallerPrefix() {
        assertEquals("example.app.sideload.watchfacepush.pace",
            WatchFaceProtocol.facePackage("example.app.sideload", "pace"))
        assertNull(WatchFaceProtocol.faceId("example.app.sideload", "example.app.watchfacepush.pace"))
    }

    @Test fun orbitIsRecognisedForMigrationButNeverInstallable() {
        val request = "14a0c470-b125-41a1-bc13-3668c120d19a"
        assertTrue(WatchFaceProtocol.isRetiredFace("example.app", "example.app.watchfacepush.orbit"))
        assertFalse(WatchFaceProtocol.isRetiredFace("example.app.sideload", "example.app.watchfacepush.orbit"))
        assertFalse(WatchFaceProtocol.validCommand(1, request, "install", "orbit"))
        assertNull(WatchFaceProtocol.faceId("example.app", "example.app.watchfacepush.orbit"))
        for (id in listOf("meridian", "chronograph", "atelier", "pace", "summit")) {
            assertTrue(WatchFaceProtocol.validCommand(1, request, "install", id))
        }
    }
}
