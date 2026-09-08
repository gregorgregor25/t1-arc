package io.github.gregorgregor25.t1arc.wear.watchfaces

import java.util.concurrent.CompletableFuture
import java.util.concurrent.atomic.AtomicBoolean

data class BundledFace(
    val id: String,
    val packageName: String,
    val versionCode: Long,
    val revision: String,
    val apkAsset: String,
    val sha256: String,
    val validationToken: String,
)

data class FaceSlot(
    val slotId: String,
    val packageName: String,
    val versionCode: Long,
    val revision: String,
)

data class FaceSlots(val installed: List<FaceSlot>, val available: Int)
data class FaceSelection(val face: FaceSlot, val active: Boolean, val changed: Boolean)

interface FaceBackend {
    fun list(): CompletableFuture<FaceSlots>
    fun isActive(packageName: String): CompletableFuture<Boolean>
    fun add(face: BundledFace): CompletableFuture<FaceSlot>
    fun update(slotId: String, face: BundledFace): CompletableFuture<FaceSlot>
    fun activate(slotId: String): CompletableFuture<Unit>
}

fun <T> failedFaceOperation(error: Throwable): CompletableFuture<T> =
    CompletableFuture<T>().also { it.completeExceptionally(error) }

/**
 * Holds ownership until the platform callback completes, even if the phone times out.
 * No remove API is exposed. Replacing a face must not destroy the working slot first.
 */
class WatchFaceInstaller(private val backend: FaceBackend) {
    private val busy = AtomicBoolean(false)
    fun isBusy(): Boolean = busy.get()

    fun install(face: BundledFace): CompletableFuture<FaceSelection> = exclusive {
        backend.list().thenCompose { slots ->
            require(slots.installed.size <= 1) { "Unexpected watch face slots. Check the watch first." }
            val current = slots.installed.firstOrNull()
            if (current == null) {
                require(slots.available > 0) { "No watch face slot is available." }
                backend.add(face).thenApply { FaceSelection(it, active = false, changed = true) }
            } else {
                require(current.packageName != face.packageName || current.versionCode <= face.versionCode) {
                    "A newer version of this face is already installed. Update the companion first."
                }
                backend.isActive(current.packageName).thenCompose { wasActive ->
                    if (
                        current.packageName == face.packageName &&
                        current.versionCode == face.versionCode &&
                        current.revision == face.revision
                    ) {
                        CompletableFuture.completedFuture(FaceSelection(current, wasActive, false))
                    } else {
                        // Checking immediately after update can report the old active package.
                        backend.update(current.slotId, face).thenApply {
                            FaceSelection(it, active = wasActive, changed = true)
                        }
                    }
                }
            }
        }
    }

    fun activate(beforeAttempt: () -> Unit): CompletableFuture<Unit> = exclusive {
        backend.list().thenCompose { slots ->
            require(slots.installed.size == 1) { "Choose a face on the phone first." }
            val current = slots.installed.single()
            backend.isActive(current.packageName).thenCompose { active ->
                if (active) CompletableFuture.completedFuture(Unit)
                else {
                    beforeAttempt()
                    backend.activate(current.slotId)
                }
            }
        }
    }

    private fun <T> exclusive(operation: () -> CompletableFuture<T>): CompletableFuture<T> {
        if (!busy.compareAndSet(false, true)) {
            return failedFaceOperation(IllegalStateException("A watch face operation is still running."))
        }
        val result = try { operation() } catch (error: Exception) { failedFaceOperation<T>(error) }
        return result.whenComplete { _, _ -> busy.set(false) }
    }
}
