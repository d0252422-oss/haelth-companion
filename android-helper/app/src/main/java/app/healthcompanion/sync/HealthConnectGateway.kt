package app.healthcompanion.sync

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.OxygenSaturationRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withTimeout
import java.time.Instant
import java.time.ZoneId
import java.util.concurrent.atomic.AtomicInteger
import kotlin.reflect.KClass

data class HealthReadResult(
    val records: List<CanonicalHealthRecord>,
    val failedDomains: Set<String>,
    val cappedDomains: Set<String>,
    val pagesRead: Int,
) {
    val isPartial: Boolean get() = failedDomains.isNotEmpty() || cappedDomains.isNotEmpty()
}

private data class DomainReadResult(
    val domain: String,
    val records: List<CanonicalHealthRecord>,
    val pages: Int,
    val capped: Boolean = false,
    val failed: Boolean = false,
)

class HealthConnectGateway(private val context: Context) {
    val availability: Int get() = HealthConnectClient.getSdkStatus(context)
    val client: HealthConnectClient by lazy { HealthConnectClient.getOrCreate(context) }
    val readPermissions: Set<String> = setOf(
        HealthPermission.getReadPermission(StepsRecord::class),
        HealthPermission.getReadPermission(HeartRateRecord::class),
        HealthPermission.getReadPermission(RestingHeartRateRecord::class),
        HealthPermission.getReadPermission(SleepSessionRecord::class),
        HealthPermission.getReadPermission(WeightRecord::class),
        HealthPermission.getReadPermission(ExerciseSessionRecord::class),
        HealthPermission.getReadPermission(HeartRateVariabilityRmssdRecord::class),
        HealthPermission.getReadPermission(OxygenSaturationRecord::class),
    )

    fun supportsBackgroundRead(): Boolean = client.features.getFeatureStatus(
        HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND,
    ) == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE

    fun requestedPermissions(): Set<String> = if (supportsBackgroundRead()) {
        readPermissions + HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND
    } else readPermissions

    suspend fun hasAllPermissions(): Boolean = client.permissionController.getGrantedPermissions().containsAll(readPermissions)
    suspend fun hasAnyPermission(): Boolean = client.permissionController.getGrantedPermissions().any { it in readPermissions }
    suspend fun grantedReadPermissions(): Set<String> = client.permissionController.getGrantedPermissions().intersect(readPermissions)
    suspend fun hasBackgroundReadPermission(): Boolean = !supportsBackgroundRead() ||
        HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND in client.permissionController.getGrantedPermissions()

