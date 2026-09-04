package app.healthcompanion.sync

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BatchPlannerTest {
    private val user = "11111111-1111-4111-8111-111111111111"

    @Test fun smallPayloadUsesOneBatch() {
        val plan = BatchPlanner.plan(user, listOf(record(1), record(2)))
        assertEquals(1, plan.batches.size)
        assertEquals(2, plan.batches.single().recordCount)
    }

    @Test fun highVolumeHeartRateUsesRecordAndByteBoundedBatchesWithoutDropping() {
        val records = (1..1_205).map { record(it, "heart_rate") }
        val plan = BatchPlanner.plan(user, records)
        assertTrue(plan.batches.size > 12)
        assertEquals(records.size, plan.batches.sumOf { it.recordCount })
        plan.batches.forEach { batch ->
            assertTrue(batch.recordCount <= BatchPlanner.MAX_RECORDS_PER_BATCH)
            assertTrue(batch.body.toByteArray(Charsets.UTF_8).size <= BatchPlanner.MAX_APPROX_SERIALIZED_BYTES_PER_BATCH)
        }
    }

    @Test fun deterministicOrderingAndReplayFingerprint() {
        val first = BatchPlanner.plan(user, listOf(record(3), record(1), record(2)))
        val replay = BatchPlanner.plan(user, listOf(record(2), record(3), record(1)))
        assertEquals(first.fingerprint, replay.fingerprint)
        val ids = JSONObject(first.batches.single().body).getJSONArray("mutations")
        assertEquals("record-1", ids.getJSONObject(0).getString("source_record_id"))
    }

    @Test(expected = OversizedHealthRecord::class)
    fun singleRecordOversizeFailsExplicitly() {
        BatchPlanner.plan(user, listOf(record(1).copy(sourceApp = "x".repeat(300_000))))
    }

    @Test fun changedPayloadInvalidatesCheckpointAndSamePlanResumes() {
        val plan = BatchPlanner.plan(user, (1..250).map { record(it) })
        assertEquals(2, BatchPlanner.resumeIndex(plan, SyncCheckpoint(plan.fingerprint, 2)))
        val changed = BatchPlanner.plan(user, (1..251).map { record(it) })
        assertNotEquals(plan.fingerprint, changed.fingerprint)
        assertEquals(0, BatchPlanner.resumeIndex(changed, SyncCheckpoint(plan.fingerprint, 2)))
    }

    private fun record(index: Int, domain: String = "steps") = CanonicalHealthRecord(
        domain = domain, sourceApp = "com.example.health", sourceRecordId = "record-$index",
        sourceUpdatedAt = "2026-08-30T00:00:${(index % 60).toString().padStart(2, '0')}Z",
        recordedAt = "2026-08-30T00:00:${(index % 60).toString().padStart(2, '0')}Z",
        startedAt = "2026-08-30T00:00:00Z", endedAt = "2026-08-30T00:01:00Z",
        timezone = "Asia/Taipei", localDate = "2026-08-30", value = index.toDouble(),
        unit = if (domain == "heart_rate") "bpm" else "count",
    )
}
