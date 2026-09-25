package app.healthcompanion.sync

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.system.measureTimeMillis

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

    @Test fun linearPlannerPreservesLegacyBodiesAndCheckpointFingerprint() {
        val records = (1..237).map { index ->
            record(index, if (index % 3 == 0) "heart_rate" else "steps").copy(
                sourceApp = if (index % 5 == 0) "裝置 A" else "com.example.health",
            )
        }

        val current = BatchPlanner.plan(user, records)
        val legacy = legacyPlan(user, records)

        assertEquals(legacy.fingerprint, current.fingerprint)
        assertEquals(legacy.batches, current.batches)
    }

    @Test fun realBackfillScalePlanningFitsInsideWorkerBudget() {
        lateinit var plan: BatchPlan
        val elapsedMs = measureTimeMillis {
            plan = BatchPlanner.plan(user, (1..42_235).map { record(it, "heart_rate") })
        }

        assertEquals(42_235, plan.batches.sumOf { it.recordCount })
        assertTrue("planning took ${elapsedMs}ms", elapsedMs < 30_000)
    }

    @Test fun streamingCheckpointResumesAtExactRecordWithoutRebuildingCompletedPayloads() {
        val records = (1..250).map { record(it) }
        val initial = BatchPlanner.streamingPlan(user, records, null)
        val first = BatchPlanner.nextStreamingBatch(user, initial.orderedRecords, initial.nextRecordIndex)!!
        val checkpoint = SyncCheckpoint(initial.fingerprint, 1, first.nextRecordIndex)

        val resumed = BatchPlanner.streamingPlan(user, records.reversed(), checkpoint)

        assertEquals(100, resumed.nextRecordIndex)
        assertEquals(1, resumed.nextBatchIndex)
        assertEquals(100, BatchPlanner.nextStreamingBatch(user, resumed.orderedRecords, resumed.nextRecordIndex)!!.recordCount)
    }

    @Test fun changedRecordInvalidatesStreamingRecordCursorFailClosed() {
        val records = (1..250).map { record(it) }
        val initial = BatchPlanner.streamingPlan(user, records, null)
        val checkpoint = SyncCheckpoint(initial.fingerprint, 2, 200)
        val changed = records.toMutableList().also { it[120] = it[120].copy(value = 9999.0) }

        val resumed = BatchPlanner.streamingPlan(user, changed, checkpoint)

        assertEquals(0, resumed.nextRecordIndex)
        assertEquals(0, resumed.nextBatchIndex)
    }

    @Test fun changedDatasetWithStableFrontierContinuesCurrentPassAndMarksCatchUp() {
        val records = (1..250).map { record(it) }
        val initial = BatchPlanner.streamingPlan(user, records, null)
        val frontierIndex = 100
        val checkpoint = SyncCheckpoint(
            initial.fingerprint,
            nextBatchIndex = 1,
            nextRecordIndex = frontierIndex,
            lastRecordKey = BatchPlanner.encodedRecordKey(initial.orderedRecords[frontierIndex - 1]),
        )
        val changed = records.toMutableList().also {
            it += record(999).copy(recordedAt = "2026-08-29T23:59:59Z")
            it[200] = it[200].copy(value = 9999.0)
        }

        val resumed = BatchPlanner.streamingPlan(user, changed, checkpoint)

        assertEquals(101, resumed.nextRecordIndex)
        assertEquals(1, resumed.nextBatchIndex)
        assertEquals(initial.fingerprint, resumed.fingerprint)
        assertNotEquals(resumed.fingerprint, resumed.currentFingerprint)
        assertTrue(resumed.datasetChanged)
    }

    @Test fun reconciliationSeedStartsCurrentSnapshotWithoutLosingExtendedRetryBudget() {
        val original = (1..250).map { record(it) }
        val oldPlan = BatchPlanner.streamingPlan(user, original, null)
        val cleanPassSeed = SyncCheckpoint(
            planFingerprint = oldPlan.fingerprint,
            nextBatchIndex = 0,
            nextRecordIndex = 0,
            reconciliationPass = 2,
        )
        val changed = original + record(999).copy(recordedAt = "2026-08-31T23:59:59Z")

        val restarted = BatchPlanner.streamingPlan(user, changed, cleanPassSeed)

        assertEquals(0, restarted.nextRecordIndex)
        assertEquals(0, restarted.nextBatchIndex)
        assertEquals(2, restarted.reconciliationPass)
        assertEquals(restarted.currentFingerprint, restarted.fingerprint)
        assertFalse(restarted.datasetChanged)
    }

    @Test fun legacyCheckpointFromAnotherUserRestartsWithoutCrossUserResume() {
        val records = (1..250).map { record(it) }
        val firstUser = BatchPlanner.streamingPlan(user, records, null)
        val legacy = SyncCheckpoint(firstUser.fingerprint, nextBatchIndex = 1, nextRecordIndex = 100)

        val anotherUser = BatchPlanner.streamingPlan(
            "22222222-2222-4222-8222-222222222222",
            records,
            legacy,
        )

        assertEquals(0, anotherUser.nextRecordIndex)
        assertEquals(0, anotherUser.nextBatchIndex)
        assertFalse(anotherUser.datasetChanged)
    }

    private fun legacyPlan(userId: String, records: List<CanonicalHealthRecord>): BatchPlan {
        val ordered = records.sortedWith(compareBy<CanonicalHealthRecord>({ it.recordedAt }, { it.domain }, { it.sourceApp }, { it.sourceRecordId }))
        val mutations = ordered.map { IngestionClient.mutation(userId, it) }
        val batches = mutableListOf<PlannedBatch>()
        var current = mutableListOf<JSONObject>()
        for ((index, mutation) in mutations.withIndex()) {
            val single = legacyEnvelope(userId, listOf(mutation))
            if (single.toByteArray(Charsets.UTF_8).size > BatchPlanner.MAX_APPROX_SERIALIZED_BYTES_PER_BATCH) {
                throw OversizedHealthRecord(ordered[index].domain, CanonicalIdentity.sha256(ordered[index].sourceRecordId))
            }
            val candidate = current + mutation
            val candidateBody = legacyEnvelope(userId, candidate)
            if (current.isNotEmpty() && (candidate.size > BatchPlanner.MAX_RECORDS_PER_BATCH || candidateBody.toByteArray(Charsets.UTF_8).size > BatchPlanner.MAX_APPROX_SERIALIZED_BYTES_PER_BATCH)) {
                val body = legacyEnvelope(userId, current)
                batches += PlannedBatch(body, current.size)
                current = mutableListOf(mutation)
            } else current.add(mutation)
        }
        if (current.isNotEmpty()) batches += PlannedBatch(legacyEnvelope(userId, current), current.size)
        return BatchPlan(
            CanonicalIdentity.sha256(batches.joinToString("\u001f") { CanonicalIdentity.sha256(it.body) }),
            batches,
        )
    }

    private fun legacyEnvelope(userId: String, mutations: List<JSONObject>) = JSONObject()
        .put("environment", "beta")
        .put("canonical_user_id", userId)
        .put("mutations", JSONArray(mutations))
        .toString()

    private fun record(index: Int, domain: String = "steps") = CanonicalHealthRecord(
        domain = domain, sourceApp = "com.example.health", sourceRecordId = "record-$index",
        sourceUpdatedAt = "2026-08-30T00:00:${(index % 60).toString().padStart(2, '0')}Z",
        recordedAt = "2026-08-30T00:00:${(index % 60).toString().padStart(2, '0')}Z",
        startedAt = "2026-08-30T00:00:00Z", endedAt = "2026-08-30T00:01:00Z",
        timezone = "Asia/Taipei", localDate = "2026-08-30", value = index.toDouble(),
        unit = if (domain == "heart_rate") "bpm" else "count",
    )
}
