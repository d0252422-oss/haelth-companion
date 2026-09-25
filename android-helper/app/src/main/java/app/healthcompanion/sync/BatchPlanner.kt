package app.healthcompanion.sync

import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.security.MessageDigest

data class PlannedBatch(val body: String, val recordCount: Int)
data class BatchPlan(val fingerprint: String, val batches: List<PlannedBatch>)
data class StreamingBatchPlan(
    val fingerprint: String,
    val currentFingerprint: String,
    val orderedRecords: List<CanonicalHealthRecord>,
    val nextRecordIndex: Int,
    val nextBatchIndex: Int,
    val reconciliationPass: Int,
    val datasetChanged: Boolean,
)
data class StreamingBatch(val body: String, val recordCount: Int, val nextRecordIndex: Int)
class OversizedHealthRecord(val domain: String, val sourceRecordHash: String) : IllegalArgumentException("SINGLE_RECORD_OVERSIZE")

object BatchPlanner {
    const val MAX_RECORDS_PER_BATCH = 100
    const val MAX_APPROX_SERIALIZED_BYTES_PER_BATCH = 256 * 1024

    fun plan(userId: String, records: List<CanonicalHealthRecord>): BatchPlan {
        val ordered = records.sortedWith(RECORD_COMPARATOR)
        val batches = mutableListOf<PlannedBatch>()
        var current = mutableListOf<JSONObject>()
        val emptyEnvelopeBytes = utf8Bytes(envelope(userId, emptyList()))
        var currentBytes = emptyEnvelopeBytes
        for (record in ordered) {
            val mutation = IngestionClient.mutation(userId, record)
            val mutationBytes = utf8Bytes(mutation.toString())
            val singleBytes = emptyEnvelopeBytes + mutationBytes
            if (singleBytes > MAX_APPROX_SERIALIZED_BYTES_PER_BATCH) {
                throw OversizedHealthRecord(record.domain, CanonicalIdentity.sha256(record.sourceRecordId))
            }
            val candidateBytes = currentBytes + mutationBytes + if (current.isEmpty()) 0 else 1
            if (current.isNotEmpty() && (current.size + 1 > MAX_RECORDS_PER_BATCH || candidateBytes > MAX_APPROX_SERIALIZED_BYTES_PER_BATCH)) {
                val body = envelope(userId, current)
                batches += PlannedBatch(body, current.size)
                current = mutableListOf(mutation)
                currentBytes = singleBytes
            } else {
                current.add(mutation)
                currentBytes = candidateBytes
            }
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

    fun streamingPlan(userId: String, records: List<CanonicalHealthRecord>, saved: SyncCheckpoint?): StreamingBatchPlan {
        val ordered = records.sortedWith(RECORD_COMPARATOR)
        val currentFingerprint = recordFingerprint(userId, ordered)
        val savedKey = saved?.lastRecordKey?.let(::decodeRecordKey)
        val exactIndexValid = saved != null && saved.planFingerprint == currentFingerprint &&
            saved.nextRecordIndex in 0..ordered.size && saved.nextBatchIndex >= 0 &&
            (saved.nextRecordIndex == 0 || savedKey == null || recordSortKey(ordered[saved.nextRecordIndex - 1]) == savedKey)
        val frontierResumeIndex = savedKey?.let { frontier ->
            ordered.indexOfFirst { recordSortKey(it) > frontier }.let { if (it < 0) ordered.size else it }
        }
        val canResumeFromFrontier = saved != null && frontierResumeIndex != null && saved.nextBatchIndex >= 0
        val reconciliationSeed = saved != null && saved.nextBatchIndex == 0 &&
            saved.nextRecordIndex == 0 && saved.lastRecordKey == null && saved.reconciliationPass > 0
        val resumeIndex = when {
            exactIndexValid -> saved!!.nextRecordIndex
            canResumeFromFrontier -> frontierResumeIndex!!
            else -> 0
        }
        val continuingSavedPass = exactIndexValid || canResumeFromFrontier || reconciliationSeed
        // A zero-cursor reconciliation checkpoint intentionally starts a clean
        // pass. Bind that pass to the snapshot available now while preserving
        // its extended reconciliation retry budget. Any drift after the first
        // durable batch is still detected through the saved frontier.
        val passFingerprint = if (reconciliationSeed) currentFingerprint
            else if (continuingSavedPass) saved!!.planFingerprint
            else currentFingerprint
        val datasetChanged = if (reconciliationSeed) false else if (continuingSavedPass) {
            saved!!.datasetChanged || saved.planFingerprint != currentFingerprint
        } else false
        return StreamingBatchPlan(
            passFingerprint,
            currentFingerprint,
            ordered,
            resumeIndex,
            if (continuingSavedPass) saved!!.nextBatchIndex else 0,
            if (continuingSavedPass) saved!!.reconciliationPass else 0,
            datasetChanged,
        )
    }

    internal fun encodedRecordKey(record: CanonicalHealthRecord): String = recordSortKey(record).encode()

    fun nextStreamingBatch(userId: String, ordered: List<CanonicalHealthRecord>, startRecordIndex: Int): StreamingBatch? {
        if (startRecordIndex !in ordered.indices) return null
        val current = mutableListOf<JSONObject>()
        val emptyEnvelopeBytes = utf8Bytes(envelope(userId, emptyList()))
        var currentBytes = emptyEnvelopeBytes
        var index = startRecordIndex
        while (index < ordered.size) {
            val record = ordered[index]
            val mutation = IngestionClient.mutation(userId, record)
            val mutationBytes = utf8Bytes(mutation.toString())
            val singleBytes = emptyEnvelopeBytes + mutationBytes
            if (singleBytes > MAX_APPROX_SERIALIZED_BYTES_PER_BATCH) {
                throw OversizedHealthRecord(record.domain, CanonicalIdentity.sha256(record.sourceRecordId))
            }
            val candidateBytes = currentBytes + mutationBytes + if (current.isEmpty()) 0 else 1
            if (current.isNotEmpty() && (current.size + 1 > MAX_RECORDS_PER_BATCH || candidateBytes > MAX_APPROX_SERIALIZED_BYTES_PER_BATCH)) break
            current += mutation
            currentBytes = candidateBytes
            index += 1
        }
        return StreamingBatch(envelope(userId, current), current.size, index)
    }

    fun estimatedTotalBatches(completedBatches: Int, remainingRecords: Int): Int =
        completedBatches + ((remainingRecords.coerceAtLeast(0) + MAX_RECORDS_PER_BATCH - 1) / MAX_RECORDS_PER_BATCH)

    private fun recordFingerprint(userId: String, ordered: List<CanonicalHealthRecord>): String {
        val digest = MessageDigest.getInstance("SHA-256")
        fun updateInt(value: Int) {
            digest.update((value ushr 24).toByte())
            digest.update((value ushr 16).toByte())
            digest.update((value ushr 8).toByte())
            digest.update(value.toByte())
        }
        fun updateLong(value: Long) {
            updateInt((value ushr 32).toInt())
            updateInt(value.toInt())
        }
        fun updateString(value: String?) {
            if (value == null) {
                updateInt(-1)
                return
            }
            val bytes = value.toByteArray(StandardCharsets.UTF_8)
            updateInt(bytes.size)
            digest.update(bytes)
        }
        updateString("health-sync-record-plan-v2")
        updateString(userId.lowercase())
        updateInt(ordered.size)
        ordered.forEach { record ->
            updateString(record.domain)
            updateString(record.sourceApp)
            updateString(record.sourceRecordId)
            updateString(record.sourceUpdatedAt)
            updateString(record.recordedAt)
            updateString(record.startedAt)
            updateString(record.endedAt)
            updateString(record.timezone)
            updateString(record.localDate)
            updateLong(java.lang.Double.doubleToLongBits(record.value))
            updateString(record.unit)
            updateString(record.stage)
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun envelope(userId: String, mutations: List<JSONObject>) = JSONObject()
        .put("environment", "beta")
        .put("canonical_user_id", userId)
        .put("mutations", JSONArray(mutations))
        .toString()

    private fun utf8Bytes(value: String) = value.toByteArray(StandardCharsets.UTF_8).size

    private data class RecordSortKey(
        val recordedAt: String,
        val domain: String,
        val sourceApp: String,
        val sourceRecordId: String,
    ) : Comparable<RecordSortKey> {
        override fun compareTo(other: RecordSortKey): Int =
            compareValuesBy(this, other, RecordSortKey::recordedAt, RecordSortKey::domain, RecordSortKey::sourceApp, RecordSortKey::sourceRecordId)

        fun encode(): String = JSONArray().put(recordedAt).put(domain).put(sourceApp).put(sourceRecordId).toString()
    }

    private fun recordSortKey(record: CanonicalHealthRecord) = RecordSortKey(
        record.recordedAt,
        record.domain,
        record.sourceApp,
        record.sourceRecordId,
    )

    private fun decodeRecordKey(value: String): RecordSortKey? = runCatching {
        val key = JSONArray(value)
        require(key.length() == 4)
        RecordSortKey(key.getString(0), key.getString(1), key.getString(2), key.getString(3))
    }.getOrNull()

    private val RECORD_COMPARATOR = compareBy<CanonicalHealthRecord>(
        { it.recordedAt },
        { it.domain },
        { it.sourceApp },
        { it.sourceRecordId },
    )
}
