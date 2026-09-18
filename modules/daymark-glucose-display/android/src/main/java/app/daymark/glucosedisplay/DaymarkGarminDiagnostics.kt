package app.daymark.glucosedisplay

import android.app.Activity
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.content.FileProvider
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant
import java.util.UUID
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

internal object DaymarkGarminDiagnostics {
  const val BETA_BUILD = "0.4"
  private fun prefs(c: Context) = c.getSharedPreferences("garmin_diagnostics", Context.MODE_PRIVATE)

  private fun read(c: Context): List<GarminDiagnosticEvent> = runCatching {
    val data = JSONArray(prefs(c).getString("events", "[]"))
    (0 until data.length()).mapNotNull { i -> runCatching {
      val row = data.getJSONObject(i)
      GarminDiagnosticEvent(row.getLong("at"), GarminDiagnosticKind.valueOf(row.getString("event")),
        row.optLong("revision"), row.optInt("attempt"))
    }.getOrNull() }
  }.getOrDefault(emptyList())

  private fun json(events: List<GarminDiagnosticEvent>) = JSONArray().apply {
    events.forEach { event -> put(JSONObject().put("at", event.at)
      .put("timeUtc", Instant.ofEpochMilli(event.at).toString()).put("event", event.kind.name)
      .apply { if (event.revision > 0) put("revision", event.revision)
        if (event.attempt > 0) put("attempt", event.attempt) }) }
  }

  // Logging must never interrupt glucose delivery. Values, names and exceptions are not accepted.
  @Synchronized fun record(c: Context, kind: GarminDiagnosticKind, revision: Long = 0, attempt: Int = 0) {
    runCatching {
      val now = System.currentTimeMillis()
      val events = GarminDiagnosticRetention.prune(read(c), now)
      val entry = GarminDiagnosticEvent(now, kind, revision, attempt)
      val previous = events.lastOrNull()
      if (previous?.copy(at = now) == entry && kind != GarminDiagnosticKind.REPORT_CREATED && kind != GarminDiagnosticKind.RETRY) return
      prefs(c).edit().putString("events", json(GarminDiagnosticRetention.prune(events + entry, now)).toString()).apply()
    }
  }

  @Synchronized fun create(c: Context, snapshot: Map<String, Any?>): File {
    record(c, GarminDiagnosticKind.REPORT_CREATED)
    val now = System.currentTimeMillis()
    val events = GarminDiagnosticRetention.prune(read(c), now)
    val packageInfo = c.packageManager.getPackageInfo(c.packageName, 0)
    val connectVersion = runCatching {
      c.packageManager.getPackageInfo("com.garmin.android.apps.connectmobile", 0).versionName
    }.getOrNull() ?: "not installed"
    val summary = buildString {
      appendLine("T1 Arc Garmin diagnostic report")
      appendLine("Created UTC: ${Instant.ofEpochMilli(now)}")
      appendLine("Diagnostics build: $BETA_BUILD; format: 1")
      appendLine("Android app: ${packageInfo.versionName} (${packageInfo.longVersionCode})")
      appendLine("Phone: ${Build.MANUFACTURER} ${Build.MODEL}; Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
      appendLine("Garmin Connect: $connectVersion")
      appendLine("Expected watch companion: 0.1.0 (installed version not available)")
      appendLine()
      snapshot.forEach { (key, value) -> appendLine("$key: ${value ?: "unknown"}") }
      appendLine()
      appendLine("Retained events: ${events.size}; latest 2000 events, at most seven days.")
      appendLine("Revisions identify updates by creation time, not glucose values.")
      appendLine("SEND_ACCEPTED means the phone SDK accepted a message; only ACK confirms watch receipt.")
      appendLine("An ACK does not prove a third-party watch face refreshed.")
      appendLine("This report contains timing and device/software metadata, not glucose values, credentials, device IDs, source details or general app logs.")
      appendLine("Nothing is uploaded automatically. Share only with the person helping test the beta.")
      appendLine()
      appendLine("Please add in your message: what happened, approximate time/time zone, watch model/firmware, face name/version, and whether the phone was locked.")
      appendLine("Watch crashes and face rendering are not captured by this phone report.")
      appendLine()
      appendLine("Event history (UTC):")
      events.forEach { appendLine("${Instant.ofEpochMilli(it.at)} ${it.kind.name}" +
        (if (it.revision > 0) " revision=${it.revision}" else "") +
        (if (it.attempt > 0) " attempt=${it.attempt}" else "")) }
    }
    val dir = File(c.cacheDir, "garmin-reports").apply { check(mkdirs() || isDirectory) }
    dir.listFiles()?.filter { it.isFile && it.extension == "zip" }
      ?.sortedByDescending { it.lastModified() }?.drop(2)?.forEach { it.delete() }
    val file = File(dir, "T1Arc-Garmin-report-${now}-${UUID.randomUUID().toString().take(8)}.zip")
    ZipOutputStream(file.outputStream()).use { zip ->
      mapOf("report.txt" to summary, "events.json" to JSONObject().put("formatVersion", 1)
        .put("createdAtUtc", Instant.ofEpochMilli(now).toString()).put("events", json(events)).toString(2))
        .forEach { (name, content) -> zip.putNextEntry(ZipEntry(name)); zip.write(content.toByteArray(Charsets.UTF_8)); zip.closeEntry() }
    }
    return file
  }

  fun share(activity: Activity, file: File) {
    val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.garminreports", file)
    val send = Intent(Intent.ACTION_SEND).apply {
      type = "application/zip"
      putExtra(Intent.EXTRA_STREAM, uri)
      putExtra(Intent.EXTRA_SUBJECT, "T1 Arc Garmin beta diagnostic report")
      clipData = ClipData.newRawUri("Garmin diagnostic report", uri)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    activity.startActivity(Intent.createChooser(send, "Share Garmin diagnostic report"))
  }
}
