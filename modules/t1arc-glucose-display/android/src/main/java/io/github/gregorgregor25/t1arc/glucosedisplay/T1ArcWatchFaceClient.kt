package io.github.gregorgregor25.t1arc.glucosedisplay

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.wear.remote.interactions.RemoteActivityHelper
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.Wearable
import io.github.gregorgregor25.t1arc.watchfaces.WatchFaceProtocol
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

internal object T1ArcWatchFaceClient {
    suspend fun status(context: Context): List<Map<String, Any?>> = withContext(Dispatchers.IO) {
        val nodes = Tasks.await(Wearable.getNodeClient(context).connectedNodes, 5, TimeUnit.SECONDS)
        val capable = Tasks.await(
            Wearable.getCapabilityClient(context).getCapability(
                WatchFaceProtocol.CAPABILITY, CapabilityClient.FILTER_REACHABLE,
            ), 5, TimeUnit.SECONDS,
        ).nodes.map { it.id }.toSet()
        coroutineScope {
            nodes.map { node -> async(Dispatchers.IO) {
                val response = if (node.id !in capable) {
                    mapOf<String, Any?>("code" to "companion_update_required", "supported" to false)
                } else {
                    try { request(context, node.id, "status", null) }
                    catch (_: Exception) { mapOf("code" to "unreachable", "supported" to false) }
                }
                response + mapOf("nodeId" to node.id, "watchName" to node.displayName)
            } }.awaitAll()
        }
    }

    suspend fun install(context: Context, nodeId: String, faceId: String): Map<String, Any?> =
        withContext(Dispatchers.IO) {
            require(faceId in WatchFaceProtocol.faceIds) { "Unknown watch face." }
            requireTarget(context, nodeId)
            try { request(context, nodeId, "install", faceId) }
            catch (_: Exception) {
                // Sending is not installation. A lost reply requires reconciliation, not success.
                mapOf("code" to "uncertain", "supported" to true)
            }
        }

    suspend fun openActivation(context: Context, nodeId: String): Boolean = withContext(Dispatchers.IO) {
        requireTarget(context, nodeId)
        val intent = Intent(Intent.ACTION_VIEW)
            .addCategory(Intent.CATEGORY_BROWSABLE)
            .setData(Uri.parse(context.packageName + "://watchfaces/activate"))
        RemoteActivityHelper(context).startRemoteActivity(intent, nodeId).get(10, TimeUnit.SECONDS)
        true
    }

    private fun requireTarget(context: Context, nodeId: String) {
        require(nodeId.isNotBlank() && nodeId.length <= 128) { "Choose a watch first." }
        val nodes = Tasks.await(
            Wearable.getCapabilityClient(context).getCapability(
                WatchFaceProtocol.CAPABILITY, CapabilityClient.FILTER_REACHABLE,
            ), 5, TimeUnit.SECONDS,
        ).nodes
        require(nodes.any { it.id == nodeId }) { "This watch is not connected to the matching companion." }
    }

    private fun request(context: Context, nodeId: String, action: String, faceId: String?): Map<String, Any?> {
        val client = Wearable.getMessageClient(context)
        val requestId = UUID.randomUUID().toString()
        val completion = CompletableFuture<JSONObject>()
        val listener = MessageClient.OnMessageReceivedListener { message ->
            if (message.sourceNodeId == nodeId && message.path == WatchFaceProtocol.RESULT_PATH &&
                message.data.size in 1..WatchFaceProtocol.MAX_MESSAGE_BYTES
            ) {
                val response = try { JSONObject(message.data.toString(Charsets.UTF_8)) } catch (_: Exception) { null }
                if (response?.optInt("version") == WatchFaceProtocol.VERSION &&
                    response.optString("requestId") == requestId
                ) completion.complete(response)
            }
        }
        try {
            Tasks.await(client.addListener(listener), 5, TimeUnit.SECONDS)
            val payload = JSONObject().put("version", WatchFaceProtocol.VERSION)
                .put("requestId", requestId).put("action", action)
            if (faceId != null) payload.put("faceId", faceId)
            Tasks.await(client.sendMessage(nodeId, WatchFaceProtocol.COMMAND_PATH,
                payload.toString().toByteArray(Charsets.UTF_8)), 5, TimeUnit.SECONDS)
            return toMap(completion.get(35, TimeUnit.SECONDS))
        } finally {
            client.removeListener(listener)
        }
    }

    private fun toMap(json: JSONObject): Map<String, Any?> {
        val catalog = json.optJSONArray("catalog")
        return mapOf(
            "code" to json.optString("code", "failed"),
            "supported" to json.optBoolean("supported"),
            "active" to json.optBoolean("active"),
            "activationUsed" to json.optBoolean("activationUsed"),
            "activationDenied" to json.optBoolean("activationDenied"),
            "installedFaceId" to json.optString("installedFaceId").takeIf { it in WatchFaceProtocol.faceIds },
            "retiredFaceId" to "orbit".takeIf {
                json.optString("retiredFaceId") == it || json.optString("installedFaceId") == it
            },
            "installedVersion" to json.optLong("installedVersion", 0),
            "catalog" to (0 until (catalog?.length() ?: 0)).mapNotNull { index ->
                catalog?.optString(index)?.takeIf { it in WatchFaceProtocol.faceIds }
            },
        )
    }
}
