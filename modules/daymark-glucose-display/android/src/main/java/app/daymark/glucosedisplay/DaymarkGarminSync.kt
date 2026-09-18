package app.daymark.glucosedisplay

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.garmin.android.connectiq.ConnectIQ
import com.garmin.android.connectiq.IQApp
import com.garmin.android.connectiq.IQDevice
import org.json.JSONObject
import java.security.KeyStore
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Opt-in private hardware beta. All SDK and delivery state is confined to main. */
internal object DaymarkGarminSync {
  const val APP_ID = "784ac26ef56a40e2a15a6d8c93742b10"
  private val main = Handler(Looper.getMainLooper())
  private val app = IQApp(APP_ID)
  private var context: Context? = null
  private var sdk: ConnectIQ? = null
  private var ready = false
  private var initializing = false
  private var error: String? = null
  private var devices = emptyList<IQDevice>()
  private val registered = mutableSetOf<Long>()
  private val installed = mutableMapOf<Long, Boolean>()
  private var lastDiscovery = 0L
  private var desired: Map<String, Any>? = null
  private var revision = 0L
  private var sentRevision = 0L
  private var confirmedRevision = 0L
  private var attempts = 0
  private var lastAttempt = 0L
  private var confirmedAt = 0L
  private var route = ""
  private var timeoutLogged = false

  private fun log(kind: GarminDiagnosticKind, update: Long = 0, attempt: Int = 0) {
    context?.let { DaymarkGarminDiagnostics.record(it, kind, update, attempt) }
  }

  // Capture existing state without initializing the SDK, retrying, or exporting identifiers.
  fun diagnosticSnapshot(c: Context): Map<String, Any?> = onMain {
    val selected = prefs(c).getString("device", null)
    val device = devices.find { it.deviceIdentifier.toString() == selected }
    mapOf("syncEnabled" to (selected != null), "sdkReady" to ready,
      "backgroundRefreshEnabled" to DaymarkGlucoseDisplayState.enabled(c),
      "watchConnected" to device?.let { runCatching { sdk?.getDeviceStatus(it) == IQDevice.IQDeviceStatus.CONNECTED }.getOrNull() },
      "watchAppInstalled" to device?.let { installed[it.deviceIdentifier] },
      "deliveryAttempts" to attempts, "pendingRevision" to revision,
      "acknowledgedRevision" to confirmedRevision, "acknowledgedAtEpochMs" to confirmedAt,
      "acknowledgementRoute" to route.ifEmpty { "none" }, "hasConnectionError" to (error != null))
  }

  private fun prefs(c: Context) = c.getSharedPreferences("daymark_garmin_beta", Context.MODE_PRIVATE)
  fun enabled(c: Context) = prefs(c).getString("device", null) != null

  private fun <T> onMain(action: () -> T): T {
    if (Looper.myLooper() == Looper.getMainLooper()) return action()
    val result = CompletableFuture<T>()
    main.post { try { result.complete(action()) } catch (e: Exception) { result.completeExceptionally(e) } }
    return result.get(8, TimeUnit.SECONDS)
  }

  fun status(c: Context): Map<String, Any?> = onMain {
    start(c)
    val selected = prefs(c).getString("device", null)
    val selectedDevice = devices.find { it.deviceIdentifier.toString() == selected }
    val connected = selectedDevice?.let { runCatching { sdk?.getDeviceStatus(it) == IQDevice.IQDeviceStatus.CONNECTED }.getOrDefault(false) } ?: false
    val state = when {
      selected == null -> "disabled"
      error != null -> "error"
      !ready -> "starting"
      !connected -> "disconnected"
      installed[selectedDevice!!.deviceIdentifier] == false -> "app-missing"
      installed[selectedDevice.deviceIdentifier] != true -> "checking-app"
      revision > 0 && revision == confirmedRevision -> "confirmed"
      attempts >= 3 && SystemClock.elapsedRealtime() - lastAttempt >= 15000 -> "unconfirmed"
      else -> "sending"
    }
    mapOf("supported" to true, "enabled" to (selected != null), "ready" to ready,
      "selectedDeviceId" to selected, "units" to prefs(c).getString("units", "mmol/L"),
      "backgroundSyncEnabled" to DaymarkGlucoseDisplayState.enabled(c),
      "state" to state, "error" to error, "confirmedAt" to confirmedAt, "route" to route,
      "devices" to devices.map { d -> mapOf("id" to d.deviceIdentifier.toString(), "name" to d.friendlyName,
        "connected" to runCatching { sdk?.getDeviceStatus(d) == IQDevice.IQDeviceStatus.CONNECTED }.getOrDefault(false)) })
  }

