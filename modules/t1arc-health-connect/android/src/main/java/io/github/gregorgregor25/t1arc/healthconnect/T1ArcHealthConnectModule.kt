package io.github.gregorgregor25.t1arc.healthconnect

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.result.contract.ActivityResultContract
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.changes.DeletionChange
import androidx.health.connect.client.changes.UpsertionChange
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.BasalBodyTemperatureRecord
import androidx.health.connect.client.records.BasalMetabolicRateRecord
import androidx.health.connect.client.records.BodyFatRecord
import androidx.health.connect.client.records.BodyTemperatureRecord
import androidx.health.connect.client.records.BodyWaterMassRecord
import androidx.health.connect.client.records.BoneMassRecord
import androidx.health.connect.client.records.BloodGlucoseRecord
import androidx.health.connect.client.records.BloodPressureRecord
import androidx.health.connect.client.records.CervicalMucusRecord
import androidx.health.connect.client.records.CyclingPedalingCadenceRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ElevationGainedRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.FloorsClimbedRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.HeightRecord
import androidx.health.connect.client.records.HydrationRecord
import androidx.health.connect.client.records.IntermenstrualBleedingRecord
import androidx.health.connect.client.records.LeanBodyMassRecord
import androidx.health.connect.client.records.MenstruationFlowRecord
import androidx.health.connect.client.records.MenstruationPeriodRecord
import androidx.health.connect.client.records.NutritionRecord
import androidx.health.connect.client.records.OxygenSaturationRecord
import androidx.health.connect.client.records.OvulationTestRecord
import androidx.health.connect.client.records.PowerRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RespiratoryRateRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.SpeedRecord
import androidx.health.connect.client.records.StepsCadenceRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.records.Vo2MaxRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.records.metadata.DataOrigin
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.request.ChangesTokenRequest
import androidx.health.connect.client.response.ReadRecordsResponse
import androidx.health.connect.client.time.TimeRangeFilter
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.Serializable
import java.time.Instant
import kotlin.reflect.KClass

private const val PROVIDER_PACKAGE = "com.google.android.apps.healthdata"
private const val PAGE_SIZE = 500
private val KNOWN_SOURCE_LABELS =
  mapOf(
    "com.sec.android.app.shealth" to "Samsung Health",
    "nl.appyhapps.healthsync" to "Health Sync",
    "com.renpho.health" to "Renpho Health",
    "com.google.android.apps.fitness" to "Google Fit",
    "com.fitbit.FitbitMobile" to "Fitbit",
    "com.withings.wiscale2" to "Withings",
    "com.garmin.android.apps.connectmobile" to "Garmin Connect",
    "com.ouraring.oura" to "Oura",
    "com.strava" to "Strava",
    "fi.polar.polarflow" to "Polar Flow",
  )

private val categoryRecordTypes: Map<String, Set<KClass<out Record>>> =
  linkedMapOf(
    "steps" to setOf(StepsRecord::class),
    "distance" to
      setOf(
        DistanceRecord::class,
        ElevationGainedRecord::class,
        FloorsClimbedRecord::class,
      ),
    "active_calories" to
      setOf(
        ActiveCaloriesBurnedRecord::class,
        TotalCaloriesBurnedRecord::class,
      ),
    "workouts" to
      setOf(
        ExerciseSessionRecord::class,
        PowerRecord::class,
        SpeedRecord::class,
        StepsCadenceRecord::class,
        CyclingPedalingCadenceRecord::class,
      ),
    "heart_rate" to setOf(HeartRateRecord::class, RestingHeartRateRecord::class),
    "sleep" to setOf(SleepSessionRecord::class),
    "weight" to setOf(WeightRecord::class),
    "body_composition" to
      setOf(
        BodyFatRecord::class,
        LeanBodyMassRecord::class,
        BodyWaterMassRecord::class,
        BoneMassRecord::class,
        HeightRecord::class,
        BasalMetabolicRateRecord::class,
      ),
    "blood_glucose" to setOf(BloodGlucoseRecord::class),
    "vitals" to
      setOf(
        BloodPressureRecord::class,
        OxygenSaturationRecord::class,
        RespiratoryRateRecord::class,
        HeartRateVariabilityRmssdRecord::class,
        Vo2MaxRecord::class,
        BodyTemperatureRecord::class,
      ),
    "cycle" to
      setOf(
        MenstruationPeriodRecord::class,
        MenstruationFlowRecord::class,
        OvulationTestRecord::class,
        BasalBodyTemperatureRecord::class,
        CervicalMucusRecord::class,
        IntermenstrualBleedingRecord::class,
      ),
    "hydration" to setOf(HydrationRecord::class),
    "nutrition" to setOf(NutritionRecord::class),
  )

private data class PermissionRequest(val permissions: HashSet<String>) : Serializable

private data class FlowRequest(
  val kind: String,
) : Serializable

private data class FlowResult(val completed: Boolean)

private class HealthPermissionContract :
  AppContextActivityResultContract<PermissionRequest, Set<String>> {
  private val delegate: ActivityResultContract<Set<String>, Set<String>> =
    PermissionController.createRequestPermissionResultContract()

  override fun createIntent(context: Context, input: PermissionRequest): Intent =
    delegate.createIntent(context, input.permissions)

  override fun parseResult(
    input: PermissionRequest,
    resultCode: Int,
    intent: Intent?,
  ): Set<String> = delegate.parseResult(resultCode, intent)
}

private class HealthFlowContract :
  AppContextActivityResultContract<FlowRequest, FlowResult> {
  override fun createIntent(context: Context, input: FlowRequest): Intent {
    return when (input.kind) {
      "install" -> {
        val marketIntent =
          Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$PROVIDER_PACKAGE"))
        if (marketIntent.resolveActivity(context.packageManager) != null) {
          marketIntent
        } else {
          Intent(
            Intent.ACTION_VIEW,
            Uri.parse("https://play.google.com/store/apps/details?id=$PROVIDER_PACKAGE"),
          )
        }
      }
      else -> Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS)
    }
  }

  override fun parseResult(
    input: FlowRequest,
    resultCode: Int,
    intent: Intent?,
  ): FlowResult = FlowResult(completed = resultCode == Activity.RESULT_OK)
}

