package io.github.gregorgregor25.t1arc.wear.watchfaces

import android.app.Activity
import android.app.Instrumentation
import android.graphics.Bitmap
import android.os.Build
import android.os.Bundle
import io.github.gregorgregor25.t1arc.wear.data.GlucoseHistoryPoint
import io.github.gregorgregor25.t1arc.wear.data.GlucoseSnapshot
import io.github.gregorgregor25.t1arc.wear.data.T1ArcDataLayerSync
import io.github.gregorgregor25.t1arc.wear.data.T1ArcWearRepository
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

/**
 * Emulator-only integration gate against the real platform installer.
 * This lives in a separate test APK, never in the distributed companion.
 * It changes only this test companion's managed face slot.
 */
class WatchFaceSmokeInstrumentation : Instrumentation() {
    private var options = Bundle()

    override fun onCreate(arguments: Bundle?) {
        super.onCreate(arguments)
        options = arguments ?: Bundle()
        start()
    }

    override fun onStart() {
        val report = StringBuilder()
        try {
            check(Build.HARDWARE in setOf("ranchu", "goldfish") && Build.VERSION.SDK_INT >= 36) {
                "This mutating smoke test is restricted to Wear OS 6 emulators."
            }
            val runtime = WatchFaceRuntime.get(targetContext)
            check(runtime.backend != null) { "Watch Face Push is unavailable on this emulator." }
            if (options.getString("mode") == "freshness") {
                renderPassiveFreshness(runtime, report)
                finish(Activity.RESULT_OK, Bundle().apply { putString("stream", report.toString()) })
                return
            }
            if (options.getString("mode") == "gallery") {
                renderGallery(runtime, report)
                finish(Activity.RESULT_OK, Bundle().apply { putString("stream", report.toString()) })
                return
            }
            if (options.getString("mode") == "render") {
                renderFixture(runtime, report)
                if (options.getString("verifyTap") == "true") {
                    check(options.getString("face") == "pace") { "Tap bounds are calibrated for Pace only." }
                    check(shell("wm size").trim() == "Physical size: 454x454")
                    shell("input tap 227 181")
                    Thread.sleep(1_000)
                    val activities = shell("dumpsys activity activities")
                    check(activities.lineSequence().any { it.contains("topResumedActivity") && it.contains("GraphActivity") }) {
                        "Glucose tap did not open GraphActivity."
                    }
                    report.append("PASS: tapping Pace glucose opened the companion GraphActivity\n")
                    shell("input keyevent 4")
                }
                finish(Activity.RESULT_OK, Bundle().apply { putString("stream", report.toString()) })
                return
            }
            val firstRequest = "emulator:" + UUID.randomUUID()
            runtime.catalog.forEachIndexed { index, face ->
                report.append("BEGIN: ").append(face.id).append('\n')
                val request = if (index == 0) firstRequest else "emulator:" + UUID.randomUUID()
                val result = runtime.select(face.id, request).get(45, TimeUnit.SECONDS)
                check(result.getString("installedFaceId") == face.id) { result.toString() }
                val installed = runtime.backend!!.list().get(10, TimeUnit.SECONDS).installed.single()
                check(installed.packageName == face.packageName)
                check(installed.versionCode == face.versionCode)
                check(installed.revision == face.revision) { "Platform revision did not match the bundled face." }
                val repeated = runtime.installer!!.install(face).get(20, TimeUnit.SECONDS)
                check(!repeated.changed) { "Re-selecting the same face needlessly installed it again." }
                report.append("PASS: ").append(face.id).append(" installed; revision verified; repeat is a no-op\n")
            }
            val duplicate = runtime.select(runtime.catalog.first().id, firstRequest).get(20, TimeUnit.SECONDS)
            check(duplicate.getString("installedFaceId") == runtime.catalog.last().id) {
                "Delayed duplicate command changed the selected face."
            }
            report.append("PASS: delayed duplicate preserved the later choice\n")
            report.append("PASS: all real-platform face installation checks\n")
            finish(Activity.RESULT_OK, Bundle().apply { putString("stream", report.toString()) })
        } catch (error: Throwable) {
            report.append("FAIL: ").append(error.stackTraceToString()).append('\n')
            finish(Activity.RESULT_CANCELED, Bundle().apply { putString("stream", report.toString()) })
        }
    }

    private fun shell(command: String): String = uiAutomation.executeShellCommand(command).use {
        FileInputStream(it.fileDescriptor).bufferedReader().readText()
    }

