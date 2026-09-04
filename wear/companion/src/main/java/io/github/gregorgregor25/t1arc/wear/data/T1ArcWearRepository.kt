package io.github.gregorgregor25.t1arc.wear.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.util.concurrent.CopyOnWriteArraySet
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONArray
import org.json.JSONObject

private const val PREFERENCES_NAME = "t1arc_wear_secure_state"
private const val PAYLOAD_KEY = "glucose_payload"
private const val IV_KEY = "glucose_iv"
private const val HISTORY_PAYLOAD_KEY = "glucose_history_payload"
private const val HISTORY_IV_KEY = "glucose_history_iv"
private const val WRITE_EPOCH_KEY = "local_data_write_epoch_v1"
private const val KEY_ALIAS = "t1arc.wear.glucose.v1"
private const val MAX_HISTORY_POINTS = 144

class T1ArcWearRepository private constructor(private val context: Context) {
    @Volatile private var memorySnapshot: GlucoseSnapshot? = null
    @Volatile private var memoryHistory: List<GlucoseHistoryPoint>? = null
    private val listeners = CopyOnWriteArraySet<(GlucoseSnapshot?) -> Unit>()
    private val historyListeners =
        CopyOnWriteArraySet<(List<GlucoseHistoryPoint>) -> Unit>()

    @Synchronized
    fun snapshot(): GlucoseSnapshot? {
        memorySnapshot?.let { return it }
        val preferences =
            context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
        val payload = preferences.getString(PAYLOAD_KEY, null) ?: return null
        val iv = preferences.getString(IV_KEY, null) ?: return null
        return decrypt(payload, iv)?.takeIf(::isValid)?.also { memorySnapshot = it }
    }

    @Synchronized
    fun save(snapshot: GlucoseSnapshot): Boolean {
        if (!isValid(snapshot)) return false
        if (snapshot() == snapshot) return false
        val persisted =
            runCatching {
            val (payload, iv) = encrypt(snapshot)
            context
                .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(PAYLOAD_KEY, payload)
                .putString(IV_KEY, iv)
                .commit()
            }.getOrDefault(false)
        if (!persisted) {
            memorySnapshot = null
            clearPersisted()
            return false
        }
        memorySnapshot = snapshot
        listeners.forEach { it(snapshot) }
        return true
    }

    @Synchronized
    fun history(): List<GlucoseHistoryPoint> {
        memoryHistory?.let { return it }
        val preferences =
            context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
        val payload = preferences.getString(HISTORY_PAYLOAD_KEY, null) ?: return emptyList()
        val iv = preferences.getString(HISTORY_IV_KEY, null) ?: return emptyList()
        return decryptHistory(payload, iv).also { memoryHistory = it }
    }

    @Synchronized
    fun saveHistory(readings: List<GlucoseHistoryPoint>): Boolean {
        val normalised =
            readings
                .asSequence()
                .filter(::isValid)
                .distinctBy(GlucoseHistoryPoint::timestampMs)
                .sortedBy(GlucoseHistoryPoint::timestampMs)
                .toList()
                .takeLast(MAX_HISTORY_POINTS)
        if (normalised.isEmpty()) return clearHistory()
        if (history() == normalised) return false
        val persisted =
            runCatching {
            val (payload, iv) = encryptHistory(normalised)
            context
                .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(HISTORY_PAYLOAD_KEY, payload)
                .putString(HISTORY_IV_KEY, iv)
                .commit()
            }.getOrDefault(false)
        if (!persisted) {
            memoryHistory = null
            clearPersistedHistory()
            return false
        }
        memoryHistory = normalised
        historyListeners.forEach { it(normalised) }
        return true
    }

    @Synchronized
    fun clear(): Boolean {
        val existed =
            memorySnapshot != null ||
                context
                    .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
                    .contains(PAYLOAD_KEY)
        memorySnapshot = null
        clearPersisted()
        if (existed) listeners.forEach { it(null) }
        return existed
    }

    @Synchronized
    fun clearHistory(): Boolean {
        val existed =
            !memoryHistory.isNullOrEmpty() ||
                context
                    .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
                    .contains(HISTORY_PAYLOAD_KEY)
        memoryHistory = emptyList()
        clearPersistedHistory()
        if (existed) historyListeners.forEach { it(emptyList()) }
        return existed
    }