class T1ArcHealthConnectModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("T1ArcHealthConnect")

    lateinit var permissionLauncher:
      AppContextActivityResultLauncher<PermissionRequest, Set<String>>
    lateinit var flowLauncher:
      AppContextActivityResultLauncher<FlowRequest, FlowResult>

    RegisterActivityContracts {
      permissionLauncher = registerForActivityResult(HealthPermissionContract())
      flowLauncher = registerForActivityResult(HealthFlowContract())
    }

    AsyncFunction("getStatusAsync") Coroutine { ->
      val context = requireNotNull(appContext.reactContext)
      statusFor(context)
    }

    AsyncFunction("requestPermissionsAsync") Coroutine {
        categories: List<String>,
        requestHistory: Boolean,
        requestBackground: Boolean,
      ->
      val context = requireNotNull(appContext.reactContext)
      ensureAvailable(context)
      val client = HealthConnectClient.getOrCreate(context)
      val requested = readPermissionsFor(categories).toMutableSet()
      if (requestHistory) {
        requested += HealthPermission.PERMISSION_READ_HEALTH_DATA_HISTORY
      }
      if (
        requestBackground &&
          client.features.getFeatureStatus(
            HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND
          ) == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE
      ) {
        requested += HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND
      }

      permissionLauncher.launch(PermissionRequest(HashSet(requested)))
      statusFor(context)
    }

    AsyncFunction("checkSourceDiscoveryAsync") Coroutine { categories: List<String> ->
      val context = requireNotNull(appContext.reactContext)
      ensureAvailable(context)
      categories.size
      mapOf(
        "available" to false,
        "hasMatches" to false,
        "reason" to "unsupported",
      )
    }

    AsyncFunction("openSourceDiscoveryAsync") Coroutine { categories: List<String> ->
      val context = requireNotNull(appContext.reactContext)
      ensureAvailable(context)
      categories.size
      flowLauncher.launch(FlowRequest(kind = "settings"))
      mapOf("opened" to true, "mode" to "settings")
    }

    AsyncFunction("openSettingsAsync") Coroutine { ->
      flowLauncher.launch(FlowRequest(kind = "settings"))
      true
    }

    AsyncFunction("openInstallAsync") Coroutine { ->
      flowLauncher.launch(FlowRequest(kind = "install"))
      true
    }

    AsyncFunction("readRecordsPageAsync") Coroutine {
        category: String,
        startTimeMs: Double,
        endTimeMs: Double,
        sourcePackages: List<String>,
        pageToken: String?,
      ->
      val context = requireNotNull(appContext.reactContext)
      ensureAvailable(context)
      require(categoryRecordTypes.containsKey(category)) {
        "Unsupported Health Connect category: $category"
      }
      require(startTimeMs < endTimeMs) { "startTimeMs must be before endTimeMs" }

      val client = HealthConnectClient.getOrCreate(context)
      val timeRange =
        TimeRangeFilter.between(
          Instant.ofEpochMilli(startTimeMs.toLong()),
          Instant.ofEpochMilli(endTimeMs.toLong()),
        )
      val origins = sourcePackages.filter(String::isNotBlank).map(::DataOrigin).toSet()
      val page =
        when (category) {
          "steps" ->
            readPage(client, StepsRecord::class, timeRange, origins, pageToken) { record ->
              listOf(
                commonRecord(record.metadata, "steps", record.startTime, record.endTime) +
                  mapOf("value" to record.count.toDouble(), "unit" to "count")
              )
            }
          "distance" ->
            readMovementPage(client, timeRange, origins, pageToken)
          "active_calories" ->
            readCaloriesPage(client, timeRange, origins, pageToken)
          "workouts" ->
            readWorkoutPage(client, timeRange, origins, pageToken)
          "heart_rate" ->
            readHeartRatePage(client, timeRange, origins, pageToken)
          "sleep" ->
            readPage(client, SleepSessionRecord::class, timeRange, origins, pageToken) { record ->
              listOf(
                commonRecord(record.metadata, "sleep", record.startTime, record.endTime) +
                  mapOf(
                    "title" to record.title,
                    "notes" to record.notes,
                    "stages" to
                      record.stages.map { stage ->
                        mapOf(
                          "startTimeMs" to stage.startTime.toEpochMilli().toDouble(),
                          "endTimeMs" to stage.endTime.toEpochMilli().toDouble(),
                          "stageType" to stage.stage,
                        )
                      },
                  )
              )
            }
          "weight" ->
            readPage(client, WeightRecord::class, timeRange, origins, pageToken) { record ->
              listOf(
                commonRecord(record.metadata, "weight", record.time, record.time) +
                  mapOf("value" to record.weight.inKilograms, "unit" to "kg")
              )
            }
          "body_composition" ->
            readBodyCompositionPage(client, timeRange, origins, pageToken)
          "blood_glucose" ->
            readPage(client, BloodGlucoseRecord::class, timeRange, origins, pageToken) { record ->
              listOf(
                commonRecord(record.metadata, "blood_glucose", record.time, record.time) +
                  mapOf(
                    "value" to record.level.inMillimolesPerLiter,
                    "unit" to "mmol/L",
                    "specimenSource" to record.specimenSource,
                    "mealType" to record.mealType,
                    "relationToMeal" to record.relationToMeal,
                  )
              )
            }
          "vitals" ->
            readVitalsPage(client, timeRange, origins, pageToken)
          "cycle" ->
            readCyclePage(client, timeRange, origins, pageToken)
          "hydration" ->
            readPage(client, HydrationRecord::class, timeRange, origins, pageToken) { record ->
              listOf(
                commonRecord(record.metadata, "hydration", record.startTime, record.endTime) +
                  mapOf("value" to record.volume.inLiters, "unit" to "litre")
              )
            }
          "nutrition" ->
            readPage(client, NutritionRecord::class, timeRange, origins, pageToken) { record ->
              listOf(
                commonRecord(record.metadata, "nutrition", record.startTime, record.endTime) +
                  mapOf(
                    "value" to record.totalCarbohydrate?.inGrams,
                    "unit" to "g",
                    "title" to record.name,
                    "mealType" to record.mealType,
                    "energyKcal" to record.energy?.inKilocalories,
                    "proteinGrams" to record.protein?.inGrams,
                    "fatGrams" to record.totalFat?.inGrams,
                    "fibreGrams" to record.dietaryFiber?.inGrams,
                    "sugarGrams" to record.sugar?.inGrams,
                    "saturatedFatGrams" to record.saturatedFat?.inGrams,
                  )
              )
            }
          else -> error("Unsupported Health Connect category: $category")
        }

      val packages =
        page.records
          .mapNotNull { it["sourcePackage"] as? String }
          .filter(String::isNotBlank)
          .toSet()
      mapOf(
        "records" to page.records,
        "nextPageToken" to page.nextPageToken,
        "sources" to packages.map { sourceDescriptor(context, it) },
      )
    }

    AsyncFunction("getChangesTokenAsync") Coroutine {
        category: String,
        sourcePackages: List<String>,
      ->
      val context = requireNotNull(appContext.reactContext)
      ensureAvailable(context)
      val recordTypes =
        requireNotNull(categoryRecordTypes[category]) {
          "Unsupported Health Connect category: $category"
        }
      val origins = sourcePackages.filter(String::isNotBlank).map(::DataOrigin).toSet()
      HealthConnectClient.getOrCreate(context).getChangesToken(
        ChangesTokenRequest(
          recordTypes = recordTypes,
          dataOriginFilters = origins,
        )
      )
    }

    AsyncFunction("readChangesPageAsync") Coroutine { changesToken: String ->
      val context = requireNotNull(appContext.reactContext)
      ensureAvailable(context)
      require(changesToken.isNotBlank()) { "Health Connect changes token is empty." }
      val response =
        HealthConnectClient.getOrCreate(context).getChanges(
          changesToken,
          PAGE_SIZE,
        )
      val upserted =
        response.changes
          .filterIsInstance<UpsertionChange>()
          .flatMap { change -> normalizeRecord(change.record) }
      val deleted =
        response.changes
          .filterIsInstance<DeletionChange>()
          .map { change -> change.recordId }
      val packages =
        upserted
          .mapNotNull { it["sourcePackage"] as? String }
          .filter(String::isNotBlank)
          .toSet()
      mapOf(
        "upserted" to upserted,
        "deletedRecordIds" to deleted,
        "nextChangesToken" to response.nextChangesToken,
        "hasMore" to response.hasMore,
        "tokenExpired" to response.changesTokenExpired,
        "sources" to packages.map { sourceDescriptor(context, it) },
      )
    }
  }
}

