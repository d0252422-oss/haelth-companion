package app.healthcompanion.sync

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

/** Counts describe the source model, not medical values. Null is an unknown read. */
data class DomainReadTrace(
    val sourceCount: Int?, val mappedCount: Int, val pages: Int,
    val status: String, val dropReasons: Map<String, Int> = emptyMap(),
    val recoveryAttempts: Int = 0,
)

class IncompleteIngestionReceipt : IOException("DATA_INTEGRITY_WARNING_INCOMPLETE_RECEIPT")
class DomainCompletenessExhausted : IOException("DATA_INTEGRITY_WARNING_DOMAIN_INCOMPLETE")

internal data class IngestionReceipt(val accepted: List<String>, val duplicate: List<String>, val rejectedCount: Int, val rejectionReasons: Map<String, Int> = emptyMap()) {
    fun verifies(expected: List<String>): Boolean = rejectedCount == 0 &&
        (accepted + duplicate).groupingBy { it }.eachCount() == expected.groupingBy { it }.eachCount()

    companion object {
        fun parse(body: String): IngestionReceipt? = runCatching {
            val value = JSONObject(body)
            fun keys(name: String): List<String> {
                val array = value.getJSONArray(name)
                require(array.length() <= BatchPlanner.MAX_RECORDS_PER_BATCH)
                return List(array.length()) { index ->
                    val key = array.get(index)
                    require(key is String && key.matches(Regex("[a-f0-9]{64}")))
                    key
                }
            }
            val rejected = value.getJSONArray("rejected")
            require(rejected.length() <= BatchPlanner.MAX_RECORDS_PER_BATCH)
            val reasons = List(rejected.length()) { index ->
                rejected.getJSONObject(index).optString("error_code").takeIf { it.matches(Regex("[A-Z][A-Z0-9_]{0,63}")) } ?: "INVALID_REASON_CODE"
            }.groupingBy { it }.eachCount()
            IngestionReceipt(keys("accepted_idempotency_keys"), keys("duplicate_idempotency_keys"), rejected.length(), reasons)
        }.getOrNull()
    }
}

object SyncCompletenessPolicy {
    const val CONTRACT_VERSION = 1
    const val MAX_DOMAIN_RECOVERY_ATTEMPTS = 2
    val SUPPORTED_DOMAINS = setOf("steps", "heart_rate", "resting_heart_rate", "sleep", "sleep_stage", "weight", "workout", "hrv", "spo2", "total_energy")
    fun incompleteDomains(read: Map<String, DomainReadTrace>, persisted: Map<String, Int>): Set<String> =
        read.filter { (domain, trace) ->
            trace.status != "COMPLETE" || trace.dropReasons.isNotEmpty() ||
                (trace.sourceCount ?: 0) > 0 && trace.mappedCount == 0 ||
                trace.mappedCount > (persisted[domain] ?: 0)
        }.keys

    fun contract(runId: String, canonicalUserId: String, start: String, end: String,
        read: Map<String, DomainReadTrace>, persisted: Map<String, Int>, requested: Set<String>): JSONObject {
        val incomplete = incompleteDomains(read, persisted)
        val missingReads = requested - read.keys
        val rows = JSONObject()
        read.toSortedMap().forEach { (domain, trace) ->
            rows.put(domain, JSONObject().put("source_count", trace.sourceCount ?: JSONObject.NULL)
                .put("mapped_count", trace.mappedCount).put("upload_count", persisted[domain] ?: 0)
                .put("persisted_count", persisted[domain] ?: if (trace.sourceCount == 0 && trace.status == "COMPLETE") 0 else JSONObject.NULL).put("pages", trace.pages)
                .put("read_status", trace.status).put("drop_reasons", JSONObject(trace.dropReasons))
                .put("recovery_attempts", trace.recoveryAttempts))
        }
        return JSONObject().put("schema_version", "SYNC_COMPLETENESS_CONTRACT_V1")
            .put("sync_run_id", runId).put("canonical_user_id", canonicalUserId)
            .put("range_start", start).put("range_end", end)
            .put("domains_requested", JSONArray(requested.sorted()))
            .put("domains_read", JSONArray(read.keys.sorted()))
            .put("domains_mapped", JSONArray(read.filterValues { it.mappedCount > 0 }.keys.sorted()))
            .put("domains_uploaded", JSONArray(persisted.filterValues { it > 0 }.keys.sorted()))
            .put("domains_persisted", JSONArray(persisted.filterValues { it > 0 }.keys.sorted()))
            .put("per_domain", rows)
            .put("status", if (incomplete.isEmpty() && missingReads.isEmpty()) "COMPLETE" else "INCOMPLETE")
            .put("warnings", JSONArray((incomplete + missingReads).sorted().map { "DATA_INTEGRITY_WARNING:$it" }))
            .put("persistence_evidence", "EXACT_SQL_COMMIT_RECEIPT_KEYS")
            .put("count_scope", "CUMULATIVE_VERIFIED_UPLOAD_PLAN")
    }
}
