package app.healthcompanion.sync

import org.json.JSONObject
import java.time.Instant
import java.util.UUID

/** Request diagnostics only. The server must never use these fields for identity or authorization. */
enum class SyncTriggerSource {
    PERIODIC_WORKER, APP_START, MANUAL_SYNC, BACKFILL, BOOT_RECOVERY, RETRY, UNKNOWN;

    companion object {
        fun fromWorkInput(value: String?): SyncTriggerSource =
            entries.firstOrNull { it.name == value && it != RETRY } ?: UNKNOWN
    }
}

internal data class SyncTriggerDiagnostic(
    val origin: SyncTriggerSource,
    val flowId: String = UUID.randomUUID().toString(),
    val workerId: String? = null,
    val startedAt: String = Instant.now().toString(),
    val workerAttempt: Int = 0,
) {
    fun request(attempt: Int): JSONObject = JSONObject()
        .put("trigger_source", if (workerAttempt > 0 || attempt > 1) SyncTriggerSource.RETRY.name else origin.name)
        .put("origin_trigger_source", origin.name)
        .put("flow_id", flowId)
        .put("worker_id", workerId ?: JSONObject.NULL)
        .put("attempt", attempt)
        .put("worker_attempt", workerAttempt)
        .put("started_at", startedAt)
}