private data class NormalizedPage(
  val records: List<Map<String, Any?>>,
  val nextPageToken: String?,
)

private fun ensureAvailable(context: Context) {
  check(
    HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE
  ) {
    "Health Connect is unavailable or needs an update."
  }
}

private suspend fun statusFor(context: Context): Map<String, Any?> {
  val sdkStatus = HealthConnectClient.getSdkStatus(context)
  val availability =
    when (sdkStatus) {
      HealthConnectClient.SDK_AVAILABLE -> "available"
      HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "update_required"
      else -> "unavailable"
    }
  if (sdkStatus != HealthConnectClient.SDK_AVAILABLE) {
    return mapOf(
      "availability" to availability,
      "sdkStatus" to sdkStatus,
      "historyGranted" to false,
      "backgroundGranted" to false,
      "backgroundAvailable" to false,
      "sourceDiscoveryAvailable" to false,
      "grantedPermissions" to emptyList<String>(),
      "categories" to
        categoryRecordTypes.keys.map {
          mapOf(
            "id" to it,
            "granted" to false,
            "partiallyGranted" to false,
          )
        },
    )
  }

  val client = HealthConnectClient.getOrCreate(context)
  val granted = client.permissionController.getGrantedPermissions()
  val categories =
    categoryRecordTypes.map { (id, recordTypes) ->
      val permissions = recordTypes.map(HealthPermission::getReadPermission)
      val grantedCount = permissions.count(granted::contains)
      mapOf(
        "id" to id,
        "granted" to (grantedCount == permissions.size),
        "partiallyGranted" to (grantedCount in 1 until permissions.size),
      )
    }
  return mapOf(
    "availability" to availability,
    "sdkStatus" to sdkStatus,
    "historyGranted" to
      granted.contains(HealthPermission.PERMISSION_READ_HEALTH_DATA_HISTORY),
    "backgroundGranted" to
      granted.contains(HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND),
    "backgroundAvailable" to
      (
        client.features.getFeatureStatus(
          HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND
        ) == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE
      ),
    "sourceDiscoveryAvailable" to false,
    "grantedPermissions" to granted.sorted(),
    "categories" to categories,
  )
}

private fun recordTypesFor(categories: Collection<String>): Set<KClass<out Record>> =
  categories.ifEmpty { categoryRecordTypes.keys }.flatMap {
    categoryRecordTypes[it].orEmpty()
  }.toSet()

private fun readPermissionsFor(categories: Collection<String>): Set<String> =
  categories
    .flatMap { categoryRecordTypes[it].orEmpty() }
    .map(HealthPermission::getReadPermission)
    .toSet()

private suspend fun <T : Record> readPage(
  client: HealthConnectClient,
  recordType: KClass<T>,
  timeRange: TimeRangeFilter,
  origins: Set<DataOrigin>,
  pageToken: String?,
  normalizer: (T) -> List<Map<String, Any?>>,
): NormalizedPage {
  val response: ReadRecordsResponse<T> =
    client.readRecords(
      ReadRecordsRequest(
        recordType = recordType,
        timeRangeFilter = timeRange,
        dataOriginFilter = origins,
        ascendingOrder = true,
        pageSize = PAGE_SIZE,
        pageToken = pageToken,
      )
    )
  return NormalizedPage(
    records = response.records.flatMap(normalizer),
    nextPageToken = response.pageToken,
  )
}

private suspend fun readMovementPage(
  client: HealthConnectClient,
  timeRange: TimeRangeFilter,
  origins: Set<DataOrigin>,
  pageToken: String?,
): NormalizedPage {
  val stage =
    when {
      pageToken?.startsWith("elevation:") == true -> "elevation"
      pageToken?.startsWith("floors:") == true -> "floors"
      else -> "distance"
    }
  val actualToken = pageToken?.removePrefix("$stage:")?.ifEmpty { null }
  return when (stage) {
    "distance" -> {
      val page =
        readPage(client, DistanceRecord::class, timeRange, origins, actualToken) { record ->
          listOf(
            commonRecord(record.metadata, "distance", record.startTime, record.endTime) +
              mapOf("value" to record.distance.inMeters, "unit" to "m")
          )
        }
      page.copy(nextPageToken = page.nextPageToken?.let { "distance:$it" } ?: "elevation:")
    }
    "elevation" -> {
      val page =
        readPage(client, ElevationGainedRecord::class, timeRange, origins, actualToken) { record ->
          listOf(
            commonRecord(record.metadata, "elevation_gained", record.startTime, record.endTime) +
              mapOf("value" to record.elevation.inMeters, "unit" to "m")
          )
        }
      page.copy(nextPageToken = page.nextPageToken?.let { "elevation:$it" } ?: "floors:")
    }
    else -> {
      val page =
        readPage(client, FloorsClimbedRecord::class, timeRange, origins, actualToken) { record ->
          listOf(
            commonRecord(record.metadata, "floors_climbed", record.startTime, record.endTime) +
              mapOf("value" to record.floors, "unit" to "floors")
          )
        }
      page.copy(nextPageToken = page.nextPageToken?.let { "floors:$it" })
    }
  }
}