  fun select(c: Context, deviceId: String, units: String): Map<String, Any?> = onMain {
    require(units == "mmol/L" || units == "mg/dL")
    start(c)
    if (deviceId.isEmpty()) {
      log(GarminDiagnosticKind.SYNC_DISABLED)
      prefs(c).edit().remove("device").apply()
      main.removeCallbacks(tick)
      runCatching { sdk?.shutdown(c.applicationContext) }
      sdk = null; ready = false; initializing = false
      registered.clear(); installed.clear()
      resetDelivery()
    } else {
      require(DaymarkGlucoseDisplayState.enabled(c)) { "In T1 Arc Garmin Beta on your phone, open Sources > Displays & watch > Glucose at a glance and turn on Keep glucose visible for background sync." }
      require(devices.any { it.deviceIdentifier.toString() == deviceId }) { "Check Garmin Connect for the paired watch, then refresh." }
      prefs(c).edit().putString("device", deviceId).putString("units", units).apply()
      log(GarminDiagnosticKind.SYNC_ENABLED)
      resetDelivery()
      updateDesired(c)
      lastDiscovery = 0L
      main.removeCallbacks(tick); main.post(tick)
      DaymarkGlucoseDisplayService.ensureRunning(c)
    }
    // Do not restart the SDK when turning sync off.
    mapOf("enabled" to enabled(c))
  }

  fun changed(c: Context) {
    if (!enabled(c)) return
    main.post {
      try { start(c); updateDesired(c) }
      catch (_: Exception) { log(GarminDiagnosticKind.STORAGE_ERROR); error = "Could not save the watch update. Open T1 Arc and try again." }
    }
  }

  fun retry(c: Context) = onMain {
    DaymarkGarminDiagnostics.record(c, GarminDiagnosticKind.RETRY)
    error = null
    start(c)
    resetDelivery(); installed.clear(); lastDiscovery = 0L
    if (enabled(c)) updateDesired(c)
    main.removeCallbacks(tick); main.post(tick)
    true
  }

  private fun resetDelivery() {
    timeoutLogged = false
    sentRevision = 0; confirmedRevision = 0; attempts = 0; confirmedAt = 0; route = ""
  }

  private fun start(c: Context) {
    context = c.applicationContext
    if (ready || initializing || error != null) return
    try {
      c.packageManager.getPackageInfo("com.garmin.android.apps.connectmobile", 0)
    } catch (_: android.content.pm.PackageManager.NameNotFoundException) {
      log(GarminDiagnosticKind.CONNECT_MISSING)
      error = "Install Garmin Connect and pair your watch, then check again."
      return
    }
    initializing = true; error = null
    log(GarminDiagnosticKind.SDK_START)
    sdk = ConnectIQ.getInstance(context, ConnectIQ.IQConnectType.WIRELESS)
    sdk!!.initialize(context, false, object : ConnectIQ.ConnectIQListener {
      override fun onSdkReady() { main.post {
        initializing = false; ready = true; error = null
        log(GarminDiagnosticKind.SDK_READY)
        registered.clear(); installed.clear(); lastDiscovery = 0L
        if (enabled(c)) updateDesired(c)
        main.removeCallbacks(tick); main.post(tick)
      } }
      override fun onInitializeError(status: ConnectIQ.IQSdkErrorStatus) { main.post {
        initializing = false; ready = false
        log(GarminDiagnosticKind.SDK_ERROR)
        error = "Garmin Connect is unavailable ($status). Install or update it, pair the watch, then check again."
      } }
      override fun onSdkShutDown() { main.post { log(GarminDiagnosticKind.SDK_SHUTDOWN); initializing = false; ready = false; resetDelivery() } }
    })
  }

  private fun updateDesired(c: Context) {
    val snapshot = DaymarkGlucoseDisplayState.snapshot(c)
    val p = prefs(c)
    val content = linkedMapOf<String, Any>("kind" to "t1arc.glucose", "schemaVersion" to 1,
      "available" to (snapshot != null), "units" to (p.getString("units", "mmol/L") ?: "mmol/L"))
    if (snapshot != null) content.putAll(mapOf("mmolL" to snapshot.mmolL, "timestampMs" to snapshot.timestampMs,
      "trend" to snapshot.trend.takeIf { it in setOf("doubleDown", "down", "slightDown", "flat", "slightUp", "up", "doubleUp") }.orEmpty().ifEmpty { "unknown" },
      "sourceHasError" to snapshot.sourceHasError))
    val json = JSONObject(content).toString()
    // Keep glucose out of plain preferences and logs. Persist content and revision atomically.
    val stored = if (desired == null) GarminBetaCipher.read(c) else null
    val oldContent = desired?.filterKeys { it != "revision" }?.let { JSONObject(it).toString() } ?: stored?.optString("content")
    revision = if (json == oldContent) {
      if (desired != null) revision else stored!!.getLong("revision")
    } else {
      maxOf(System.currentTimeMillis(), p.getLong("revision", 0) + 1)
    }
    if (json != oldContent) {
      GarminBetaCipher.write(c, JSONObject().put("content", json).put("revision", revision))
      p.edit().putLong("revision", revision).commit()
      resetDelivery()
      log(GarminDiagnosticKind.UPDATE_QUEUED, revision)
    }
    desired = content + ("revision" to revision)
  }