    suspend fun readBounded(
        start: Instant,
        end: Instant,
        onDomain: (domain: String, completed: Int, total: Int) -> Unit = { _, _, _ -> },
    ): HealthReadResult = coroutineScope {
        val filter = TimeRangeFilter.between(start, end)
        val zone = ZoneId.systemDefault()
        val granted = client.permissionController.getGrantedPermissions()
        val semaphore = Semaphore(MAX_CONCURRENT_DOMAIN_READS)
        val readers = mutableListOf<Pair<String, suspend () -> DomainReadResult>>()

        fun <T : Record> add(domain: String, permission: String, type: KClass<T>, mapper: (T) -> List<CanonicalHealthRecord>) {
            if (permission in granted) readers += domain to { semaphore.withPermit { readDomain(domain, type, filter, mapper) } }
        }

        add("steps", HealthPermission.getReadPermission(StepsRecord::class), StepsRecord::class) { record ->
            listOf(record.toCanonical("steps", record.count.toDouble(), "count", record.startTime, record.endTime, zone))
        }
        add("heart_rate", HealthPermission.getReadPermission(HeartRateRecord::class), HeartRateRecord::class) { record ->
            record.samples.map { sample -> record.toCanonical("heart_rate", sample.beatsPerMinute.toDouble(), "bpm", sample.time, sample.time, zone, identitySuffix = sample.time.toString()) }
        }
        add("resting_heart_rate", HealthPermission.getReadPermission(RestingHeartRateRecord::class), RestingHeartRateRecord::class) { record ->
            listOf(record.toCanonical("resting_heart_rate", record.beatsPerMinute.toDouble(), "bpm", record.time, record.time, zone))
        }
        add("sleep", HealthPermission.getReadPermission(SleepSessionRecord::class), SleepSessionRecord::class) { record ->
            listOf(record.toCanonical("sleep", (record.endTime.epochSecond - record.startTime.epochSecond) / 60.0, "minute", record.startTime, record.endTime, zone)) +
                record.stages.map { stage -> record.toCanonical("sleep_stage", (stage.endTime.epochSecond - stage.startTime.epochSecond) / 60.0, "minute", stage.startTime, stage.endTime, zone, stage.stage.toString(), "${stage.startTime}:${stage.endTime}:${stage.stage}") }
        }
        add("weight", HealthPermission.getReadPermission(WeightRecord::class), WeightRecord::class) { record ->
            listOf(record.toCanonical("weight", record.weight.inKilograms, "kg", record.time, record.time, zone))
        }
        add("workout", HealthPermission.getReadPermission(ExerciseSessionRecord::class), ExerciseSessionRecord::class) { record ->
            listOf(record.toCanonical("workout", (record.endTime.epochSecond - record.startTime.epochSecond) / 60.0, "minute", record.startTime, record.endTime, zone))
        }
        add("hrv", HealthPermission.getReadPermission(HeartRateVariabilityRmssdRecord::class), HeartRateVariabilityRmssdRecord::class) { record ->
            listOf(record.toCanonical("hrv", record.heartRateVariabilityMillis, "ms", record.time, record.time, zone))
        }
        add("spo2", HealthPermission.getReadPermission(OxygenSaturationRecord::class), OxygenSaturationRecord::class) { record ->
            listOf(record.toCanonical("spo2", record.percentage.value, "percent", record.time, record.time, zone))
        }

        val completed = AtomicInteger(0)
        val results = readers.map { (domain, reader) ->
            async {
                val result = runCatching { withTimeout(PER_DOMAIN_TIMEOUT_MS) { reader() } }
                    .getOrElse { DomainReadResult(domain, emptyList(), 0, failed = true) }
                onDomain(result.domain, completed.incrementAndGet(), readers.size)
                result
            }
        }.awaitAll()
        HealthReadResult(
            records = results.flatMap { it.records },
            failedDomains = results.filter { it.failed }.map { it.domain }.toSet(),
            cappedDomains = results.filter { it.capped }.map { it.domain }.toSet(),
            pagesRead = results.sumOf { it.pages },
        )
    }

    private suspend fun <T : Record> readDomain(domain: String, type: KClass<T>, filter: TimeRangeFilter, mapper: (T) -> List<CanonicalHealthRecord>): DomainReadResult {
        val records = mutableListOf<CanonicalHealthRecord>()
        val seenTokens = mutableSetOf<String>()
        var token: String? = null
        var pages = 0
        do {
            if (pages >= MAX_PAGES_PER_DOMAIN) return DomainReadResult(domain, records, pages, capped = true)
            val response = client.readRecords(ReadRecordsRequest(recordType = type, timeRangeFilter = filter, pageSize = PAGE_SIZE, pageToken = token))
            records += response.records.flatMap(mapper)
            pages += 1
            val next = response.pageToken
            if (PaginationGuard.isRepeated(next, seenTokens)) return DomainReadResult(domain, records, pages, capped = true)
            token = next
        } while (token != null)
        return DomainReadResult(domain, records, pages)
    }

    private fun Record.toCanonical(domain: String, value: Double, unit: String, start: Instant, end: Instant, zone: ZoneId, stage: String? = null, identitySuffix: String? = null): CanonicalHealthRecord {
        val recorded = end.atZone(zone)
        val sourceId = if (identitySuffix == null) metadata.id else "${metadata.id}:$identitySuffix"
        return CanonicalHealthRecord(domain, metadata.dataOrigin.packageName, sourceId, metadata.lastModifiedTime.toString(), end.toString(), start.toString(), end.toString(), zone.id, recorded.toLocalDate().toString(), value, unit, stage)
    }

    companion object {
        const val PAGE_SIZE = 500
        const val MAX_PAGES_PER_DOMAIN = 50
        const val MAX_CONCURRENT_DOMAIN_READS = 2
        const val PER_DOMAIN_TIMEOUT_MS = 30_000L
    }
}
