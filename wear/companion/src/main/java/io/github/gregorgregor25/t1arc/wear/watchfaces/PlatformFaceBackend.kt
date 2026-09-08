package io.github.gregorgregor25.t1arc.wear.watchfaces

import android.content.Context
import android.os.OutcomeReceiver
import android.os.ParcelFileDescriptor
import androidx.annotation.RequiresApi
import com.google.wear.Sdk
import com.google.wear.services.watchfaces.watchfacepush.WatchFacePushManager
import com.google.wear.services.watchfaces.watchfacepush.WatchFaceSlot
import com.google.wear.services.watchfaces.watchfacepush.ListWatchFaceSlotsResponse
import io.github.gregorgregor25.t1arc.watchfaces.WatchFaceProtocol
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Executor

/** Only constructed after the SDK and optional library checks in WatchFaceRuntime. */
@RequiresApi(36)
internal class PlatformFaceBackend(
    private val context: Context,
    private val executor: Executor,
) : FaceBackend {
    private val manager = Sdk.getWearManager(context, WatchFacePushManager::class.java)

    private fun WatchFaceSlot.toSlot() = FaceSlot(
        slotId, packageName, versionCode,
        getMetaDataValues(WatchFaceProtocol.REVISION_PROPERTY).firstOrNull().orEmpty(),
    )

    override fun list(): CompletableFuture<FaceSlots> = call<ListWatchFaceSlotsResponse, WatchFacePushManager.ListException> { receiver ->
        manager.listWatchFaceSlots(executor, receiver)
    }.thenApply { result ->
        FaceSlots(result.installedWatchFaceSlots.map { it.toSlot() }, result.availableSlotCount)
    }

    override fun isActive(packageName: String): CompletableFuture<Boolean> =
        call { receiver -> manager.isWatchFaceActive(packageName, executor, receiver) }

    override fun add(face: BundledFace): CompletableFuture<FaceSlot> =
        withApk(face) { descriptor ->
            call<WatchFaceSlot, WatchFacePushManager.AddException> { receiver ->
                manager.addWatchFace(descriptor, face.validationToken, executor, receiver)
            }.thenApply { it.toSlot() }
        }

    override fun update(slotId: String, face: BundledFace): CompletableFuture<FaceSlot> =
        withApk(face) { descriptor ->
            call<WatchFaceSlot, WatchFacePushManager.UpdateException> { receiver ->
                manager.updateWatchFace(slotId, descriptor, face.validationToken, executor, receiver)
            }.thenApply { it.toSlot() }
        }

    override fun activate(slotId: String): CompletableFuture<Unit> =
        call<Void, WatchFacePushManager.SetActiveException> { receiver ->
            manager.setWatchFaceAsActive(slotId, executor, receiver)
        }.thenApply { Unit }

    private fun <T> withApk(
        face: BundledFace,
        operation: (ParcelFileDescriptor) -> CompletableFuture<T>,
    ): CompletableFuture<T> {
        // Assets are allowlisted by the catalog, never supplied by a remote message.
        val directory = File(context.cacheDir, "watch-faces").apply { mkdirs() }
        val file = File(directory, face.id + ".apk")
        context.assets.open(face.apkAsset).use { input ->
            file.outputStream().use { output -> input.copyTo(output) }
        }
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val bytes = ByteArray(8192)
            while (true) {
                val count = input.read(bytes)
                if (count < 0) break
                digest.update(bytes, 0, count)
            }
        }
        val actual = digest.digest().joinToString("") { "%02x".format(it) }
        require(actual == face.sha256) { "Bundled watch face checksum does not match." }
        val descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
        return try {
            operation(descriptor).whenComplete { _, _ -> descriptor.close() }
        } catch (error: Exception) {
            descriptor.close()
            throw error
        }
    }

    private fun <T, E : Throwable> call(
        operation: (OutcomeReceiver<T, E>) -> Unit,
    ): CompletableFuture<T> {
        val result = CompletableFuture<T>()
        try {
            operation(object : OutcomeReceiver<T, E> {
                override fun onResult(value: T) { result.complete(value) }
                override fun onError(error: E) { result.completeExceptionally(error) }
            })
        } catch (error: Exception) {
            result.completeExceptionally(error)
        }
        return result
    }
}
