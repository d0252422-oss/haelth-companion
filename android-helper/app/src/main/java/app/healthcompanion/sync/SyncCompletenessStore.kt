package app.healthcompanion.sync

import android.content.Context
import org.json.JSONObject
import java.time.Instant

/** Latest account-scoped run only. No health values or credentials are stored. */
internal class SyncCompletenessStore(context: Context, private val userId: String) {
    private val preferences = context.getSharedPreferences("sync_completeness", Context.MODE_PRIVATE)
    private val key = CanonicalIdentity.sha256(userId).take(16)
    fun begin(runId: String, window: SyncWindow, requested: Set<String> = SyncCompletenessPolicy.SUPPORTED_DOMAINS) {
        val traces = requested.associateWith { DomainReadTrace(null, 0, 0, "PENDING_PERMISSION_AND_READ") }
        val contract = SyncCompletenessPolicy.contract(runId, userId, window.start.toString(), window.end.toString(), traces, emptyMap(), requested)
            .put("status", "IN_PROGRESS")
        preferences.edit().putString(key, contract.toString()).commit()
    }
    fun finishPending(runId: String) {
        val existing = preferences.getString(key, null)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return
        if (existing.optString("sync_run_id") == runId && existing.optString("status") == "IN_PROGRESS") {
            existing.put("status", "INCOMPLETE")
            preferences.edit().putString(key, existing.toString()).commit()
        }
    }
    fun save(runId: String, window: SyncWindow, read: HealthReadResult, persisted: Map<String, Int> = emptyMap()) {
        val earliestRead = read.domainRangeStarts.values.map(Instant::parse).minOrNull() ?: window.start
        val contract = SyncCompletenessPolicy.contract(runId, userId, earliestRead.toString(), window.end.toString(),
            read.domainTraces, persisted, read.domainTraces.keys)
            .put("per_domain_range_start", JSONObject(read.domainRangeStarts))
        preferences.edit().putString(key, contract.toString()).commit()
    }
}