  private val tick = object : Runnable {
    override fun run() {
      val c = context ?: return
      if (!ready) return
      try {
        val client = sdk ?: return
        val now = SystemClock.elapsedRealtime()
        if (now - lastDiscovery >= 30000 || lastDiscovery == 0L) {
          lastDiscovery = now
          devices = client.knownDevices ?: emptyList()
          devices.forEach { d ->
            if (registered.add(d.deviceIdentifier)) client.registerForDeviceEvents(d) { device, state -> main.post {
              if (device.deviceIdentifier.toString() == prefs(c).getString("device", null)) {
                log(if (state == IQDevice.IQDeviceStatus.CONNECTED) GarminDiagnosticKind.WATCH_CONNECTED else GarminDiagnosticKind.WATCH_DISCONNECTED)
                error = null
                resetDelivery(); installed.remove(device.deviceIdentifier); lastDiscovery = 0L
                if (state == IQDevice.IQDeviceStatus.CONNECTED) updateDesired(c)
              }
            } }
          }
        }
        val selected = devices.find { it.deviceIdentifier.toString() == prefs(c).getString("device", null) }
        if (selected != null && client.getDeviceStatus(selected) == IQDevice.IQDeviceStatus.CONNECTED) {
          val id = selected.deviceIdentifier
          if (!installed.containsKey(id)) {
            installed[id] = false
            client.getApplicationInfo(APP_ID, selected, object : ConnectIQ.IQApplicationInfoListener {
              override fun onApplicationInfoReceived(info: IQApp?) { main.post {
                installed[id] = info?.status == IQApp.IQAppStatus.INSTALLED
                if (id.toString() == prefs(c).getString("device", null)) log(if (installed[id] == true) GarminDiagnosticKind.APP_FOUND else GarminDiagnosticKind.APP_MISSING)
                if (installed[id] == true) client.registerForAppEvents(selected, app) { d, _, messages, status -> main.post {
                  if (status == ConnectIQ.IQMessageStatus.SUCCESS && d.deviceIdentifier.toString() == prefs(c).getString("device", null)) {
                    messages?.filterIsInstance<Map<*, *>>()?.forEach { ack ->
                      if (ack["kind"] == "t1arc.ack" && (ack["schemaVersion"] as? Number)?.toInt() == 1 &&
                        (ack["revision"] as? Number)?.toLong() == revision && sentRevision == revision &&
                        ack["route"] in setOf("foreground", "background")) {
                        confirmedRevision = revision; confirmedAt = System.currentTimeMillis(); route = ack["route"].toString(); error = null
                        log(if (route == "background") GarminDiagnosticKind.ACK_BACKGROUND else GarminDiagnosticKind.ACK_FOREGROUND, revision)
                      }
                    }
                  }
                } }
              } }
              override fun onApplicationNotInstalled(applicationId: String?) { main.post {
                installed[id] = false
                if (id.toString() == prefs(c).getString("device", null)) log(GarminDiagnosticKind.APP_MISSING)
              } }
            })
          }
          if (installed[id] == true && desired != null && confirmedRevision != revision && attempts < 3 &&
            (sentRevision != revision || now - lastAttempt >= 15000)) {
            val sending = revision
            sentRevision = sending; attempts++; lastAttempt = now
            val sendingAttempt = attempts
            log(GarminDiagnosticKind.SEND_ATTEMPT, sending, sendingAttempt)
            client.sendMessage(selected, app, desired!!.toMap()) { _, _, status -> main.post {
              log(if (status == ConnectIQ.IQMessageStatus.SUCCESS) GarminDiagnosticKind.SEND_ACCEPTED else GarminDiagnosticKind.SEND_FAILED, sending, sendingAttempt)
              if (sending == revision && status != ConnectIQ.IQMessageStatus.SUCCESS) error = "Watch delivery is unconfirmed ($status)."
            } }
          }
        }
        if (attempts >= 3 && confirmedRevision != revision && now - lastAttempt >= 15000 && !timeoutLogged) {
          timeoutLogged = true
          log(GarminDiagnosticKind.ACK_TIMEOUT, revision, attempts)
        }
      } catch (_: Exception) { log(GarminDiagnosticKind.CONNECTION_ERROR); error = "Garmin connection unavailable. Open Garmin Connect, then check again." }
      main.postDelayed(this, 3000)
    }
  }
}

private object GarminBetaCipher {
  private fun key(): SecretKey {
    val alias = "daymark_garmin_beta_v1"
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(alias, null) as? SecretKey)?.let { return it }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
      init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
    }.generateKey()
  }
  fun write(c: Context, data: JSONObject) {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
    check(c.getSharedPreferences("daymark_garmin_beta", Context.MODE_PRIVATE).edit()
      .putString("payload", Base64.encodeToString(cipher.doFinal(data.toString().toByteArray()), Base64.NO_WRAP))
      .putString("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP)).commit())
  }
  fun read(c: Context): JSONObject? = runCatching {
    val p = c.getSharedPreferences("daymark_garmin_beta", Context.MODE_PRIVATE)
    val payload = p.getString("payload", null) ?: return null
    val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
      init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(p.getString("iv", ""), Base64.NO_WRAP)))
    }
    JSONObject(String(cipher.doFinal(Base64.decode(payload, Base64.NO_WRAP)), Charsets.UTF_8))
  }.getOrNull()
}
