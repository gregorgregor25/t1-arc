package io.github.gregorgregor25.t1arc.wear.data

import android.content.ComponentName
import android.content.Context
import android.util.Log
import androidx.wear.tiles.TileService
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester
import io.github.gregorgregor25.t1arc.wear.complication.T1ArcGlucoseComplicationService
import io.github.gregorgregor25.t1arc.wear.complication.T1ArcOpticalGlucoseComplicationService
import io.github.gregorgregor25.t1arc.wear.complication.T1ArcChronographGraphComplicationService
import io.github.gregorgregor25.t1arc.wear.complication.T1ArcFreshnessComplicationService
import io.github.gregorgregor25.t1arc.wear.complication.T1ArcGraphComplicationService
import io.github.gregorgregor25.t1arc.wear.complication.T1ArcOrbitGraphComplicationService
import io.github.gregorgregor25.t1arc.wear.tile.T1ArcGlucoseTileService
import com.google.android.gms.wearable.DataMap
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable

private const val GLUCOSE_PATH = "/t1arc/v1/glucose/current"
private const val GLUCOSE_HISTORY_PATH = "/t1arc/v1/glucose/history"
private const val GLUCOSE_REQUEST_PATH = "/t1arc/v1/glucose/request"
private const val LOG_TAG = "T1ArcWearSync"
private const val WRITE_EPOCH_FIELD = "localDataWriteEpoch"

/**
 * Owns both push delivery and retained-item recovery.
 *
 * Wear OS normally starts [T1ArcDataLayerService] for a changed data item.
 * A companion installed after that item was created can, however, start with
 * an empty local cache. Reading the retained item on app launch makes initial
 * setup deterministic without requiring the user to wait for another CGM
 * reading.
 */
object T1ArcDataLayerSync {
    fun recover(context: Context, onComplete: () -> Unit = {}) {
        Wearable.getDataClient(context).dataItems
            .addOnSuccessListener { items ->
                var changed = false
                try {
                    items
                        .filter {
                            it.uri.path == GLUCOSE_PATH ||
                                it.uri.path == GLUCOSE_HISTORY_PATH
                        }
                        .forEach { item ->
                            changed =
                                accept(
                                    context,
                                    item.uri.path.orEmpty(),
                                    DataMapItem.fromDataItem(item).dataMap,
                                ) || changed
                        }
                } finally {
                    items.release()
                }
                if (changed) refreshSurfaces(context)
                onComplete()
            }
            .addOnFailureListener {
                onComplete()
            }
        requestCurrent(context)
    }

    fun acceptMessage(
        context: Context,
        path: String,
        bytes: ByteArray,
    ): Boolean =
        runCatching {
            accept(context, path, DataMap.fromByteArray(bytes))
        }.getOrDefault(false)

    fun requestCurrent(context: Context) {
        Wearable.getNodeClient(context).connectedNodes
            .addOnSuccessListener { nodes ->
                nodes.forEach { node ->
                    Wearable.getMessageClient(context)
                        .sendMessage(node.id, GLUCOSE_REQUEST_PATH, byteArrayOf())
                        .addOnSuccessListener {
                            Log.i(LOG_TAG, "Current glucose request sent")
                        }
                        .addOnFailureListener { error ->
                            Log.w(LOG_TAG, "Current glucose request failed", error)
                        }
                }
            }
    }

    fun accept(
        context: Context,
        path: String,
        data: DataMap,
    ): Boolean {
        if (data.getInt("schemaVersion", 0) != 1) return false
        if (!data.containsKey(WRITE_EPOCH_FIELD)) return false
        val incomingWriteEpoch = data.getLong(WRITE_EPOCH_FIELD)
        if (path == GLUCOSE_HISTORY_PATH) {
            val timestamps = data.getLongArray("timestampMs") ?: return false
            val values = data.getFloatArray("mmolL") ?: return false
            val colorTokens = data.getStringArray("colorToken")
            if (timestamps.size != values.size) return false
            val readings =
                timestamps.indices.map { index ->
                    GlucoseHistoryPoint(
                        mmolL = values[index].toDouble(),
                        timestampMs = timestamps[index],
                        colorToken = colorTokens?.getOrNull(index) ?: "cyan",
                    )
                }
            return T1ArcWearRepository
                .get(context)
                .saveHistoryForWriteEpoch(readings, incomingWriteEpoch)
        }
        if (path != GLUCOSE_PATH) return false
        val repository = T1ArcWearRepository.get(context)
        if (!data.getBoolean("available", false)) {
            return repository.clearForWriteEpoch(incomingWriteEpoch)
        } else {
            val snapshot =
                GlucoseSnapshot(
                    mmolL = data.getDouble("mmolL", Double.NaN),
                    trend = data.getString("trend") ?: "unknown",
                    trendOrigin = data.getString("trendOrigin") ?: "source",
                    timestampMs = data.getLong("timestampMs", 0L),
                    sourceLabel = (data.getString("sourceLabel") ?: "T1 Arc").take(80),
                    sourceHasError = data.getBoolean("sourceHasError", false),
                    category = data.getString("category") ?: "stale",
                    colorToken = data.getString("colorToken") ?: "slate",
                    staleColorToken = data.getString("staleColorToken") ?: "slate",
                    glucoseUnit = data.getString("glucoseUnit") ?: "mmolL",
                    localeTag = data.getString("localeTag") ?: "en-GB",
                    timeZone = data.getString("timeZone") ?: "Europe/London",
                )
            return repository.saveForWriteEpoch(snapshot, incomingWriteEpoch)
        }
    }

    fun refreshSurfaces(context: Context) {
        ComplicationDataSourceUpdateRequester
            .create(
                context,
                ComponentName(context, T1ArcGlucoseComplicationService::class.java),
            )
            .requestUpdateAll()
        ComplicationDataSourceUpdateRequester
            .create(
                context,
                ComponentName(context, T1ArcOpticalGlucoseComplicationService::class.java),
            )
            .requestUpdateAll()
        ComplicationDataSourceUpdateRequester
            .create(
                context,
                ComponentName(context, T1ArcFreshnessComplicationService::class.java),
            )
            .requestUpdateAll()
        ComplicationDataSourceUpdateRequester
            .create(
                context,
                ComponentName(context, T1ArcGraphComplicationService::class.java),
            )
            .requestUpdateAll()
        ComplicationDataSourceUpdateRequester
            .create(
                context,
                ComponentName(context, T1ArcChronographGraphComplicationService::class.java),
            )
            .requestUpdateAll()
        ComplicationDataSourceUpdateRequester
            .create(
                context,
                ComponentName(context, T1ArcOrbitGraphComplicationService::class.java),
            )
            .requestUpdateAll()
        TileService
            .getUpdater(context)
            .requestUpdate(T1ArcGlucoseTileService::class.java)
    }
}
