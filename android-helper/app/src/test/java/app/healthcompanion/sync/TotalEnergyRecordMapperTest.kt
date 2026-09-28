package app.healthcompanion.sync

import androidx.health.connect.client.units.kilocalories
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset

class TotalEnergyRecordMapperTest {
    private val user = "11111111-1111-4111-8111-111111111111"
    private val taipei = ZoneId.of("Asia/Taipei")
    private val start = Instant.parse("2026-09-27T15:30:00Z")
    private val end = Instant.parse("2026-09-27T16:30:00Z")

    private fun source(origin: String = "com.fitbit.FitbitMobile", value: Double = 90.5) =
        TotalEnergyRecordMapper.fromSource(
            sourceApp = origin,
            sourceRecordId = "hc-record-1",
            sourceUpdatedAt = Instant.parse("2026-09-28T02:00:00Z"),
            startedAt = start,
            endedAt = end,
            kilocalories = value,
            zone = taipei,
        )

    @Test fun mapsSourceTotalEnergyWithoutReplacingIntervalOrOrigin() {
        val record = source()
        assertEquals("total_energy", record.domain)
        assertEquals("kcal", record.unit)
        assertEquals(90.5, record.value, 0.0)
        assertEquals("com.fitbit.FitbitMobile", record.sourceApp)
        assertEquals("hc-record-1", record.sourceRecordId)
        assertEquals(start.toString(), record.startedAt)
        assertEquals(end.toString(), record.endedAt)
        assertEquals(end.toString(), record.recordedAt)
        assertEquals("2026-09-28", record.localDate)
    }

    @Test fun healthConnectKilocalorieUnitIsPassedThroughOnce() {
        assertEquals(123.25, 123.25.kilocalories.inKilocalories, 0.0)
        assertEquals(123.25, source(value = 123.25).value, 0.0)
    }

    @Test fun utcOffsetUsesAnEdgeCompatibleTimezoneWithoutChangingTheInstant() {
        val record = TotalEnergyRecordMapper.fromSource(
            "com.example.health", "utc-1", Instant.parse("2026-09-28T02:00:00Z"),
            start, end, 90.5, ZoneOffset.UTC,
        )
        assertEquals("+00:00", record.timezone)
        assertEquals(start.toString(), record.startedAt)
        assertEquals(end.toString(), record.endedAt)
        assertEquals("2026-09-27", record.localDate)
        assertEquals("2026-09-27", IngestionClient.mutation(user, record).getJSONArray("affected_local_dates").getString(0))
    }

    @Test fun crossMidnightMutationKeepsBothAffectedDatesButDoesNotSplitOrSumValue() {
        val mutation = IngestionClient.mutation(user, source())
        val dates = mutation.getJSONArray("affected_local_dates")
        assertEquals(2, dates.length())
        assertEquals("2026-09-27", dates.getString(0))
        assertEquals("2026-09-28", dates.getString(1))
        val canonical = mutation.getJSONObject("record")
        assertEquals(start.toString(), canonical.getString("started_at"))
        assertEquals(end.toString(), canonical.getString("ended_at"))
        assertEquals(90.5, canonical.getDouble("value"), 0.0)
        assertEquals("kcal", canonical.getString("unit"))
    }

    @Test fun replayIsStableAndDifferentOriginsCannotCollapseIntoOneRecord() {
        val fitbit = source()
        val google = source(origin = "com.google.android.apps.fitness")
        val replay = IngestionClient.mutation(user, fitbit)
        assertEquals(replay.getString("idempotency_key"), IngestionClient.mutation(user, fitbit).getString("idempotency_key"))
        assertNotEquals(replay.getString("idempotency_key"), IngestionClient.mutation(user, google).getString("idempotency_key"))
        val plan = BatchPlanner.plan(user, listOf(fitbit, google))
        assertEquals(2, plan.batches.single().recordCount)
        val batch = JSONObject(plan.batches.single().body).getJSONArray("mutations")
        assertNotEquals(batch.getJSONObject(0).getString("source_app"), batch.getJSONObject(1).getString("source_app"))
    }

    @Test fun longSourceIntervalKeepsRawTimesAndDoesNotBlockOtherDomains() {
        val longStart = Instant.parse("2026-01-01T00:00:00Z")
        val longEnd = Instant.parse("2026-03-01T16:00:00Z")
        val longEnergy = source().copy(
            startedAt = longStart.toString(), endedAt = longEnd.toString(),
            recordedAt = longEnd.toString(), localDate = "2026-03-02",
        )
        val dates = IngestionClient.mutation(user, longEnergy).getJSONArray("affected_local_dates")
        assertEquals(3, dates.length())
        assertEquals("2026-01-01", dates.getString(0))
        assertEquals("2026-03-01", dates.getString(1))
        assertEquals("2026-03-02", dates.getString(2))
        val steps = CanonicalHealthRecord(
            domain = "steps", sourceApp = "com.example.health", sourceRecordId = "steps-1",
            sourceUpdatedAt = "2026-03-02T01:00:00Z", recordedAt = "2026-03-02T00:00:00Z",
            startedAt = "2026-03-01T23:59:00Z", endedAt = "2026-03-02T00:00:00Z",
            timezone = "Asia/Taipei", localDate = "2026-03-02", value = 10.0, unit = "count",
        )
        val plan = BatchPlanner.plan(user, listOf(longEnergy, steps))
        assertEquals(2, plan.batches.single().recordCount)
        val mutations = JSONObject(plan.batches.single().body).getJSONArray("mutations")
        assertEquals(longStart.toString(), mutations.getJSONObject(0).getJSONObject("record").getString("started_at"))
        assertEquals(longEnd.toString(), mutations.getJSONObject(0).getJSONObject("record").getString("ended_at"))
    }

    @Test fun sourceRevisionAndContentChangeRemainDistinct() {
        val first = IngestionClient.mutation(user, source())
        val updated = IngestionClient.mutation(user, source(value = 91.0).copy(sourceUpdatedAt = "2026-09-28T03:00:00Z"))
        assertNotEquals(first.getLong("source_revision"), updated.getLong("source_revision"))
        assertNotEquals(first.getString("source_content_hash"), updated.getString("source_content_hash"))
    }

    @Test fun invalidEnergyAndIntervalFailClosed() {
        assertThrows(IllegalArgumentException::class.java) { source(value = Double.NaN) }
        assertThrows(IllegalArgumentException::class.java) { source(value = -1.0) }
        assertThrows(IllegalArgumentException::class.java) {
            TotalEnergyRecordMapper.fromSource("origin", "id", Instant.now(), end, start, 1.0, taipei)
        }
    }
}