private suspend fun readCaloriesPage(
  client: HealthConnectClient,
  timeRange: TimeRangeFilter,
  origins: Set<DataOrigin>,
  pageToken: String?,
): NormalizedPage {
  val readingTotal = pageToken?.startsWith("total:") == true
  val actualToken =
    if (readingTotal) pageToken?.removePrefix("total:")?.ifEmpty { null } else pageToken
  if (!readingTotal) {
    val page =
      readPage(
        client,
        ActiveCaloriesBurnedRecord::class,
        timeRange,
        origins,
        actualToken,
      ) { record ->
        listOf(
          commonRecord(
            record.metadata,
            "active_calories",
            record.startTime,
            record.endTime,
          ) + mapOf("value" to record.energy.inKilocalories, "unit" to "kcal")
        )
        }
    return page.copy(nextPageToken = page.nextPageToken ?: "total:")
  }
  val page =
    readPage(
      client,
      TotalCaloriesBurnedRecord::class,
      timeRange,
      origins,
      actualToken,
    ) { record ->
      listOf(
        commonRecord(
          record.metadata,
          "total_calories",
          record.startTime,
          record.endTime,
        ) + mapOf("value" to record.energy.inKilocalories, "unit" to "kcal")
      )
    }
  return page.copy(nextPageToken = page.nextPageToken?.let { "total:$it" })
}

private suspend fun readWorkoutPage(
  client: HealthConnectClient,
  timeRange: TimeRangeFilter,
  origins: Set<DataOrigin>,
  pageToken: String?,
): NormalizedPage {
  val stage =
    when {
      pageToken?.startsWith("power:") == true -> "power"
      pageToken?.startsWith("speed:") == true -> "speed"
      pageToken?.startsWith("walking-cadence:") == true -> "walking-cadence"
      pageToken?.startsWith("cycling-cadence:") == true -> "cycling-cadence"
      else -> "session"
    }
  val actualToken = pageToken?.removePrefix("$stage:")?.ifEmpty { null }
  return when (stage) {
    "session" -> {
      val page =
        readPage(
          client,
          ExerciseSessionRecord::class,
          timeRange,
          origins,
          actualToken,
        ) { record ->
          listOf(normalizeExerciseSession(record))
        }
      page.copy(nextPageToken = page.nextPageToken?.let { "session:$it" } ?: "power:")
    }
    "power" -> {
      val page =
        readPage(client, PowerRecord::class, timeRange, origins, actualToken) { record ->
          record.samples.map { sample ->
            commonRecord(record.metadata, "workout_power", sample.time, sample.time) +
              mapOf(
                "externalId" to "${record.metadata.id}:${sample.time.toEpochMilli()}",
                "parentExternalId" to record.metadata.id,
                "value" to sample.power.inWatts,
                "unit" to "w",
              )
          }
        }
      page.copy(nextPageToken = page.nextPageToken?.let { "power:$it" } ?: "speed:")
    }
    "speed" -> {
      val page =
        readPage(client, SpeedRecord::class, timeRange, origins, actualToken) { record ->
          record.samples.map { sample ->
            commonRecord(record.metadata, "workout_speed", sample.time, sample.time) +
              mapOf(
                "externalId" to "${record.metadata.id}:${sample.time.toEpochMilli()}",
                "parentExternalId" to record.metadata.id,
                "value" to sample.speed.inMetersPerSecond,
                "unit" to "m/s",
              )
          }
        }
      page.copy(
        nextPageToken = page.nextPageToken?.let { "speed:$it" } ?: "walking-cadence:"
      )
    }
    "walking-cadence" -> {
      val page =
        readPage(client, StepsCadenceRecord::class, timeRange, origins, actualToken) { record ->
          record.samples.map { sample ->
            commonRecord(record.metadata, "walking_cadence", sample.time, sample.time) +
              mapOf(
                "externalId" to "${record.metadata.id}:${sample.time.toEpochMilli()}",
                "parentExternalId" to record.metadata.id,
                "value" to sample.rate,
                "unit" to "rpm",
              )
          }
        }
      page.copy(
        nextPageToken =
          page.nextPageToken?.let { "walking-cadence:$it" } ?: "cycling-cadence:"
      )
    }
    else -> {
      val page =
        readPage(
          client,
          CyclingPedalingCadenceRecord::class,
          timeRange,
          origins,
          actualToken,
        ) { record ->
          record.samples.map { sample ->
            commonRecord(record.metadata, "cycling_cadence", sample.time, sample.time) +
              mapOf(
                "externalId" to "${record.metadata.id}:${sample.time.toEpochMilli()}",
                "parentExternalId" to record.metadata.id,
                "value" to sample.revolutionsPerMinute,
                "unit" to "rpm",
              )
          }
        }
      page.copy(nextPageToken = page.nextPageToken?.let { "cycling-cadence:$it" })
    }
  }
}

