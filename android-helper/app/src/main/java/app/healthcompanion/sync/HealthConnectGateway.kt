package app.healthcompanion.sync

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.OxygenSaturationRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import java.time.Instant
import java.time.ZoneId

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

    suspend fun hasAllPermissions(): Boolean = client.permissionController.getGrantedPermissions().containsAll(readPermissions)
    suspend fun hasAnyPermission(): Boolean = client.permissionController.getGrantedPermissions().any { it in readPermissions }
    suspend fun grantedReadPermissions(): Set<String> = client.permissionController.getGrantedPermissions().intersect(readPermissions)

    suspend fun readBounded(start: Instant, end: Instant): List<CanonicalHealthRecord> {
        val filter = TimeRangeFilter.between(start, end)
        val zone = ZoneId.systemDefault()
        val output = mutableListOf<CanonicalHealthRecord>()
        val granted = client.permissionController.getGrantedPermissions()
        if (HealthPermission.getReadPermission(StepsRecord::class) in granted) client.readRecords(ReadRecordsRequest(StepsRecord::class, filter)).records.forEach { record ->
            output += record.toCanonical("steps", record.count.toDouble(), "count", record.startTime, record.endTime, zone)
        }
        if (HealthPermission.getReadPermission(HeartRateRecord::class) in granted) client.readRecords(ReadRecordsRequest(HeartRateRecord::class, filter)).records.forEach { record ->
            record.samples.forEach { sample -> output += record.toCanonical("heart_rate", sample.beatsPerMinute.toDouble(), "bpm", sample.time, sample.time, zone) }
        }
        if (HealthPermission.getReadPermission(RestingHeartRateRecord::class) in granted) client.readRecords(ReadRecordsRequest(RestingHeartRateRecord::class, filter)).records.forEach { record ->
            output += record.toCanonical("resting_heart_rate", record.beatsPerMinute.toDouble(), "bpm", record.time, record.time, zone)
        }
        if (HealthPermission.getReadPermission(SleepSessionRecord::class) in granted) client.readRecords(ReadRecordsRequest(SleepSessionRecord::class, filter)).records.forEach { record ->
            output += record.toCanonical("sleep", (record.endTime.epochSecond - record.startTime.epochSecond) / 60.0, "minute", record.startTime, record.endTime, zone)
            record.stages.forEach { stage -> output += record.toCanonical("sleep_stage", (stage.endTime.epochSecond - stage.startTime.epochSecond) / 60.0, "minute", stage.startTime, stage.endTime, zone, stage.stage.toString()) }
        }
        if (HealthPermission.getReadPermission(WeightRecord::class) in granted) client.readRecords(ReadRecordsRequest(WeightRecord::class, filter)).records.forEach { record ->
            output += record.toCanonical("weight", record.weight.inKilograms, "kg", record.time, record.time, zone)
        }
        if (HealthPermission.getReadPermission(ExerciseSessionRecord::class) in granted) client.readRecords(ReadRecordsRequest(ExerciseSessionRecord::class, filter)).records.forEach { record ->
            output += record.toCanonical("workout", (record.endTime.epochSecond - record.startTime.epochSecond) / 60.0, "minute", record.startTime, record.endTime, zone)
        }
        if (HealthPermission.getReadPermission(HeartRateVariabilityRmssdRecord::class) in granted) client.readRecords(ReadRecordsRequest(HeartRateVariabilityRmssdRecord::class, filter)).records.forEach { record ->
            output += record.toCanonical("hrv", record.heartRateVariabilityMillis, "ms", record.time, record.time, zone)
        }
        if (HealthPermission.getReadPermission(OxygenSaturationRecord::class) in granted) client.readRecords(ReadRecordsRequest(OxygenSaturationRecord::class, filter)).records.forEach { record ->
            output += record.toCanonical("spo2", record.percentage.value, "percent", record.time, record.time, zone)
        }
        return output
    }

    private fun androidx.health.connect.client.records.Record.toCanonical(domain: String, value: Double, unit: String, start: Instant, end: Instant, zone: ZoneId, stage: String? = null): CanonicalHealthRecord {
        val recorded = end.atZone(zone)
        return CanonicalHealthRecord(domain, metadata.dataOrigin.packageName, metadata.id, metadata.lastModifiedTime.toString(), end.toString(), start.toString(), end.toString(), zone.id, recorded.toLocalDate().toString(), value, unit, stage)
    }
}