    /**
     * Accepts and persists an epoch together with the mutation it authorises.
     * A newer epoch first removes both private categories in one synchronous
     * preferences commit, so process death cannot expose bytes from the prior
     * epoch while the second Data Layer item is still in flight.
     */
    @Synchronized
    fun saveForWriteEpoch(snapshot: GlucoseSnapshot, incomingEpoch: Long): Boolean {
        if (!isValid(snapshot)) return false
        if (advanceWriteEpoch(incomingEpoch) == null) return false
        return save(snapshot)
    }

    @Synchronized
    fun clearForWriteEpoch(incomingEpoch: Long): Boolean {
        val advanced = advanceWriteEpoch(incomingEpoch) ?: return false
        return clear() || advanced
    }

    @Synchronized
    fun saveHistoryForWriteEpoch(
        readings: List<GlucoseHistoryPoint>,
        incomingEpoch: Long,
    ): Boolean {
        if (!readings.all(::isValid)) return false
        val advanced = advanceWriteEpoch(incomingEpoch) ?: return false
        if (readings.isEmpty()) return clearHistory() || advanced
        return saveHistory(readings)
    }

    fun addListener(listener: (GlucoseSnapshot?) -> Unit) {
        listeners.add(listener)
    }

    fun removeListener(listener: (GlucoseSnapshot?) -> Unit) {
        listeners.remove(listener)
    }

    fun addHistoryListener(listener: (List<GlucoseHistoryPoint>) -> Unit) {
        historyListeners.add(listener)
    }

    fun removeHistoryListener(listener: (List<GlucoseHistoryPoint>) -> Unit) {
        historyListeners.remove(listener)
    }

    private fun advanceWriteEpoch(incomingEpoch: Long): Boolean? {
        val resolved =
            WearPrivacyEpochPolicy.validIncomingEpoch(incomingEpoch)
                ?: return null
        val preferences =
            context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
        val current =
            runCatching { preferences.getLong(WRITE_EPOCH_KEY, 0L) }
                .getOrNull()
                ?.takeIf { it >= 0L }
                ?: return null
        when (WearPrivacyEpochPolicy.transition(current, resolved)) {
            WearPrivacyEpochPolicy.Transition.REJECT -> return null
            WearPrivacyEpochPolicy.Transition.ACCEPT_CURRENT -> return false
            WearPrivacyEpochPolicy.Transition.ADVANCE_AND_CLEAR_PRIVATE_STATE -> Unit
        }

        val hadSnapshot = memorySnapshot != null || preferences.contains(PAYLOAD_KEY)
        val hadHistory = !memoryHistory.isNullOrEmpty() || preferences.contains(HISTORY_PAYLOAD_KEY)
        val committed =
            preferences
                .edit()
                .putLong(WRITE_EPOCH_KEY, resolved)
                .remove(PAYLOAD_KEY)
                .remove(IV_KEY)
                .remove(HISTORY_PAYLOAD_KEY)
                .remove(HISTORY_IV_KEY)
                .commit()
        if (!committed) return null

        memorySnapshot = null
        memoryHistory = emptyList()
        if (hadSnapshot) listeners.forEach { it(null) }
        if (hadHistory) historyListeners.forEach { it(emptyList()) }
        return true
    }

    private fun clearPersisted(): Boolean =
        context
            .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
            .edit()
            .remove(PAYLOAD_KEY)
            .remove(IV_KEY)
            .commit()

    private fun clearPersistedHistory(): Boolean =
        context
            .getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
            .edit()
            .remove(HISTORY_PAYLOAD_KEY)
            .remove(HISTORY_IV_KEY)
            .commit()

    private fun isValid(snapshot: GlucoseSnapshot): Boolean =
        snapshot.mmolL.isFinite() &&
            snapshot.mmolL in 0.5..40.0 &&
            snapshot.timestampMs > 0L