private suspend fun readHeartRatePage(
  client: HealthConnectClient,
  timeRange: TimeRangeFilter,
  origins: Set<DataOrigin>,
  pageToken: String?,
): NormalizedPage {
  val readingResting = pageToken?.startsWith("resting:") == true
  val actualToken =
    when {
      pageToken == "resting:" -> null
      readingResting -> pageToken?.removePrefix("resting:")
      else -> pageToken
    }

  if (!readingResting) {
    val heartRate =
      readPage(client, HeartRateRecord::class, timeRange, origins, actualToken) { record ->
        record.samples.map { sample ->
          commonRecord(record.metadata, "heart_rate", sample.time, sample.time) +
            mapOf(
              "externalId" to "${record.metadata.id}:${sample.time.toEpochMilli()}",
              "parentExternalId" to record.metadata.id,
              "value" to sample.beatsPerMinute.toDouble(),
              "unit" to "bpm",
            )
        }
      }
    return if (heartRate.nextPageToken == null) {
      heartRate.copy(nextPageToken = "resting:")
    } else {
      heartRate
    }
  }

  val resting =
    readPage(client, RestingHeartRateRecord::class, timeRange, origins, actualToken) { record ->
      listOf(
        commonRecord(record.metadata, "resting_heart_rate", record.time, record.time) +
          mapOf("value" to record.beatsPerMinute.toDouble(), "unit" to "bpm")
      )
    }
  return resting.copy(
    nextPageToken = resting.nextPageToken?.let { "resting:$it" }
  )
}

private suspend fun readBodyCompositionPage(
  client: HealthConnectClient,
  timeRange: TimeRangeFilter,
  origins: Set<DataOrigin>,
  pageToken: String?,
): NormalizedPage {
  val stage =
    when {
      pageToken?.startsWith("lean:") == true -> "lean"
      pageToken?.startsWith("water:") == true -> "water"
      pageToken?.startsWith("bone:") == true -> "bone"
      pageToken?.startsWith("height:") == true -> "height"
      pageToken?.startsWith("metabolism:") == true -> "metabolism"
      else -> "fat"
    }
  val actualToken =
    when (stage) {
      "lean" -> pageToken?.removePrefix("lean:")?.ifEmpty { null }
      "water" -> pageToken?.removePrefix("water:")?.ifEmpty { null }
      "bone" -> pageToken?.removePrefix("bone:")?.ifEmpty { null }
      "height" -> pageToken?.removePrefix("height:")?.ifEmpty { null }
      "metabolism" -> pageToken?.removePrefix("metabolism:")?.ifEmpty { null }
      else -> pageToken?.removePrefix("fat:")?.ifEmpty { null }
    }

  return when (stage) {
    "fat" -> {
      val page =
        readPage(client, BodyFatRecord::class, timeRange, origins, actualToken) { record ->
          listOf(
            commonRecord(record.metadata, "body_fat", record.time, record.time) +
              mapOf("value" to record.percentage.value, "unit" to "percent")
          )
        }
      page.copy(nextPageToken = page.nextPageToken?.let { "fat:$it" } ?: "lean:")
    }
    "lean" -> {
      val page =
        readPage(client, LeanBodyMassRecord::class, timeRange, origins, actualToken) { record ->
          listOf(
            commonRecord(record.metadata, "lean_body_mass", record.time, record.time) +
              mapOf("value" to record.mass.inKilograms, "unit" to "kg")
          )
        }
      page.copy(nextPageToken = page.nextPageToken?.let { "lean:$it" } ?: "water:")
    }
    "water" -> {
      val page =
        readPage(client, BodyWaterMassRecord::class, timeRange, origins, actualToken) { record ->
          listOf(
            commonRecord(record.metadata, "body_water_mass", record.time, record.time) +
              mapOf("value" to record.mass.inKilograms, "unit" to "kg")
          )
        }
      page.copy(nextPageToken = page.nextPageToken?.let { "water:$it" } ?: "bone:")
    }
    "bone" -> {
      val page =
        readPage(client, BoneMassRecord::class, timeRange, origins, actualToken) { record ->
          listOf(
            commonRecord(record.metadata, "bone_mass", record.time, record.time) +
              mapOf("value" to record.mass.inKilograms, "unit" to "kg")
          )
        }
      page.copy(nextPageToken = page.nextPageToken?.let { "bone:$it" } ?: "height:")
    }
    "height" -> {
      val page =
        readPage(client, HeightRecord::class, timeRange, origins, actualToken) { record ->
          listOf(
            commonRecord(record.metadata, "height", record.time, record.time) +
              mapOf("value" to record.height.inMeters, "unit" to "m")
          )
        }
      page.copy(
        nextPageToken = page.nextPageToken?.let { "height:$it" } ?: "metabolism:"
      )
    }
    else -> {
      val page =
        readPage(
          client,
          BasalMetabolicRateRecord::class,
          timeRange,
          origins,
          actualToken,
        ) { record ->
          listOf(
            commonRecord(
              record.metadata,
              "basal_metabolic_rate",
              record.time,
              record.time,
            ) +
              mapOf(
                "value" to record.basalMetabolicRate.inKilocaloriesPerDay,
                "unit" to "kcal/day",
              )
          )
        }
      page.copy(nextPageToken = page.nextPageToken?.let { "metabolism:$it" })
    }
  }
}

