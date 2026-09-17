package io.github.gregorgregor25.t1arc.wear.watchfaces

import android.os.Handler
import android.os.Looper
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import io.github.gregorgregor25.t1arc.watchfaces.WatchFaceProtocol
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean

/** Data Layer scopes callers to the same package and signing certificate. */
class WatchFaceCommandService : WearableListenerService() {
    override fun onMessageReceived(event: MessageEvent) {
        if (event.path != WatchFaceProtocol.COMMAND_PATH ||
            event.data.size !in 1..WatchFaceProtocol.MAX_MESSAGE_BYTES) return
        val request = try { JSONObject(event.data.toString(Charsets.UTF_8)) } catch (_: Exception) { return }
        val requestId = request.optString("requestId")
        val action = request.optString("action")
        val faceId = if (request.has("faceId")) request.optString("faceId") else null
        if (!WatchFaceProtocol.validCommand(request.optInt("version", -1), requestId, action, faceId)) return
        val nodeId = event.sourceNodeId
        val runtime = WatchFaceRuntime.get(this)
        val application = applicationContext
        val sent = AtomicBoolean(false)
        fun reply(response: JSONObject) {
            if (!sent.compareAndSet(false, true)) return
            response.put("requestId", requestId)
            Wearable.getMessageClient(application).sendMessage(
                nodeId, WatchFaceProtocol.RESULT_PATH, response.toString().toByteArray(Charsets.UTF_8),
            )
        }
        val handler = Handler(Looper.getMainLooper())
        val timeout = Runnable { reply(runtime.base("uncertain")) }
        handler.postDelayed(timeout, 30_000L)
        // Never block glucose listeners, the main thread or the platform callbacks.
        runtime.executor.execute {
            val result = try {
                if (action == "status") runtime.status()
                else runtime.select(requireNotNull(faceId), nodeId + ":" + requestId)
            } catch (error: Exception) { failedFaceOperation<JSONObject>(error) }
            result.whenComplete { response, error ->
                handler.removeCallbacks(timeout)
                reply(if (error == null) response else runtime.base(
                    if (runtime.installer?.isBusy() == true) "busy" else "failed",
                ))
            }
        }
    }
}