    private fun isValid(point: GlucoseHistoryPoint): Boolean =
        point.mmolL.isFinite() &&
            point.mmolL in 0.5..40.0 &&
            point.timestampMs > 0L

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator
            .getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            .apply {
                init(
                    KeyGenParameterSpec
                        .Builder(
                            KEY_ALIAS,
                            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                        )
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setRandomizedEncryptionRequired(true)
                        .build(),
                )
            }
            .generateKey()
    }

    private fun encrypt(snapshot: GlucoseSnapshot): Pair<String, String> {
        val bytes =
            JSONObject()
                .put("mmolL", snapshot.mmolL)
                .put("trend", snapshot.trend)
                .put("trendOrigin", snapshot.trendOrigin)
                .put("timestampMs", snapshot.timestampMs)
                .put("sourceLabel", snapshot.sourceLabel)
                .put("sourceHasError", snapshot.sourceHasError)
                .put("category", snapshot.category)
                .put("colorToken", snapshot.colorToken)
                .put("staleColorToken", snapshot.staleColorToken)
                .put("glucoseUnit", snapshot.glucoseUnit)
                .put("localeTag", snapshot.localeTag)
                .put("timeZone", snapshot.timeZone)
                .toString()
                .toByteArray(Charsets.UTF_8)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        return Base64.encodeToString(cipher.doFinal(bytes), Base64.NO_WRAP) to
            Base64.encodeToString(cipher.iv, Base64.NO_WRAP)
    }

    private fun decrypt(payload: String, iv: String): GlucoseSnapshot? =
        runCatching {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(
                Cipher.DECRYPT_MODE,
                secretKey(),
                GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)),
            )
            val json =
                JSONObject(
                    cipher
                        .doFinal(Base64.decode(payload, Base64.NO_WRAP))
                        .toString(Charsets.UTF_8),
                )
            GlucoseSnapshot(
                mmolL = json.getDouble("mmolL"),
                trend = json.optString("trend", "unknown"),
                trendOrigin = json.optString("trendOrigin", "source"),
                timestampMs = json.getLong("timestampMs"),
                sourceLabel = json.optString("sourceLabel", "T1 Arc"),
                sourceHasError = json.optBoolean("sourceHasError", false),
                category = json.optString("category", "stale"),
                colorToken = json.optString("colorToken", "slate"),
                staleColorToken = json.optString("staleColorToken", "slate"),
                glucoseUnit = json.optString("glucoseUnit", "mmolL"),
                localeTag = json.optString("localeTag", "en-GB"),
                timeZone = json.optString("timeZone", "Europe/London"),
            )
        }.getOrNull()

    private fun encryptHistory(
        readings: List<GlucoseHistoryPoint>,
    ): Pair<String, String> {
        val array = JSONArray()
        readings.forEach { point ->
            array.put(
                JSONObject()
                    .put("mmolL", point.mmolL)
                    .put("timestampMs", point.timestampMs)
                    .put("colorToken", point.colorToken),
            )
        }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        return Base64.encodeToString(
            cipher.doFinal(array.toString().toByteArray(Charsets.UTF_8)),
            Base64.NO_WRAP,
        ) to Base64.encodeToString(cipher.iv, Base64.NO_WRAP)
    }

    private fun decryptHistory(payload: String, iv: String): List<GlucoseHistoryPoint> =
        runCatching {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(
                Cipher.DECRYPT_MODE,
                secretKey(),
                GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)),
            )
            val array =
                JSONArray(
                    cipher
                        .doFinal(Base64.decode(payload, Base64.NO_WRAP))
                        .toString(Charsets.UTF_8),
                )
            buildList {
                for (index in 0 until array.length()) {
                    val item = array.getJSONObject(index)
                    val point =
                        GlucoseHistoryPoint(
                            mmolL = item.getDouble("mmolL"),
                            timestampMs = item.getLong("timestampMs"),
                            colorToken = item.optString("colorToken", "cyan"),
                        )
                    if (isValid(point)) add(point)
                }
            }
                .distinctBy(GlucoseHistoryPoint::timestampMs)
                .sortedBy(GlucoseHistoryPoint::timestampMs)
                .takeLast(MAX_HISTORY_POINTS)
        }.getOrDefault(emptyList())

    companion object {
        @Volatile private var instance: T1ArcWearRepository? = null

        fun get(context: Context): T1ArcWearRepository =
            instance ?: synchronized(this) {
                instance ?: T1ArcWearRepository(context.applicationContext).also {
                    instance = it
                }
            }
    }
}