private suspend fun readVitalsPage(
  client: HealthConnectClient,
  timeRange: TimeRangeFilter,
  origins: Set<DataOrigin>,
  pageToken: String?,
): NormalizedPage {
  val stage =
    when {
      pageToken?.startsWith("oxygen:") == true -> "oxygen"
      pageToken?.startsWith("respiratory:") == true -> "respiratory"
      pageToken?.startsWith("hrv:") == true -> "hrv"
      pageToken?.startsWith("vo2:") == true -> "vo2"
      pageToken?.startsWith("temperature:") == true -> "temperature"
      else -> "pressure"
    }
  val actualToken =
    pageToken
      ?.removePrefix("$stage:")
      ?.ifEmpty { null }

  return when (stage) {
    "pressure" -> {
      val page =
        readPage(client, BloodPressureRecord::class, timeRange, origins, actualToken) { record ->
          val common = commonRecord(record.metadata, "blood_pressure_systolic", record.time, record.time)
          listOf(
            common +
              mapOf(
                "externalId" to "${record.metadata.id}:systolic",
                "parentExternalId" to record.metadata.id,
                "value" to record.systolic.inMillimetersOfMercury,
                "unit" to "mmHg",
              ),
            common +
              mapOf(
                "externalId" to "${record.metadata.id}:diastolic",
                "parentExternalId" to record.metadata.id,
                "kind" to "blood_pressure_diastolic",
                "value" to record.diastolic.inMillimetersOfMercury,
                "unit" to "mmHg",
              ),
          )
        }
      page.copy(nextPageToken = page.nextPageToken?.let { "pressure:$it" } ?: "oxygen:")
    }
    "oxygen" -> {
      val page =
        readPage(client, OxygenSaturationRecord::class, timeRange, origins, actualToken) { record ->
          listOf(
            commonRecord(record.metadata, "oxygen_saturation", record.time, record.time) +
              mapOf("value" to record.percentage.value, "unit" to "percent")
          )
        }
      page.copy(nextPageToken = page.nextPageToken?.let { "oxygen:$it" } ?: "respiratory:")
    }
    "respiratory" -> {
      val page =
        readPage(client, RespiratoryRateRecord::class, timeRange, origins, actualToken) { record ->
          listOf(
            commonRecord(record.metadata, "respiratory_rate", record.time, record.time) +
              mapOf("value" to record.rate, "unit" to "breaths/min")
          )
        }
      page.copy(nextPageToken = page.nextPageToken?.let { "respiratory:$it" } ?: "hrv:")
    }
    "hrv" -> {
      val page =
        readPage(
          client,
          HeartRateVariabilityRmssdRecord::class,
          timeRange,
          origins,
          actualToken,
        ) { record ->
          listOf(
            commonRecord(
              record.metadata,
              "heart_rate_variability_rmssd",
              record.time,
              record.time,
            ) +
              mapOf("value" to record.heartRateVariabilityMillis, "unit" to "ms")
          )
        }
      page.copy(nextPageToken = page.nextPageToken?.let { "hrv:$it" } ?: "vo2:")
    }
    "vo2" -> {
      val page =
        readPage(client, Vo2MaxRecord::class, timeRange, origins, actualToken) { record ->
          listOf(
            commonRecord(record.metadata, "vo2_max", record.time, record.time) +
              mapOf(
                "value" to record.vo2MillilitersPerMinuteKilogram,
                "unit" to "ml/kg/min",
              )
          )
        }
      page.copy(nextPageToken = page.nextPageToken?.let { "vo2:$it" } ?: "temperature:")
    }
    else -> {
      val page =
        readPage(client, BodyTemperatureRecord::class, timeRange, origins, actualToken) { record ->
          listOf(
            commonRecord(record.metadata, "body_temperature", record.time, record.time) +
              mapOf("value" to record.temperature.inCelsius, "unit" to "celsius")
          )
        }
      page.copy(nextPageToken = page.nextPageToken?.let { "temperature:$it" })
    }
  }
}

private suspend fun readCyclePage(
  client: HealthConnectClient,
  timeRange: TimeRangeFilter,
  origins: Set<DataOrigin>,
  pageToken: String?,
): NormalizedPage {
  val stage =
    when {
      pageToken?.startsWith("flow:") == true -> "flow"
      pageToken?.startsWith("ovulation:") == true -> "ovulation"
      pageToken?.startsWith("basal-temperature:") == true -> "basal-temperature"
      pageToken?.startsWith("cervical:") == true -> "cervical"
      pageToken?.startsWith("bleeding:") == true -> "bleeding"
      else -> "period"
    }
  val actualToken = pageToken?.removePrefix("$stage:")?.ifEmpty { null }
  return when (stage) {
    "period" -> {
      val page =
        readPage(
          client,
          MenstruationPeriodRecord::class,
          timeRange,
          origins,
          actualToken,
        ) { record ->
          listOf(
            commonRecord(
              record.metadata,
              "menstruation_period",
              record.startTime,
              record.endTime,
            )
          )
        }
      page.copy(nextPageToken = page.nextPageToken?.let { "period:$it" } ?: "flow:")
    }
    "flow" -> {
      val page =
        readPage(
          client,
          MenstruationFlowRecord::class,
          timeRange,
          origins,
          actualToken,
        ) { record ->
          listOf(
            commonRecord(record.metadata, "menstruation_flow", record.time, record.time) +
              mapOf("flow" to record.flow)
          )
        }
      page.copy(nextPageToken = page.nextPageToken?.let { "flow:$it" } ?: "ovulation:")
    }
    "ovulation" -> {
      val page =
        readPage(client, OvulationTestRecord::class, timeRange, origins, actualToken) { record ->
          listOf(
            commonRecord(record.metadata, "ovulation_test", record.time, record.time) +
              mapOf("result" to record.result)
          )
        }
      page.copy(
        nextPageToken = page.nextPageToken?.let { "ovulation:$it" } ?: "basal-temperature:"
      )
    }
    "basal-temperature" -> {
      val page =
        readPage(
          client,
          BasalBodyTemperatureRecord::class,
          timeRange,
          origins,
          actualToken,
        ) { record ->
          listOf(
            commonRecord(
              record.metadata,
              "basal_body_temperature",
              record.time,
              record.time,
            ) +
              mapOf(
                "value" to record.temperature.inCelsius,
                "unit" to "celsius",
                "measurementLocation" to record.measurementLocation,
              )
          )
        }
      page.copy(
        nextPageToken =
          page.nextPageToken?.let { "basal-temperature:$it" } ?: "cervical:"
      )
    }
    "cervical" -> {
      val page =
        readPage(client, CervicalMucusRecord::class, timeRange, origins, actualToken) { record ->
          listOf(
            commonRecord(record.metadata, "cervical_mucus", record.time, record.time) +
              mapOf(
                "appearance" to record.appearance,
                "sensation" to record.sensation,
              )
          )
        }
      page.copy(nextPageToken = page.nextPageToken?.let { "cervical:$it" } ?: "bleeding:")
    }
    else -> {
      val page =
        readPage(
          client,
          IntermenstrualBleedingRecord::class,
          timeRange,
          origins,
          actualToken,
        ) { record ->
          listOf(
            commonRecord(
              record.metadata,
              "intermenstrual_bleeding",
              record.time,
              record.time,
            )
          )
        }
      page.copy(nextPageToken = page.nextPageToken?.let { "bleeding:$it" })
    }
  }
}

/**
 * Normalises a polymorphic changelog upsertion with the same stable shape as
 * the paged history reader. Health Connect deletions only contain the parent
 * record id, so sampled/compound records keep parentExternalId for exact local
 * reconciliation.
 */
