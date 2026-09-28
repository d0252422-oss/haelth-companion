package app.healthcompanion.sync

import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset

/** Source-provided total energy only. Never add active/basal records to this value. */
internal object TotalEnergyRecordMapper {
    fun fromHealthConnect(record: TotalCaloriesBurnedRecord, fallbackZone: ZoneId): CanonicalHealthRecord = fromSource(
        sourceApp = record.metadata.dataOrigin.packageName,
        sourceRecordId = record.metadata.id,
        sourceUpdatedAt = record.metadata.lastModifiedTime,
        startedAt = record.startTime,
        endedAt = record.endTime,
        kilocalories = record.energy.inKilocalories,
        zone = record.endZoneOffset ?: fallbackZone,
    )

    // Kept pure so unit, identity and cross-midnight semantics can be verified
    // without reading or manufacturing a user's Health Connect data.
    internal fun fromSource(
        sourceApp: String,
        sourceRecordId: String,
        sourceUpdatedAt: Instant,
        startedAt: Instant,
        endedAt: Instant,
        kilocalories: Double,
        zone: ZoneId,
    ): CanonicalHealthRecord {
        require(sourceApp.isNotBlank() && sourceRecordId.isNotBlank()) { "MISSING_SOURCE_IDENTITY" }
        require(endedAt.isAfter(startedAt)) { "INVALID_TOTAL_ENERGY_INTERVAL" }
        require(kilocalories.isFinite() && kilocalories >= 0.0) { "INVALID_TOTAL_ENERGY_VALUE" }
        return CanonicalHealthRecord(
            domain = "total_energy",
            sourceApp = sourceApp,
            sourceRecordId = sourceRecordId,
            sourceUpdatedAt = sourceUpdatedAt.toString(),
            recordedAt = endedAt.toString(),
            startedAt = startedAt.toString(),
            endedAt = endedAt.toString(),
            // Intl.DateTimeFormat on the ingestion Edge accepts +00:00, not ZoneOffset.UTC.id ("Z").
            timezone = if (zone is ZoneOffset && zone.totalSeconds == 0) "+00:00" else zone.id,
            localDate = endedAt.atZone(zone).toLocalDate().toString(),
            value = kilocalories,
            unit = "kcal",
        )
    }
}
