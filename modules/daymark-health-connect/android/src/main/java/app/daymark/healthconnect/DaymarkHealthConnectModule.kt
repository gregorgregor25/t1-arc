package app.daymark.healthconnect

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.result.contract.ActivityResultContract
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.records.metadata.DataOrigin
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.request.ReadRecordsRequest
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
    "distance" to setOf(DistanceRecord::class),
    "active_calories" to setOf(ActiveCaloriesBurnedRecord::class),
    "workouts" to setOf(ExerciseSessionRecord::class),
    "heart_rate" to setOf(HeartRateRecord::class, RestingHeartRateRecord::class),
    "sleep" to setOf(SleepSessionRecord::class),
    "weight" to setOf(WeightRecord::class),
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

class DaymarkHealthConnectModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DaymarkHealthConnect")

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
            readPage(client, DistanceRecord::class, timeRange, origins, pageToken) { record ->
              listOf(
                commonRecord(record.metadata, "distance", record.startTime, record.endTime) +
                  mapOf("value" to record.distance.inMeters, "unit" to "m")
              )
            }
          "active_calories" ->
            readPage(
              client,
              ActiveCaloriesBurnedRecord::class,
              timeRange,
              origins,
              pageToken,
            ) { record ->
              listOf(
                commonRecord(
                  record.metadata,
                  "active_calories",
                  record.startTime,
                  record.endTime,
                ) +
                  mapOf("value" to record.energy.inKilocalories, "unit" to "kcal")
              )
            }
          "workouts" ->
            readPage(
              client,
              ExerciseSessionRecord::class,
              timeRange,
              origins,
              pageToken,
            ) { record ->
              listOf(
                commonRecord(record.metadata, "workout", record.startTime, record.endTime) +
                  mapOf(
                    "exerciseType" to record.exerciseType,
                    "title" to record.title,
                    "notes" to record.notes,
                    "rateOfPerceivedExertion" to record.rateOfPerceivedExertion?.toDouble(),
                    "segmentsCount" to record.segments.size,
                    "lapsCount" to record.laps.size,
                  )
              )
            }
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
  recordTypesFor(categories).map(HealthPermission::getReadPermission).toSet()

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

private fun sourceDescriptor(context: Context, packageName: String): Map<String, Any?> {
  val label =
    when {
      packageName == "android" ||
        packageName.startsWith("com.android.healthconnect.phone.") -> "This phone"
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
