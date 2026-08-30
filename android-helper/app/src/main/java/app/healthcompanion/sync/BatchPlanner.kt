package app.healthcompanion.sync

import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.StandardCharsets

data class PlannedBatch(val body: String, val recordCount: Int)
data class BatchPlan(val fingerprint: String, val batches: List<PlannedBatch>)
class OversizedHealthRecord(val domain: String, val sourceRecordHash: String) : IllegalArgumentException("SINGLE_RECORD_OVERSIZE")

object BatchPlanner {
    const val MAX_RECORDS_PER_BATCH = 100
    const val MAX_APPROX_SERIALIZED_BYTES_PER_BATCH = 256 * 1024

    fun plan(userId: String, records: List<CanonicalHealthRecord>): BatchPlan {
        val ordered = records.sortedWith(compareBy<CanonicalHealthRecord>({ it.recordedAt }, { it.domain }, { it.sourceApp }, { it.sourceRecordId }))
        val mutations = ordered.map { IngestionClient.mutation(userId, it) }
        val batches = mutableListOf<PlannedBatch>()
        var current = mutableListOf<JSONObject>()
        for ((index, mutation) in mutations.withIndex()) {
            val single = envelope(userId, listOf(mutation))
            if (utf8Bytes(single) > MAX_APPROX_SERIALIZED_BYTES_PER_BATCH) {
                throw OversizedHealthRecord(ordered[index].domain, CanonicalIdentity.sha256(ordered[index].sourceRecordId))
            }
            val candidate = current + mutation
            val candidateBody = envelope(userId, candidate)
            if (current.isNotEmpty() && (candidate.size > MAX_RECORDS_PER_BATCH || utf8Bytes(candidateBody) > MAX_APPROX_SERIALIZED_BYTES_PER_BATCH)) {
                val body = envelope(userId, current)
                batches += PlannedBatch(body, current.size)
                current = mutableListOf(mutation)
            } else current.add(mutation)
        }
        if (current.isNotEmpty()) {
            val body = envelope(userId, current)
            batches += PlannedBatch(body, current.size)
        }
        val fingerprint = CanonicalIdentity.sha256(batches.joinToString("\u001f") { CanonicalIdentity.sha256(it.body) })
        return BatchPlan(fingerprint, batches)
    }

    fun resumeIndex(plan: BatchPlan, saved: SyncCheckpoint?): Int =
        if (saved?.planFingerprint == plan.fingerprint) saved.nextBatchIndex.coerceIn(0, plan.batches.size) else 0

    private fun envelope(userId: String, mutations: List<JSONObject>) = JSONObject()
        .put("environment", "beta")
        .put("canonical_user_id", userId)
        .put("mutations", JSONArray(mutations))
        .toString()

    private fun utf8Bytes(value: String) = value.toByteArray(StandardCharsets.UTF_8).size
}
