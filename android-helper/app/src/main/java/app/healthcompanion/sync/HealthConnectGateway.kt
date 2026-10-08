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
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import java.time.Instant
import java.time.ZoneId
import java.util.concurrent.atomic.AtomicInteger
import kotlin.reflect.KClass

data class HealthReadResult(
    val records: List<CanonicalHealthRecord>,
    val failedDomains: Set<String>,
    val cappedDomains: Set<String>,
    val pagesRead: Int,
    val domainTraces: Map<String, DomainReadTrace> = emptyMap(),
    val domainRangeStarts: Map<String, String> = emptyMap(),
) {
    val isPartial: Boolean get() = failedDomains.isNotEmpty() || cappedDomains.isNotEmpty()
}

private data class DomainReadResult(
    val domain: String,
    val records: List<CanonicalHealthRecord>,
    val pages: Int,
    val capped: Boolean = false,
    val failed: Boolean = false,
    val traces: Map<String, DomainReadTrace> = emptyMap(),
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
        HealthPermission.getReadPermission(TotalCaloriesBurnedRecord::class),
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
    suspend fun hasBackgroundReadPermission(): Boolean = supportsBackgroundRead() &&
        HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND in client.permissionController.getGrantedPermissions()

    suspend fun backgroundReadState(): BackgroundHealthReadState = when {
        !supportsBackgroundRead() -> BackgroundHealthReadState.UNSUPPORTED
        hasBackgroundReadPermission() -> BackgroundHealthReadState.GRANTED
        else -> BackgroundHealthReadState.PERMISSION_REQUIRED
    }

    suspend fun readBounded(
        start: Instant,
        end: Instant,
        includedDomains: Set<String>? = null,
        startForDomain: (String) -> Instant = { start },
        onDomain: (domain: String, completed: Int, total: Int) -> Unit = { _, _, _ -> },
    ): HealthReadResult = coroutineScope {
        val zone = ZoneId.of("Asia/Taipei")
        val granted = client.permissionController.getGrantedPermissions()
        val semaphore = Semaphore(MAX_CONCURRENT_DOMAIN_READS)
        val readers = mutableListOf<Pair<String, suspend () -> DomainReadResult>>()

        fun <T : Record> add(domain: String, permission: String, type: KClass<T>, mapper: (T) -> List<CanonicalHealthRecord>) {
            if (permission in granted && HealthReadDomainPolicy.includes(includedDomains, domain)) {
                readers += domain to {
                    readDomain(domain, type, TimeRangeFilter.between(startForDomain(domain), end), mapper)
                }
            }
        }

        add("steps", HealthPermission.getReadPermission(StepsRecord::class), StepsRecord::class) { record ->
            listOf(record.toCanonical("steps", record.count.toDouble(), "count", record.startTime, record.endTime, zone))
        }
        add("total_energy", HealthPermission.getReadPermission(TotalCaloriesBurnedRecord::class), TotalCaloriesBurnedRecord::class) { record ->
            listOf(TotalEnergyRecordMapper.fromHealthConnect(record, zone))
        }
        add("heart_rate", HealthPermission.getReadPermission(HeartRateRecord::class), HeartRateRecord::class) { record ->
            record.samples.map { sample -> record.toCanonical("heart_rate", sample.beatsPerMinute.toDouble(), "bpm", sample.time, sample.time, zone, identitySuffix = sample.time.toString()) }
        }
        add("resting_heart_rate", HealthPermission.getReadPermission(RestingHeartRateRecord::class), RestingHeartRateRecord::class) { record ->
            listOf(record.toCanonical("resting_heart_rate", record.beatsPerMinute.toDouble(), "bpm", record.time, record.time, zone))
        }
        add("sleep", HealthPermission.getReadPermission(SleepSessionRecord::class), SleepSessionRecord::class) { record ->
            listOf(record.toCanonical("sleep", (record.endTime.epochSecond - record.startTime.epochSecond) / 60.0, "minute", record.startTime, record.endTime, zone)) +
                record.stages.map { stage -> record.toCanonical("sleep_stage", (stage.endTime.epochSecond - stage.startTime.epochSecond) / 60.0, "minute", stage.startTime, stage.endTime, zone, stage.stage.toString(), "${stage.startTime}:${stage.endTime}:${stage.stage}", record.endTime.toString())
                    .copy(localDate = SleepDayOwnership.wakeDate(record.endTime, zone)) }
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
                // The per-domain deadline starts after acquiring a slot. Waiting
                // behind a slow domain must not consume another domain's read budget.
                val result = run {
                    var current: DomainReadResult? = null
                    for (attempt in 0..SyncCompletenessPolicy.MAX_DOMAIN_RECOVERY_ATTEMPTS) {
                        current = try { DomainReadBudget.read(semaphore, PER_DOMAIN_TIMEOUT_MS, reader) }
                        catch (_: TimeoutCancellationException) { failedRead(domain, "READER_TIMEOUT") }
                        catch (cancelled: CancellationException) { throw cancelled }
                        catch (_: SecurityException) { failedRead(domain, "PERMISSION") }
                        catch (_: Exception) { failedRead(domain, "READER_ERROR") }
                        current = current.copy(traces = current.traces.mapValues { (_, trace) -> trace.copy(recoveryAttempts = attempt) })
                        if (!current.failed && !current.capped) break
                    }
                    requireNotNull(current)
                }
                onDomain(result.domain, completed.incrementAndGet(), readers.size)
                result
            }
        }.awaitAll()
        HealthReadResult(
            records = results.flatMap { it.records },
            failedDomains = results.filter { it.failed }.map { it.domain }.toSet(),
            cappedDomains = results.filter { it.capped }.map { it.domain }.toSet(),
            pagesRead = results.sumOf { it.pages },
            domainTraces = results.flatMap { it.traces.entries }.associate { it.key to it.value },
            domainRangeStarts = results.flatMap { result -> result.traces.keys.map { it to startForDomain(result.domain).toString() } }.toMap(),
        )
    }

    private suspend fun <T : Record> readDomain(domain: String, type: KClass<T>, filter: TimeRangeFilter, mapper: (T) -> List<CanonicalHealthRecord>): DomainReadResult {
        val records = mutableListOf<CanonicalHealthRecord>()
        val seenTokens = mutableSetOf<String>()
        var token: String? = null
        var pages = 0
        var sourceCount = 0
        var stageCount = 0
        val drops = mutableMapOf<String, Int>()
        fun result(capped: Boolean = false): DomainReadResult {
            val status = if (capped) "CAPPED" else if (drops.isNotEmpty()) "MAPPING_INCOMPLETE" else "COMPLETE"
            val traces = mutableMapOf(domain to DomainReadTrace(sourceCount, records.count { it.domain == domain }, pages, status, drops.toMap()))
            if (domain == "sleep") traces["sleep_stage"] = DomainReadTrace(stageCount, records.count { it.domain == "sleep_stage" }, pages, status, drops.toMap())
            return DomainReadResult(domain, records, pages, capped, drops.isNotEmpty(), traces)
        }
        do {
            if (pages >= MAX_PAGES_PER_DOMAIN) return result(capped = true)
            val response = client.readRecords(ReadRecordsRequest(recordType = type, timeRangeFilter = filter, pageSize = PAGE_SIZE, pageToken = token))
            sourceCount += response.records.size
            response.records.forEach { source ->
                if (source is SleepSessionRecord) stageCount += source.stages.size
                try {
                    val mapped = mapper(source)
                    if (mapped.isEmpty()) drops.merge("EMPTY_MAPPING", 1, Int::plus)
                    mapped.forEach { record ->
                        if (!record.value.isFinite() || record.sourceRecordId.isBlank()) drops.merge("INVALID_RECORD", 1, Int::plus)
                        else records += record
                    }
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { drops.merge("MAPPER_ERROR", 1, Int::plus) }
            }
            pages += 1
            val next = PaginationGuard.nextPageToken(response.pageToken)
            if (PaginationGuard.isRepeated(next, seenTokens)) return result(capped = true)
            token = next
        } while (token != null)
        return result()
    }

    private fun failedRead(domain: String, reason: String): DomainReadResult {
        val names = if (domain == "sleep") listOf("sleep", "sleep_stage") else listOf(domain)
        return DomainReadResult(domain, emptyList(), 0, failed = true,
            traces = names.associateWith { DomainReadTrace(null, 0, 0, reason) })
    }

    private fun Record.toCanonical(domain: String, value: Double, unit: String, start: Instant, end: Instant, zone: ZoneId, stage: String? = null, identitySuffix: String? = null, uploadSortAt: String? = null): CanonicalHealthRecord {
        val recorded = end.atZone(zone)
        val sourceId = if (identitySuffix == null) metadata.id else "${metadata.id}:$identitySuffix"
        return CanonicalHealthRecord(domain, metadata.dataOrigin.packageName, sourceId, metadata.lastModifiedTime.toString(), end.toString(), start.toString(), end.toString(), zone.id, recorded.toLocalDate().toString(), value, unit, stage, uploadSortAt)
    }

    companion object {
        const val PAGE_SIZE = 500
        const val MAX_PAGES_PER_DOMAIN = 50
        const val MAX_CONCURRENT_DOMAIN_READS = 2
        const val PER_DOMAIN_TIMEOUT_MS = 30_000L
    }
}

enum class BackgroundHealthReadState { GRANTED, PERMISSION_REQUIRED, UNSUPPORTED }
