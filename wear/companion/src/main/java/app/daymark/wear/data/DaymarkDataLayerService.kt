package app.daymark.wear.data

import android.util.Log
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService

private const val GLUCOSE_PATH = "/daymark/glucose/current"
private const val GLUCOSE_HISTORY_PATH = "/daymark/glucose/history"
private const val LOG_TAG = "DaymarkWearSync"

class DaymarkDataLayerService : WearableListenerService() {
    override fun onDataChanged(dataEvents: DataEventBuffer) {
        super.onDataChanged(dataEvents)
        var changed = false
        dataEvents
            .filter {
                it.type == DataEvent.TYPE_CHANGED &&
                    (
                        it.dataItem.uri.path == GLUCOSE_PATH ||
                            it.dataItem.uri.path == GLUCOSE_HISTORY_PATH
                    )
            }
            .forEach { event ->
                // DataEventBuffer is short-lived, so copy the DataMap synchronously.
                changed =
                    DaymarkDataLayerSync.accept(
                        this,
                        event.dataItem.uri.path.orEmpty(),
                        DataMapItem.fromDataItem(event.dataItem).dataMap,
                    ) || changed
            }
        if (changed) DaymarkDataLayerSync.refreshSurfaces(this)
    }

    override fun onMessageReceived(messageEvent: MessageEvent) {
        super.onMessageReceived(messageEvent)
        if (
            messageEvent.path != GLUCOSE_PATH &&
                messageEvent.path != GLUCOSE_HISTORY_PATH
        ) return
        val changed =
            DaymarkDataLayerSync.acceptMessage(
                this,
                messageEvent.path,
                messageEvent.data,
            )
        Log.i(
            LOG_TAG,
            "Immediate ${messageEvent.path.substringAfterLast('/')} message received; changed=$changed",
        )
        if (changed) {
            DaymarkDataLayerSync.refreshSurfaces(this)
        }
    }
}