private fun normalizeRecord(record: Record): List<Map<String, Any?>> =
  when (record) {
    is StepsRecord ->
      listOf(
        commonRecord(record.metadata, "steps", record.startTime, record.endTime) +
          mapOf("value" to record.count.toDouble(), "unit" to "count")
      )
    is DistanceRecord ->
      listOf(
        commonRecord(record.metadata, "distance", record.startTime, record.endTime) +
          mapOf("value" to record.distance.inMeters, "unit" to "m")
      )
    is ElevationGainedRecord ->
      listOf(
        commonRecord(record.metadata, "elevation_gained", record.startTime, record.endTime) +
          mapOf("value" to record.elevation.inMeters, "unit" to "m")
      )
    is FloorsClimbedRecord ->
      listOf(
        commonRecord(record.metadata, "floors_climbed", record.startTime, record.endTime) +
          mapOf("value" to record.floors, "unit" to "floors")
      )
    is ActiveCaloriesBurnedRecord ->
      listOf(
        commonRecord(
          record.metadata,
          "active_calories",
          record.startTime,
          record.endTime,
        ) + mapOf("value" to record.energy.inKilocalories, "unit" to "kcal")
      )
    is TotalCaloriesBurnedRecord ->
      listOf(
        commonRecord(
          record.metadata,
          "total_calories",
          record.startTime,
          record.endTime,
        ) + mapOf("value" to record.energy.inKilocalories, "unit" to "kcal")
      )
    is ExerciseSessionRecord ->
      listOf(normalizeExerciseSession(record))
    is PowerRecord ->
      record.samples.map { sample ->
        commonRecord(record.metadata, "workout_power", sample.time, sample.time) +
          mapOf(
            "externalId" to "${record.metadata.id}:${sample.time.toEpochMilli()}",
            "parentExternalId" to record.metadata.id,
            "value" to sample.power.inWatts,
            "unit" to "w",
          )
      }
    is SpeedRecord ->
      record.samples.map { sample ->
        commonRecord(record.metadata, "workout_speed", sample.time, sample.time) +
          mapOf(
            "externalId" to "${record.metadata.id}:${sample.time.toEpochMilli()}",
            "parentExternalId" to record.metadata.id,
            "value" to sample.speed.inMetersPerSecond,
            "unit" to "m/s",
          )
      }
    is StepsCadenceRecord ->
      record.samples.map { sample ->
        commonRecord(record.metadata, "walking_cadence", sample.time, sample.time) +
          mapOf(
            "externalId" to "${record.metadata.id}:${sample.time.toEpochMilli()}",
            "parentExternalId" to record.metadata.id,
            "value" to sample.rate,
            "unit" to "rpm",
          )
      }
    is CyclingPedalingCadenceRecord ->
      record.samples.map { sample ->
        commonRecord(record.metadata, "cycling_cadence", sample.time, sample.time) +
          mapOf(
            "externalId" to "${record.metadata.id}:${sample.time.toEpochMilli()}",
            "parentExternalId" to record.metadata.id,
            "value" to sample.revolutionsPerMinute,
            "unit" to "rpm",
          )
      }
    is HeartRateRecord ->
      record.samples.map { sample ->
        commonRecord(record.metadata, "heart_rate", sample.time, sample.time) +
          mapOf(
            "externalId" to "${record.metadata.id}:${sample.time.toEpochMilli()}",
            "parentExternalId" to record.metadata.id,
            "value" to sample.beatsPerMinute.toDouble(),
            "unit" to "bpm",
          )
      }
    is RestingHeartRateRecord ->
      listOf(
        commonRecord(record.metadata, "resting_heart_rate", record.time, record.time) +
          mapOf("value" to record.beatsPerMinute.toDouble(), "unit" to "bpm")
      )
    is SleepSessionRecord ->
      listOf(
        commonRecord(record.metadata, "sleep", record.startTime, record.endTime) +
          mapOf(
            "title" to record.title,
            "notes" to record.notes,
            "stages" to
              record.stages.map { stage ->
                mapOf(
                  "startTimeMs" to stage.startTime.toEpochMilli().toDouble(),
                  "endTimeMs" to stage.endTime.toEpochMilli().toDouble(),
                  "stageType" to stage.stage,
                )
              },
          )
      )
    is WeightRecord ->
      listOf(
        commonRecord(record.metadata, "weight", record.time, record.time) +
          mapOf("value" to record.weight.inKilograms, "unit" to "kg")
      )
    is BodyFatRecord ->
      listOf(
        commonRecord(record.metadata, "body_fat", record.time, record.time) +
          mapOf("value" to record.percentage.value, "unit" to "percent")
      )
    is LeanBodyMassRecord ->
      listOf(
        commonRecord(record.metadata, "lean_body_mass", record.time, record.time) +
          mapOf("value" to record.mass.inKilograms, "unit" to "kg")
      )
    is BodyWaterMassRecord ->
      listOf(
        commonRecord(record.metadata, "body_water_mass", record.time, record.time) +
          mapOf("value" to record.mass.inKilograms, "unit" to "kg")
      )
    is BoneMassRecord ->
      listOf(
        commonRecord(record.metadata, "bone_mass", record.time, record.time) +
          mapOf("value" to record.mass.inKilograms, "unit" to "kg")
      )
    is HeightRecord ->
      listOf(
        commonRecord(record.metadata, "height", record.time, record.time) +
          mapOf("value" to record.height.inMeters, "unit" to "m")
      )
    is BasalMetabolicRateRecord ->
      listOf(
        commonRecord(
          record.metadata,
          "basal_metabolic_rate",
          record.time,
          record.time,
        ) +
          mapOf(
            "value" to record.basalMetabolicRate.inKilocaloriesPerDay,
            "unit" to "kcal/day",
          )
      )
    is BloodGlucoseRecord ->
      listOf(
        commonRecord(record.metadata, "blood_glucose", record.time, record.time) +
          mapOf(
            "value" to record.level.inMillimolesPerLiter,
            "unit" to "mmol/L",
            "specimenSource" to record.specimenSource,
            "mealType" to record.mealType,
            "relationToMeal" to record.relationToMeal,
          )
      )
    is MenstruationPeriodRecord ->
      listOf(
        commonRecord(
          record.metadata,
          "menstruation_period",
          record.startTime,
          record.endTime,
        )
      )
    is MenstruationFlowRecord ->
      listOf(
        commonRecord(record.metadata, "menstruation_flow", record.time, record.time) +
          mapOf("flow" to record.flow)
      )
    is OvulationTestRecord ->
      listOf(
        commonRecord(record.metadata, "ovulation_test", record.time, record.time) +
          mapOf("result" to record.result)
      )
    is BasalBodyTemperatureRecord ->
      listOf(
        commonRecord(
          record.metadata,
          "basal_body_temperature",
          record.time,
          record.time,
        ) +
          mapOf(
            "value" to record.temperature.inCelsius,
            "unit" to "celsius",
            "measurementLocation" to record.measurementLocation,
          )
      )
    is CervicalMucusRecord ->
      listOf(
        commonRecord(record.metadata, "cervical_mucus", record.time, record.time) +
          mapOf(
            "appearance" to record.appearance,
            "sensation" to record.sensation,
          )
      )
    is IntermenstrualBleedingRecord ->
      listOf(
        commonRecord(
          record.metadata,
          "intermenstrual_bleeding",
          record.time,
          record.time,
        )
      )
    is BloodPressureRecord -> {
      val common =
        commonRecord(
          record.metadata,
          "blood_pressure_systolic",
          record.time,
          record.time,
        )
      listOf(
        common +
          mapOf(
            "externalId" to "${record.metadata.id}:systolic",
            "parentExternalId" to record.metadata.id,
            "value" to record.systolic.inMillimetersOfMercury,
            "unit" to "mmHg",
          ),
        common +
          mapOf(
            "externalId" to "${record.metadata.id}:diastolic",
            "parentExternalId" to record.metadata.id,
            "kind" to "blood_pressure_diastolic",
            "value" to record.diastolic.inMillimetersOfMercury,
            "unit" to "mmHg",
          ),
      )
    }
    is OxygenSaturationRecord ->
      listOf(
        commonRecord(record.metadata, "oxygen_saturation", record.time, record.time) +
          mapOf("value" to record.percentage.value, "unit" to "percent")
      )
    is RespiratoryRateRecord ->
      listOf(
        commonRecord(record.metadata, "respiratory_rate", record.time, record.time) +
          mapOf("value" to record.rate, "unit" to "breaths/min")
      )
    is HeartRateVariabilityRmssdRecord ->
      listOf(
        commonRecord(
          record.metadata,
          "heart_rate_variability_rmssd",
          record.time,
          record.time,
        ) + mapOf(
          "value" to record.heartRateVariabilityMillis,
          "unit" to "ms",
        )
      )
    is Vo2MaxRecord ->
      listOf(
        commonRecord(record.metadata, "vo2_max", record.time, record.time) +
          mapOf(
            "value" to record.vo2MillilitersPerMinuteKilogram,
            "unit" to "ml/kg/min",
          )
      )
    is BodyTemperatureRecord ->
      listOf(
        commonRecord(record.metadata, "body_temperature", record.time, record.time) +
          mapOf("value" to record.temperature.inCelsius, "unit" to "celsius")
      )
    is HydrationRecord ->
      listOf(
        commonRecord(record.metadata, "hydration", record.startTime, record.endTime) +
          mapOf("value" to record.volume.inLiters, "unit" to "litre")
      )
    is NutritionRecord ->
      listOf(
        commonRecord(record.metadata, "nutrition", record.startTime, record.endTime) +
          mapOf(
            "value" to record.totalCarbohydrate?.inGrams,
            "unit" to "g",
            "title" to record.name,
            "mealType" to record.mealType,
            "energyKcal" to record.energy?.inKilocalories,
            "proteinGrams" to record.protein?.inGrams,
            "fatGrams" to record.totalFat?.inGrams,
            "fibreGrams" to record.dietaryFiber?.inGrams,
            "sugarGrams" to record.sugar?.inGrams,
            "saturatedFatGrams" to record.saturatedFat?.inGrams,
          )
      )
    else -> emptyList()
  }

