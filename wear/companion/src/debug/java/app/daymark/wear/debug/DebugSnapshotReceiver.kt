package app.daymark.wear.debug

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import app.daymark.wear.data.DaymarkDataLayerSync
import app.daymark.wear.data.DaymarkWearRepository
import app.daymark.wear.data.GlucoseHistoryPoint
import app.daymark.wear.data.GlucoseSnapshot
import kotlin.math.sin

/**
 * Debug-build-only test seam for emulator screenshot and stale-state QA.
 * It is absent from release APKs and does not exist in production.
 */
class DebugSnapshotReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION) return
        // BroadcastReceiver supplies a restricted Context that cannot bind to
        // the Tile update service. Use the application Context for framework
        // update requesters, matching the production Data Layer service.
        val applicationContext = context.applicationContext
        val repository = DaymarkWearRepository.get(applicationContext)
        if (intent.getBooleanExtra("clear", false)) {
            repository.clear()
        } else {
            repository.save(
                GlucoseSnapshot(
                    mmolL = intent.getStringExtra("mmol")?.toDoubleOrNull() ?: 6.8,
                    trend = intent.getStringExtra("trend") ?: "flat",
                    trendOrigin = intent.getStringExtra("trendOrigin") ?: "source",
                    timestampMs = intent.getLongExtra("timestamp", System.currentTimeMillis()),
                    sourceLabel = "Daymark debug fixture",
                    sourceHasError = intent.getBooleanExtra("sourceError", false),
                    category = intent.getStringExtra("category") ?: "target",
                    colorToken = intent.getStringExtra("colorToken") ?: "cyan",
                    staleColorToken = intent.getStringExtra("staleColorToken") ?: "slate",
                ),
            )
            if (intent.getBooleanExtra("history", false)) {
                val now = System.currentTimeMillis()
                val orbitPreviewValues =
                    doubleArrayOf(
                        8.5, 8.1, 8.7, 8.3, 9.0, 8.5, 9.2, 8.8, 9.4, 8.9,
                        9.6, 9.1, 9.5, 8.8, 9.2, 8.6, 9.0, 8.4, 8.8, 8.1,
                        8.5, 7.9, 8.3, 7.6, 8.0, 7.4, 7.8, 7.2, 7.6, 7.0,
                        7.4, 6.8, 7.1, 6.5, 6.8, 6.2, 6.4,
                    )
                repository.saveHistory(
                    (0..72).map { index ->
                        val value =
                            if (index >= 36) {
                                orbitPreviewValues[index - 36]
                            } else {
                                6.4 + 1.1 * sin(index / 4.6) + 0.35 * sin(index / 1.8)
                            }
                        GlucoseHistoryPoint(
                            mmolL = value.coerceIn(3.1, 11.8),
                            timestampMs = now - (72 - index) * 5 * 60_000L,
                        )
                    },
                )
            }
        }

        DaymarkDataLayerSync.refreshSurfaces(applicationContext)
    }

    private companion object {
        const val ACTION = "app.daymark.wear.DEBUG_SET_GLUCOSE"
    }
}
