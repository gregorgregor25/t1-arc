package io.github.gregorgregor25.t1arc.glooko

import android.content.Context
import java.time.ZoneId

internal class GlookoRegionalPreferences(context: Context) {
  companion object {
    private const val PREFERENCES = "t1arc_glooko_regional_v1"
    private const val TIME_ZONE = "time_zone"
    private const val REGION = "region"
  }

  private val preferences =
    context.applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

  fun save(
    timeZone: String,
    region: GlookoRegion,
  ) {
    val validatedTimeZone = ZoneId.of(timeZone).id
    check(
      preferences.edit()
        .putString(TIME_ZONE, validatedTimeZone)
        .putString(REGION, region.name.lowercase())
        .commit(),
    ) {
      "Android could not retain the Glooko regional settings."
    }
  }

  fun timeZone(): ZoneId =
    runCatching {
      ZoneId.of(preferences.getString(TIME_ZONE, null) ?: ZoneId.systemDefault().id)
    }.getOrDefault(ZoneId.systemDefault())

  fun region(): GlookoRegion =
    runCatching {
      GlookoRegion.valueOf(
        preferences.getString(REGION, GlookoRegion.EU.name).orEmpty().uppercase(),
      )
    }.getOrDefault(GlookoRegion.EU)

  fun dateOrderLabel(): String =
    if (region() == GlookoRegion.US) "month/day/year" else "day/month/year"
}