private fun commonRecord(
  metadata: Metadata,
  kind: String,
  startTime: Instant,
  endTime: Instant,
): Map<String, Any?> =
  mapOf(
    "externalId" to metadata.id,
    "kind" to kind,
    "sourcePackage" to metadata.dataOrigin.packageName,
    "startTimeMs" to startTime.toEpochMilli().toDouble(),
    "endTimeMs" to endTime.toEpochMilli().toDouble(),
    "lastModifiedTimeMs" to metadata.lastModifiedTime.toEpochMilli().toDouble(),
    "recordingMethod" to metadata.recordingMethod,
    "clientRecordId" to metadata.clientRecordId,
    "clientRecordVersion" to metadata.clientRecordVersion.toDouble(),
    "deviceManufacturer" to metadata.device?.manufacturer,
    "deviceModel" to metadata.device?.model,
    "deviceType" to metadata.device?.type,
  )

private fun normalizeExerciseSession(
  record: ExerciseSessionRecord,
): Map<String, Any?> =
  commonRecord(record.metadata, "workout", record.startTime, record.endTime) +
    mapOf(
      "startZoneOffsetSeconds" to record.startZoneOffset?.totalSeconds,
      "endZoneOffsetSeconds" to record.endZoneOffset?.totalSeconds,
      "exerciseType" to record.exerciseType,
      "title" to record.title,
      "notes" to record.notes,
      "rateOfPerceivedExertion" to record.rateOfPerceivedExertion?.toDouble(),
      "segmentsCount" to record.segments.size,
      "lapsCount" to record.laps.size,
      "segments" to
        record.segments.map { segment ->
          mapOf(
            "startTimeMs" to segment.startTime.toEpochMilli().toDouble(),
            "endTimeMs" to segment.endTime.toEpochMilli().toDouble(),
            "segmentType" to segment.segmentType,
            "repetitions" to segment.repetitions,
          )
        },
      "laps" to
        record.laps.map { lap ->
          mapOf(
            "startTimeMs" to lap.startTime.toEpochMilli().toDouble(),
            "endTimeMs" to lap.endTime.toEpochMilli().toDouble(),
            "lengthMetres" to lap.length?.inMeters,
          )
        },
    )

private fun sourceDescriptor(context: Context, packageName: String): Map<String, Any?> {
  val label =
    when {
      packageName == "android" -> "This phone (legacy steps)"
      packageName.startsWith("com.android.healthconnect.phone.") ->
        "This phone (Health Connect)"
      KNOWN_SOURCE_LABELS.containsKey(packageName) ->
        KNOWN_SOURCE_LABELS.getValue(packageName)
      else ->
        try {
          val info = context.packageManager.getApplicationInfo(packageName, 0)
          context.packageManager.getApplicationLabel(info).toString()
        } catch (_: Exception) {
          KNOWN_SOURCE_LABELS[packageName] ?: packageName
        }
    }
  return mapOf("packageName" to packageName, "displayName" to label)
}
