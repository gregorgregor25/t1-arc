package app.daymark.glooko

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.WebStorage
import java.security.KeyStore
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull

/** Erases credentials and browser state left by the retired WebView connector. */
internal object GlookoLegacyPrivacyCleanup {
  private const val LEGACY_SESSION_PREFERENCES = "t1arc_glooko_session_v1"
  private const val LEGACY_SESSION_KEY_ALIAS = "t1arc_glooko_session_v1"
  private const val MIGRATION_PREFERENCES = "t1arc_glooko_privacy_migrations"
  // v2 also removes raw ZIP/CSV/PDF files created by the retired connector.
  // A new marker is required because some upgraded devices already completed
  // the earlier cookie-only migration.
  private const val RETIRED_WEBVIEW_CLEARED = "retired_webview_v2_cleared"
  private const val CLEANUP_TIMEOUT_MS = 10_000L

  private val coordinatorLock = Any()
  private var coordinator: LegacyPrivacyCleanupCoordinator? = null

  private fun coordinator(context: Context): LegacyPrivacyCleanupCoordinator =
    synchronized(coordinatorLock) {
      coordinator
        ?: buildCoordinator(context.applicationContext).also {
          coordinator = it
        }
    }

  private fun buildCoordinator(
    applicationContext: Context,
  ): LegacyPrivacyCleanupCoordinator {
    val migrations =
      applicationContext.getSharedPreferences(
        MIGRATION_PREFERENCES,
        Context.MODE_PRIVATE,
      )
    return LegacyPrivacyCleanupCoordinator(
      marker =
        object : LegacyPrivacyMigrationMarker {
          override fun isComplete() =
            migrations.getBoolean(RETIRED_WEBVIEW_CLEARED, false)

          override fun markComplete() =
            migrations
              .edit()
              .putBoolean(RETIRED_WEBVIEW_CLEARED, true)
              .commit()
        },
      work = LegacyPrivacyCleanupWork { onComplete ->
        clearRetiredState(applicationContext, onComplete)
      },
    )
  }

  /** Runs once after upgrading from the retired WebView connector. */
  fun migrate(context: Context) {
    coordinator(context).migrate()
  }

  /** Explicit user/data reset: always requests a full wipe and awaits it. */
  suspend fun clear(context: Context): Boolean {
    val result = CompletableDeferred<Boolean>()
    coordinator(context).forceClear { succeeded -> result.complete(succeeded) }
    return withTimeoutOrNull(CLEANUP_TIMEOUT_MS + 1_000L) {
      result.await()
    } ?: false
  }

  private fun clearRetiredState(
    applicationContext: Context,
    onComplete: (Boolean) -> Unit,
  ) {
    val preferencesCleared =
      applicationContext
        .getSharedPreferences(
          LEGACY_SESSION_PREFERENCES,
          Context.MODE_PRIVATE,
        )
        .edit()
        .clear()
        .commit()
    val keyCleared =
      runCatching {
        KeyStore.getInstance("AndroidKeyStore")
          .apply {
            load(null)
            if (containsAlias(LEGACY_SESSION_KEY_ALIAS)) {
              deleteEntry(LEGACY_SESSION_KEY_ALIAS)
            }
          }
      }.isSuccess
    val retiredDownloadsCleared =
      GlookoDirectExporter.clearRetiredDownloads(applicationContext)

    val mainHandler = Handler(Looper.getMainLooper())
    val completed = AtomicBoolean(false)
    fun completeOnce(succeeded: Boolean) {
      if (completed.compareAndSet(false, true)) onComplete(succeeded)
    }
    val clearBrowserState =
      Runnable {
        try {
          val cookies = CookieManager.getInstance()
          mainHandler.postDelayed(
            { completeOnce(false) },
            CLEANUP_TIMEOUT_MS,
          )
          cookies.removeAllCookies {
            // The Boolean only says whether cookies existed. Delivery of this
            // callback confirms that removal has completed, including the
            // valid "there were no cookies" case.
            val browserCleared =
              runCatching {
                cookies.flush()
                WebStorage.getInstance().deleteAllData()
              }.isSuccess
            completeOnce(
              preferencesCleared &&
                keyCleared &&
                retiredDownloadsCleared &&
                browserCleared,
            )
          }
        } catch (_: Throwable) {
          completeOnce(false)
        }
      }
    if (Looper.myLooper() == Looper.getMainLooper()) {
      clearBrowserState.run()
    } else if (!mainHandler.post(clearBrowserState)) {
      completeOnce(false)
    }
  }
}