    /** Advance only the emulator clock. Do not send another reading or request refresh. */
    private fun renderPassiveFreshness(runtime: WatchFaceRuntime, report: StringBuilder) {
        shell("settings put system screen_off_timeout 2147483647")
        shell("input keyevent 224")
        options = Bundle().apply { putString("face", "pace"); putString("scenario", "current") }
        renderFixture(runtime, report)
        val repository = T1ArcWearRepository.get(targetContext)
        val original = checkNotNull(repository.snapshot())
        val output = File(targetContext.getExternalFilesDir(null), "watch-passive-freshness")
        check(output.isDirectory || output.mkdirs())
        listOf("current" to 0, "delayed" to 8, "stale" to 14).forEach { (label, minutes) ->
            if (minutes > 0) {
                shell("cmd alarm set-time ${original.timestampMs + minutes * 60_000L}")
                Thread.sleep(8_000)
            }
            check(repository.snapshot() == original) { "Passive freshness test changed the stored reading." }
            val bitmap = checkNotNull(uiAutomation.takeScreenshot())
            try {
                FileOutputStream(File(output, "pace-$label.png")).use {
                    check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it))
                }
            } finally { bitmap.recycle() }
            report.append("CAPTURE: ").append(label).append("; original reading unchanged; no refresh request\n")
        }
        report.append("PASS: passive timeline captures ready for visual status verification\n")
    }

    /** One process for the batch: finishing instrumentation force-stops providers. */
    private fun renderGallery(runtime: WatchFaceRuntime, report: StringBuilder) {
        val outputTag = options.getString("outputTag") ?: "v2"
        check(outputTag.matches(Regex("[a-z0-9-]{1,40}"))) { "Invalid gallery output tag." }
        val output = File(targetContext.getExternalFilesDir(null), "watch-gallery-$outputTag")
        check(output.isDirectory || output.mkdirs())
        val onlyFace = options.getString("onlyFace")
        if (onlyFace != null) check(runtime.catalog.any { it.id == onlyFace })
        val quick = options.getString("quick") == "true"
        val captureOnly = options.getString("captureOnly")
        report.append("DISPLAY: ").append(shell("wm size").trim()).append('\n')
        report.append("CLOCK FORMAT: ").append(shell("settings get system time_12_24").trim()).append('\n')
        val clockEpoch = when (options.getString("clock")) {
            "evening" -> "2026-09-06T17:30:00Z"
            "midnight" -> "2026-09-06T22:59:45Z"
            null, "morning" -> "2026-09-06T09:08:30Z"
            else -> error("Unknown emulator clock preset.")
        }.let { java.time.Instant.parse(it).toEpochMilli() }
        val cases = listOf(
            listOf("current", "current", "mmolL", "en-GB"),
            listOf("low", "low", "mmolL", "en-GB"),
            listOf("high", "high", "mgDl", "en-US"),
            listOf("delayed", "delayed", "mmolL", "en-GB"),
            listOf("stale", "stale", "mmolL", "en-GB"),
            listOf("missing", "missing", "mmolL", "en-GB"),
            listOf("empty", "empty", "mmolL", "en-GB"),
            listOf("mgdl", "current", "mgDl", "en-US"),
            listOf("fr", "current", "mmolL", "fr-FR"),
            listOf("ja", "current", "mgDl", "ja-JP"),
        ).filter { !quick || it[0] in setOf("current", "high", "stale") }
        fun capture(name: String) {
            var bitmap = checkNotNull(uiAutomation.takeScreenshot()) { "No emulator screenshot." }
            fun hasVisibleContent(): Boolean {
                for (y in 0 until bitmap.height step 3) for (x in 0 until bitmap.width step 3) {
                    val pixel = bitmap.getPixel(x, y)
                    if (android.graphics.Color.red(pixel) + android.graphics.Color.green(pixel) +
                        android.graphics.Color.blue(pixel) > 90) return true
                }
                return false
            }
            // Dozing can precede the display's ambient frame. Never accept a black capture.
            var retries = 0
            while (!hasVisibleContent() && retries++ < 5) {
                bitmap.recycle()
                Thread.sleep(1_000)
                bitmap = checkNotNull(uiAutomation.takeScreenshot())
            }
            try {
                check(hasVisibleContent()) { "Blank screenshot: $name; ${shell("dumpsys power")}" }
                FileOutputStream(File(output, "$name.png")).use {
                    check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it))
                }
            } finally {
                bitmap.recycle()
            }
        }
        try {
            runtime.catalog.filter { onlyFace == null || it.id == onlyFace }.forEach { face ->
                shell("settings put system screen_off_timeout 2147483647")
                shell("cmd alarm set-time $clockEpoch")
                shell("input keyevent 224")
                cases.forEach { case ->
                    options = Bundle().apply {
                        putString("face", face.id)
                        putString("scenario", case[1])
                        putString("unit", case[2])
                        putString("locale", case[3])
                    }
                    val step = StringBuilder()
                    renderFixture(runtime, step)
                    if (captureOnly == null || case[0] == captureOnly) {
                        check(shell("dumpsys power").contains("mWakefulness=Awake")) { "Active capture is not awake." }
                        capture("${face.id}-${case[0]}")
                    }
                    sendStatus(0, Bundle().apply { putString("stream", step.toString()) })
                }
                val rendererPid = shell("pidof com.google.wear.watchface.runtime").trim()
                check(rendererPid.isNotEmpty()) { "No active WFF renderer." }
                shell("settings put system screen_off_timeout 5000")
                val ambientDeadline = android.os.SystemClock.elapsedRealtime() + 30_000L
                while (!shell("dumpsys power").contains("mWakefulness=Dozing") &&
                    android.os.SystemClock.elapsedRealtime() < ambientDeadline) Thread.sleep(1_000)
                check(shell("dumpsys power").contains("mWakefulness=Dozing")) { "AOD not entered within 30 seconds." }
                Thread.sleep(1_500) // Let Wear's ambient transition finish before measuring pixels.
                capture("${face.id}-ambient")
                check(shell("pidof com.google.wear.watchface.runtime").trim() == rendererPid) {
                    "WFF renderer restarted during ambient capture; reject the recovered frame."
                }
                report.append("PASS: ").append(face.id).append(' ').append(cases.size)
                    .append(" live-provider captures and real AOD\n")
            }
        } finally {
            shell("settings put system screen_off_timeout 2147483647")
            shell("input keyevent 224")
        }
    }

    private fun renderFixture(runtime: WatchFaceRuntime, report: StringBuilder) {
        val id = options.getString("face") ?: "atelier"
        check(runtime.catalog.any { it.id == id }) { "Unknown gallery face." }
        val scenario = options.getString("scenario") ?: "current"
        check(scenario in setOf("current", "low", "high", "delayed", "stale", "missing", "empty"))
        val unit = options.getString("unit") ?: "mmolL"
        check(unit in setOf("mmolL", "mgDl"))
        val locale = options.getString("locale") ?: "en-GB"
        check(locale in setOf("en-GB", "en-US", "fr-FR", "ja-JP"))
        val repository = T1ArcWearRepository.get(targetContext)
        if (scenario == "missing" || scenario == "empty") {
            repository.clear()
            if (scenario == "empty") repository.clearHistory()
        } else {
            val now = System.currentTimeMillis()
            val age = when (scenario) { "stale" -> 20; "delayed" -> 8; else -> 0 }
            val value = when (scenario) { "low" -> 3.2; "high" -> 14.8; else -> 6.8 }
            val color = when (scenario) { "low" -> "rose"; "high" -> "amber"; else -> "green" }
            repository.save(GlucoseSnapshot(
                mmolL = value, trend = if (scenario == "low") "down" else "flat",
                timestampMs = now - age * 60_000L, sourceLabel = "Synthetic emulator example",
                sourceHasError = false, category = if (scenario in setOf("low", "high")) scenario else "target",
                colorToken = color, glucoseUnit = unit, localeTag = locale,
            ))
            repository.saveHistory((0..36).map { index ->
                GlucoseHistoryPoint(
                    mmolL = if (index == 36) value else 6.6 + kotlin.math.sin(index / 4.0) * 1.2,
                    timestampMs = now - age * 60_000L - (36 - index) * 5 * 60_000L,
                    colorToken = if (index == 36) color else "green",
                )
            })
        }
        T1ArcDataLayerSync.refreshSurfaces(targetContext)
        val result = runtime.select(id, "emulator:" + UUID.randomUUID()).get(45, TimeUnit.SECONDS)
        check(result.getString("installedFaceId") == id)
        check(result.getBoolean("active")) { "The gallery face is not active: $result" }
        // Finishing instrumentation force-stops the target process. Keep it
        // alive long enough for the platform's asynchronous complication binds
        // and data requests, otherwise a screenshot can retain the old fixture.
        waitForIdleSync()
        Thread.sleep(5_000)
        T1ArcDataLayerSync.refreshSurfaces(targetContext)
        Thread.sleep(5_000)
        report.append("PASS: synthetic render fixture ").append(id).append(' ')
            .append(scenario).append(' ').append(unit).append(' ').append(locale)
            .append("; active=").append(result.getBoolean("active")).append('\n')
    }
}
