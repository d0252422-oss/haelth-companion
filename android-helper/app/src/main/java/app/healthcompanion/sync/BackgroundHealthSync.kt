package app.healthcompanion.sync

import android.content.Context
import android.content.SharedPreferences
import android.app.job.JobScheduler
import android.os.Build
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.await
import androidx.work.WorkInfo
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import java.time.Instant
import java.io.IOException
import org.json.JSONObject
import kotlinx.coroutines.isActive
import java.util.concurrent.TimeUnit

class SyncRuntimeStateStore internal constructor(
    private val preferences: SharedPreferences,
    private val contextPreferences: SharedPreferences,
) {
    constructor(context: Context) : this(
        context.getSharedPreferences("sync_runtime_state", Context.MODE_PRIVATE),
        context.getSharedPreferences("sync_status", Context.MODE_PRIVATE),
    )

    fun markHistoryPending(userId: String) { if (!preferences.edit().putBoolean(key(userId, HISTORY_PENDING), true).commit()) throw CheckpointPersistenceFailed() }
    fun periodicSchedulerHealth(userId: String): String? = preferences.getString(key(userId, PERIODIC_SCHEDULER_HEALTH), null)
    fun lastPeriodicRepairAt(userId: String): Long = preferences.getLong(key(userId, PERIODIC_REPAIR_AT), 0L)
    fun recordPeriodicSchedulerHealth(userId: String, health: String, repairAtMs: Long? = null) {
        val editor = preferences.edit().putString(key(userId, PERIODIC_SCHEDULER_HEALTH), health)
        repairAtMs?.let { editor.putLong(key(userId, PERIODIC_REPAIR_AT), it) }
        editor.apply()
    }
    fun markHistoryComplete(userId: String) { if (!preferences.edit().putBoolean(key(userId, HISTORY_PENDING), false).commit()) throw CheckpointPersistenceFailed() }
    fun isHistoryPending(userId: String): Boolean = preferences.getBoolean(key(userId, HISTORY_PENDING), false)
    fun saveBackgroundResult(userId: String, result: String) = preferences.edit()
        .putString(key(userId, BACKGROUND_RESULT), result)
        .putString(key(userId, BACKGROUND_RESULT_AT), Instant.now().toString())
        .apply()
    fun recordEnqueued(userId: String, workId: String) = preferences.edit()
        .putString(key(userId, BACKGROUND_WORK_ID), workId)
        .putString(key(userId, BACKGROUND_ENQUEUED_AT), Instant.now().toString())
        .putString(key(userId, BACKGROUND_LAST_PROGRESS_AT), Instant.now().toString())
        .putString(key(userId, BACKGROUND_STAGE), "ENQUEUED")
        .putString(key(userId, BACKGROUND_RESULT), "ENQUEUED")
        .putString(key(userId, BACKGROUND_RESULT_AT), Instant.now().toString())
        .putInt(key(userId, BACKGROUND_REQUEST_COUNT), 0)
        .putInt(key(userId, BACKGROUND_ATTEMPT_COUNT), 0)
        .remove(key(userId, BACKGROUND_TERMINAL_AT))
        .remove(key(userId, BACKGROUND_TERMINAL_STAGE))
        .apply()
    fun recordStarted(userId: String, workId: String, attemptCount: Int = 0) = preferences.edit()
        .putString(key(userId, BACKGROUND_WORK_ID), workId)
        .putString(key(userId, BACKGROUND_STARTED_AT), Instant.now().toString())
        .putString(key(userId, BACKGROUND_LAST_PROGRESS_AT), Instant.now().toString())
        .putString(key(userId, BACKGROUND_STAGE), "STARTING")
        .putInt(key(userId, BACKGROUND_REQUEST_COUNT), 0)
        .putInt(key(userId, BACKGROUND_ATTEMPT_COUNT), attemptCount)
        .putString(key(userId, BACKGROUND_RESULT), "SYNCING")
        .putString(key(userId, BACKGROUND_RESULT_AT), Instant.now().toString())
        .remove(key(userId, BACKGROUND_TERMINAL_STAGE))
        .remove(key(userId, BACKGROUND_READ_RECORD_COUNT))
        .remove(key(userId, BACKGROUND_READ_DOMAIN_COUNTS))
        .remove(key(userId, BACKGROUND_READ_SOURCE_APPS))
        .remove(key(userId, BACKGROUND_HTTP_STATUS))
        .remove(key(userId, BACKGROUND_HTTP_ERROR_CODE))
        .remove(key(userId, BACKGROUND_FAILURE_REASON))
        .remove(key(userId, BACKGROUND_EXCEPTION_CLASS))
        .remove(key(userId, "background_http_accepted_count"))
        .remove(key(userId, "background_http_duplicate_count"))
        .remove(key(userId, "background_http_rejected_count"))
        .remove(key(userId, "background_http_rejection_reasons"))
        .apply()
    fun recordProgress(userId: String, stage: String, requestCount: Int? = null) {
        val editor = preferences.edit()
            .putString(key(userId, BACKGROUND_LAST_PROGRESS_AT), Instant.now().toString())
            .putString(key(userId, BACKGROUND_STAGE), stage)
        requestCount?.let { editor.putInt(key(userId, BACKGROUND_REQUEST_COUNT), it) }
        editor.apply()
    }
    fun recordReadSummary(userId: String, records: List<CanonicalHealthRecord>) {
        val domainCounts = records.groupingBy { it.domain }.eachCount().toSortedMap()
            .entries.joinToString(",") { (domain, count) -> "${domain.take(64)}:$count" }
        val sourceApps = records.asSequence().map { it.sourceApp }.distinct().sorted().take(20)
            .joinToString(",") { it.take(128) }
        preferences.edit()
            .putInt(key(userId, BACKGROUND_READ_RECORD_COUNT), records.size)
            .putString(key(userId, BACKGROUND_READ_DOMAIN_COUNTS), domainCounts)
            .putString(key(userId, BACKGROUND_READ_SOURCE_APPS), sourceApps)
            .apply()
    }
    internal fun recordHttpResult(userId: String, result: IngestionHttpResult) {
        val editor = preferences.edit().putInt(key(userId, BACKGROUND_HTTP_STATUS), result.statusCode)
        // Only counts and bounded reason codes survive; receipt identities are excluded.
        mapOf("accepted" to result.acceptedCount, "duplicate" to result.duplicateCount, "rejected" to result.rejectedCount).forEach { (name, count) ->
            if (count == null) editor.remove(key(userId, "background_http_${name}_count"))
            else editor.putInt(key(userId, "background_http_${name}_count"), count)
        }
        editor.putString(key(userId, "background_http_rejection_reasons"),
            result.rejectionReasons.toSortedMap().entries.joinToString(",") { "${it.key}:${it.value}" })
        result.errorCode?.takeIf { it.matches(Regex("[A-Z][A-Z0-9_]{0,63}")) }
            ?.let { editor.putString(key(userId, BACKGROUND_HTTP_ERROR_CODE), it) }
            ?: editor.remove(key(userId, BACKGROUND_HTTP_ERROR_CODE))
        editor.apply()
    }
    fun recordTerminal(userId: String, result: String, error: Throwable? = null) {
        val terminalStage = preferences.getString(key(userId, BACKGROUND_STAGE), null)
            ?.takeUnless { it == "TERMINAL" }
        val now = Instant.now().toString()
        val editor = preferences.edit()
            .putString(key(userId, BACKGROUND_RESULT), result)
            .putString(key(userId, BACKGROUND_RESULT_AT), now)
            .putString(key(userId, BACKGROUND_TERMINAL_AT), now)
            .putString(key(userId, BACKGROUND_STAGE), "TERMINAL")
        terminalStage?.let { editor.putString(key(userId, BACKGROUND_TERMINAL_STAGE), it) }
        val diagnostic = error?.let(SyncFailureDiagnostic::from)
        if (diagnostic == null) {
            editor.remove(key(userId, BACKGROUND_FAILURE_REASON))
                .remove(key(userId, BACKGROUND_EXCEPTION_CLASS))
        } else {
            editor.putString(key(userId, BACKGROUND_FAILURE_REASON), diagnostic.reason)
                .putString(key(userId, BACKGROUND_EXCEPTION_CLASS), diagnostic.exceptionClass)
        }
        if (result == "SUCCESS") editor.remove(key(userId, "pending_status"))
        else editor.putString(key(userId, "pending_status"), JSONObject().put("result", result).put("at", now)
            .put("diagnostic", preferences.getString(key(userId, "run_diagnostic"), null)?.let(::JSONObject)).toString())
        if (!editor.commit()) throw CheckpointPersistenceFailed()
    }
    internal fun bindRunDiagnostic(userId: String, diagnostic: SyncTriggerDiagnostic) {
        if (!preferences.edit().putString(key(userId, "run_diagnostic"), diagnostic.request(1).toString()).commit()) throw CheckpointPersistenceFailed()
    }
    internal fun pendingStatus(userId: String): String? = preferences.getString(key(userId, "pending_status"), null)
    internal fun acknowledgeStatus(userId: String, expected: String) {
        if (pendingStatus(userId) == expected && !preferences.edit().remove(key(userId, "pending_status")).commit()) throw CheckpointPersistenceFailed()
    }
    fun setAutomaticSyncEnabled(userId: String, enabled: Boolean) {
        if (!preferences.edit().putBoolean(key(userId, "automatic_sync_disabled"), !enabled).commit()) throw CheckpointPersistenceFailed()
    }
    internal fun automaticSyncAllowed(userKey: String): Boolean =
        !preferences.getBoolean("${userKey}_automatic_sync_disabled", false)
    fun recordObserved(
        userId: String,
        workId: String,
        result: String,
        stage: String,
        attemptCount: Int,
        progressAt: Instant? = null,
    ) {
        val editor = preferences.edit()
            .putString(key(userId, BACKGROUND_WORK_ID), workId)
            .putString(key(userId, BACKGROUND_RESULT), result)
            .putString(key(userId, BACKGROUND_RESULT_AT), Instant.now().toString())
            .putString(key(userId, BACKGROUND_STAGE), stage)
            .putInt(key(userId, BACKGROUND_ATTEMPT_COUNT), attemptCount)
        progressAt?.let { editor.putString(key(userId, BACKGROUND_LAST_PROGRESS_AT), it.toString()) }
        editor.apply()
    }
    fun workMetadata(userId: String): BackgroundWorkMetadata = BackgroundWorkMetadata(
        result = preferences.getString(key(userId, BACKGROUND_RESULT), null),
        workId = preferences.getString(key(userId, BACKGROUND_WORK_ID), null),
        enqueuedAt = instant(userId, BACKGROUND_ENQUEUED_AT),
        startedAt = instant(userId, BACKGROUND_STARTED_AT),
        lastProgressAt = instant(userId, BACKGROUND_LAST_PROGRESS_AT),
        terminalAt = instant(userId, BACKGROUND_TERMINAL_AT),
        stage = preferences.getString(key(userId, BACKGROUND_STAGE), null),
        terminalStage = preferences.getString(key(userId, BACKGROUND_TERMINAL_STAGE), null),
        requestCount = preferences.getInt(key(userId, BACKGROUND_REQUEST_COUNT), 0),
        attemptCount = preferences.getInt(key(userId, BACKGROUND_ATTEMPT_COUNT), 0),
        readRecordCount = preferences.getInt(key(userId, BACKGROUND_READ_RECORD_COUNT), 0),
        readDomainCounts = preferences.getString(key(userId, BACKGROUND_READ_DOMAIN_COUNTS), null),
        readSourceApps = preferences.getString(key(userId, BACKGROUND_READ_SOURCE_APPS), null),
        lastHttpStatus = preferences.getInt(key(userId, BACKGROUND_HTTP_STATUS), 0).takeIf { it > 0 },
        lastHttpErrorCode = preferences.getString(key(userId, BACKGROUND_HTTP_ERROR_CODE), null),
        failureReason = preferences.getString(key(userId, BACKGROUND_FAILURE_REASON), null),
        exceptionClass = preferences.getString(key(userId, BACKGROUND_EXCEPTION_CLASS), null),
    )
    fun lastSuccessfulSync(userId: String): Instant? = contextPreferences.getString(key(userId, LAST_SUCCESS), null)
        ?.let { runCatching { Instant.parse(it) }.getOrNull() }
    fun saveLastSuccessfulSync(userId: String, value: Instant) {
        // Each mode owns its unfinished window/checkpoint, but all completed
        // windows share this coverage cursor. An older backfill finishing later
        // must not undo a newer, already durable incremental completion.
        val completedThrough = maxOf(lastSuccessfulSync(userId) ?: value, value)
        if (!contextPreferences.edit().putString(key(userId, LAST_SUCCESS), completedThrough.toString()).commit()) throw CheckpointPersistenceFailed()
    }
    fun backgroundSummary(userId: String): Pair<String?, Instant?> =
        preferences.getString(key(userId, BACKGROUND_RESULT), null) to
            preferences.getString(key(userId, BACKGROUND_RESULT_AT), null)?.let { runCatching { Instant.parse(it) }.getOrNull() }
    fun clear(userId: String) {
        val editor = preferences.edit()
            .remove(key(userId, HISTORY_PENDING))
            .remove(key(userId, BACKGROUND_RESULT))
            .remove(key(userId, BACKGROUND_RESULT_AT))
            .remove(key(userId, ACTIVE_WINDOW_END))
            .remove(key(userId, BACKGROUND_WORK_ID))
            .remove(key(userId, BACKGROUND_ENQUEUED_AT))
            .remove(key(userId, BACKGROUND_STARTED_AT))
            .remove(key(userId, BACKGROUND_LAST_PROGRESS_AT))
            .remove(key(userId, BACKGROUND_TERMINAL_AT))
            .remove(key(userId, BACKGROUND_TERMINAL_STAGE))
            .remove(key(userId, BACKGROUND_STAGE))
            .remove(key(userId, BACKGROUND_REQUEST_COUNT))
            .remove(key(userId, BACKGROUND_ATTEMPT_COUNT))
            .remove(key(userId, BACKGROUND_READ_RECORD_COUNT))
            .remove(key(userId, BACKGROUND_READ_DOMAIN_COUNTS))
            .remove(key(userId, BACKGROUND_READ_SOURCE_APPS))
            .remove(key(userId, BACKGROUND_HTTP_STATUS))
            .remove(key(userId, BACKGROUND_HTTP_ERROR_CODE))
            .remove(key(userId, BACKGROUND_FAILURE_REASON))
            .remove(key(userId, BACKGROUND_EXCEPTION_CLASS))
            .remove(key(userId, PERIODIC_SCHEDULER_HEALTH))
            .remove(key(userId, PERIODIC_REPAIR_AT))
        BackgroundSyncMode.entries.forEach { mode ->
            editor.remove(modeKey(userId, mode, ACTIVE_WINDOW_END))
        }
        editor.apply()
        contextPreferences.edit().remove(key(userId, LAST_SUCCESS)).apply()
    }
    fun activeWindowEnd(userId: String, mode: BackgroundSyncMode, proposed: Instant): Instant {
        migrateLegacyBackfillWindow(userId, mode)
        val scopedKey = modeKey(userId, mode, ACTIVE_WINDOW_END)
        preferences.getString(scopedKey, null)?.let { saved ->
            runCatching { Instant.parse(saved) }.getOrNull()?.let { return it }
        }
        if (!preferences.edit().putString(scopedKey, proposed.toString()).commit()) throw CheckpointPersistenceFailed()
        return proposed
    }
    fun activeWindowStart(userId: String, mode: BackgroundSyncMode, proposed: Instant): Instant {
        val name = modeKey(userId, mode, "active_window_start")
        preferences.getString(name, null)?.let { return Instant.parse(it) }
        if (!preferences.edit().putString(name, proposed.toString()).commit()) throw CheckpointPersistenceFailed()
        return proposed
    }
    fun clearActiveWindow(userId: String, mode: BackgroundSyncMode) {
        if (!preferences.edit().remove(modeKey(userId, mode, ACTIVE_WINDOW_END))
                .remove(modeKey(userId, mode, "active_window_start")).commit()) throw CheckpointPersistenceFailed()
    }
    fun recordSessionFailure(userKey: String, result: String, error: Throwable? = null) {
        require(userKey.matches(Regex("[a-f0-9]{16}")))
        val now = Instant.now().toString()
        val diagnostic = error?.let(SyncFailureDiagnostic::from)
        if (!preferences.edit().putString("${userKey}_background_result", result)
                .putString("${userKey}_background_result_at", now)
                .putString("${userKey}_background_terminal_at", now)
                .putString("${userKey}_background_terminal_stage", "SESSION")
                .putString("${userKey}_background_failure_reason", diagnostic?.reason)
                .putString("${userKey}_background_exception_class", diagnostic?.exceptionClass).commit()) throw CheckpointPersistenceFailed()
    }

    private fun migrateLegacyBackfillWindow(userId: String, mode: BackgroundSyncMode) {
        if (mode != BackgroundSyncMode.BACKFILL) return
        val legacyKey = key(userId, ACTIVE_WINDOW_END)
        val scopedKey = modeKey(userId, mode, ACTIVE_WINDOW_END)
        if (preferences.contains(scopedKey) || !preferences.contains(legacyKey)) return
        val saved = preferences.getString(legacyKey, null) ?: return
        preferences.edit().putString(scopedKey, saved).remove(legacyKey).commit()
    }

    /**
     * Claims beta.6's unscoped sync metadata only after an existing authenticated
     * session has been restored and its canonical user is known. Auth credentials
     * live in a separate encrypted store and are never read, changed, or cleared here.
     */
    fun migrateLegacyStateAfterSessionRestore(userId: String) {
        val prefix = CanonicalIdentity.sha256(userId).take(16)
        val runtimeEditor = preferences.edit()
        migrateString(preferences, runtimeEditor, BACKGROUND_RESULT, key(userId, BACKGROUND_RESULT))
        migrateString(preferences, runtimeEditor, BACKGROUND_RESULT_AT, key(userId, BACKGROUND_RESULT_AT))
        if (!preferences.contains(key(userId, HISTORY_PENDING)) && preferences.contains(HISTORY_PENDING)) {
            runtimeEditor.putBoolean(key(userId, HISTORY_PENDING), preferences.getBoolean(HISTORY_PENDING, false))
        }
        runtimeEditor
            .remove(HISTORY_PENDING)
            .remove(BACKGROUND_RESULT)
            .remove(BACKGROUND_RESULT_AT)
            .putBoolean("${prefix}_$LEGACY_MIGRATED", true)
            .apply()

        val syncEditor = contextPreferences.edit()
        migrateString(contextPreferences, syncEditor, LAST_SUCCESS, key(userId, LAST_SUCCESS))
        syncEditor.remove(LAST_SUCCESS).apply()
    }

    private fun migrateString(source: android.content.SharedPreferences, editor: android.content.SharedPreferences.Editor, legacyKey: String, scopedKey: String) {
        if (!source.contains(scopedKey)) source.getString(legacyKey, null)?.let { editor.putString(scopedKey, it) }
    }

    private fun key(userId: String, name: String) = "${CanonicalIdentity.sha256(userId).take(16)}_$name"
    private fun modeKey(userId: String, mode: BackgroundSyncMode, name: String) =
        SyncStateNamespace.modeKey(userId, mode, name)
    private fun instant(userId: String, name: String): Instant? = preferences.getString(key(userId, name), null)
        ?.let { runCatching { Instant.parse(it) }.getOrNull() }


    private companion object {
        const val HISTORY_PENDING = "history_pending"
        const val BACKGROUND_RESULT = "background_result"
        const val BACKGROUND_RESULT_AT = "background_result_at"
        const val LAST_SUCCESS = "last_success"
        const val LEGACY_MIGRATED = "legacy_state_migrated_v1"
        const val ACTIVE_WINDOW_END = "active_window_end"
        const val BACKGROUND_WORK_ID = "background_work_id"
        const val BACKGROUND_ENQUEUED_AT = "background_enqueued_at"
        const val BACKGROUND_STARTED_AT = "background_started_at"
        const val BACKGROUND_LAST_PROGRESS_AT = "background_last_progress_at"
        const val BACKGROUND_TERMINAL_AT = "background_terminal_at"
        const val BACKGROUND_TERMINAL_STAGE = "background_terminal_stage"
        const val BACKGROUND_STAGE = "background_stage"
        const val BACKGROUND_REQUEST_COUNT = "background_request_count"
        const val BACKGROUND_ATTEMPT_COUNT = "background_attempt_count"
        const val BACKGROUND_READ_RECORD_COUNT = "background_read_record_count"
        const val BACKGROUND_READ_DOMAIN_COUNTS = "background_read_domain_counts"
        const val BACKGROUND_READ_SOURCE_APPS = "background_read_source_apps"
        const val BACKGROUND_HTTP_STATUS = "background_http_status"
        const val BACKGROUND_HTTP_ERROR_CODE = "background_http_error_code"
        const val BACKGROUND_FAILURE_REASON = "background_failure_reason"
        const val BACKGROUND_EXCEPTION_CLASS = "background_exception_class"
        const val PERIODIC_SCHEDULER_HEALTH = "periodic_scheduler_health"
        const val PERIODIC_REPAIR_AT = "periodic_repair_at"
    }
}

data class BackgroundWorkMetadata(
    val result: String?, val workId: String?, val enqueuedAt: Instant?, val startedAt: Instant?,
    val lastProgressAt: Instant?, val terminalAt: Instant?, val stage: String?,
    val terminalStage: String?, val requestCount: Int, val attemptCount: Int,
    val readRecordCount: Int, val readDomainCounts: String?, val readSourceApps: String?,
    val lastHttpStatus: Int?, val lastHttpErrorCode: String?,
    val failureReason: String?, val exceptionClass: String?,
)

/** Only fixed type labels survive; never persist a throwable's message or payload. */
internal data class SyncFailureDiagnostic(val reason: String, val exceptionClass: String) {
    companion object {
        fun from(error: Throwable): SyncFailureDiagnostic = when (error) {
            is AuthenticationRequired -> SyncFailureDiagnostic("AUTH_REQUIRED", "AuthenticationRequired")
            is NativeAuthRejected -> SyncFailureDiagnostic("AUTH_REJECTED", "NativeAuthRejected")
            is TimeoutCancellationException -> SyncFailureDiagnostic("DEADLINE_EXCEEDED", "TimeoutCancellationException")
            is java.net.SocketTimeoutException -> SyncFailureDiagnostic("SOCKET_TIMEOUT", "SocketTimeoutException")
            is IncompleteIngestionReceipt -> SyncFailureDiagnostic("RECEIPT_INCOMPLETE", "IncompleteIngestionReceipt")
            is DomainCompletenessExhausted -> SyncFailureDiagnostic("DOMAIN_INCOMPLETE", "DomainCompletenessExhausted")
            is BackfillCatchUpRequired -> SyncFailureDiagnostic("RECONCILIATION_PENDING", "BackfillCatchUpRequired")
            is OversizedBatchRejected -> SyncFailureDiagnostic("BATCH_OVERSIZED", "OversizedBatchRejected")
            is OversizedHealthRecord -> SyncFailureDiagnostic("RECORD_OVERSIZED", "OversizedHealthRecord")
            is BatchUploadFailed -> SyncFailureDiagnostic("BATCH_HTTP_FAILURE", "BatchUploadFailed")
            is IOException -> SyncFailureDiagnostic("IO_FAILURE", "IOException")
            is CancellationException -> SyncFailureDiagnostic("WORK_CANCELLED", "CancellationException")
            is org.json.JSONException -> SyncFailureDiagnostic("JSON_FAILURE", "JSONException")
            is IllegalArgumentException -> SyncFailureDiagnostic("INVALID_ARGUMENT", "IllegalArgumentException")
            is IllegalStateException -> SyncFailureDiagnostic("INVALID_STATE", "IllegalStateException")
            else -> SyncFailureDiagnostic("OTHER_EXCEPTION", "OtherException")
        }
    }
}

object BackgroundSyncScheduler {
    private const val LEGACY_BACKFILL = "health-sync-history-backfill"
    private const val LEGACY_PERIODIC = "health-sync-periodic"

    suspend fun enqueue(
        context: Context,
        userId: String,
        replaceImmediate: Boolean = false,
        replacePeriodic: Boolean = false,
        trigger: SyncTriggerSource = SyncTriggerSource.APP_START,
    ): BackgroundRuntimeStatus {
        val manager = WorkManager.getInstance(context)
        manager.cancelUniqueWork(LEGACY_BACKFILL)
        manager.cancelUniqueWork(LEGACY_PERIODIC)
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        if (!replaceImmediate) {
            val current = selectCurrent(queryForegroundWork(manager, userId), SyncRuntimeStateStore(context).workMetadata(userId).workId)
            if (current != null && current.state in ACTIVE_STATES) {
                val status = statusOf(current)
                recordObserved(context, userId, current, status)
                reconcilePeriodic(context, manager, userId, constraints, replacePeriodic)
                return status
            }
        }
        val userKey = BackgroundWorkNames.userKey(userId)
        val immediate = OneTimeWorkRequestBuilder<BackgroundHealthSyncWorker>()
            .setConstraints(constraints)
            .setInputData(triggerInput(BackgroundSyncMode.INCREMENTAL, userKey, trigger))
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .build()
        val immediatePolicy = if (replaceImmediate) ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.KEEP
        withContext(Dispatchers.IO) {
            manager.beginUniqueWork(BackgroundWorkNames.immediate(userId), immediatePolicy, immediate).enqueue().await()
        }
        val actual = selectCurrent(queryWork(manager, BackgroundWorkNames.immediate(userId)), null)
            ?: throw IOException("SCHEDULE_UNCONFIRMED")
        SyncRuntimeStateStore(context).recordEnqueued(userId, actual.id.toString())
        reconcilePeriodic(context, manager, userId, constraints, replacePeriodic)
        return BackgroundRuntimeStatus.ENQUEUED
    }

    private fun ensurePeriodic(
        manager: WorkManager,
        userId: String,
        constraints: Constraints,
        policy: ExistingPeriodicWorkPolicy = ExistingPeriodicWorkPolicy.KEEP,
    ) {
        val userKey = BackgroundWorkNames.userKey(userId)
        val periodic = PeriodicWorkRequestBuilder<BackgroundHealthSyncWorker>(PeriodicSyncCadencePolicy.INTERVAL_HOURS, TimeUnit.HOURS)
            .setConstraints(constraints)
            .setInputData(triggerInput(BackgroundSyncMode.INCREMENTAL, userKey, SyncTriggerSource.PERIODIC_WORKER))
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        manager.enqueueUniquePeriodicWork(BackgroundWorkNames.periodic(userId), policy, periodic)
    }

    /** Keep WorkManager's unique name authoritative while repairing an orphaned OS job. */
    private suspend fun reconcilePeriodic(
        context: Context,
        manager: WorkManager,
        userId: String,
        constraints: Constraints,
        replace: Boolean = false,
    ): Boolean {
        // JobScheduler can lose a WorkManager job while its WorkSpec still says
        // ENQUEUED. An independent, inexact alarm wakes this reconciliation even
        // when the user never opens the app again.
        PeriodicSyncWatchdog.schedule(context)
        val store = SyncRuntimeStateStore(context)
        val existing = queryWork(manager, BackgroundWorkNames.periodic(userId))
        val work = existing.firstOrNull { it.state == WorkInfo.State.RUNNING }
            ?: existing.firstOrNull { it.state in ACTIVE_STATES }
        val state = work?.let(::durableState)
        val cadenceOutdated = work != null &&
            PeriodicSyncCadencePolicy.needsUpdate(work.periodicityInfo?.repeatIntervalMillis)
        val present = if (state == DurableWorkState.ENQUEUED && !replace) {
            systemJobPresent(context, work.id.toString())
        } else null
        val secondCheck = if (present == false) {
            delay(1_000)
            systemJobPresent(context, work!!.id.toString())
        } else present
        val confirmedMissing = present == false && secondCheck == false
        val now = System.currentTimeMillis()
        if (confirmedMissing) store.recordPeriodicSchedulerHealth(userId, "SCHEDULER_DEGRADED")
        val repair = replace || PeriodicSchedulerRecoveryPolicy.shouldReplace(
            state, if (confirmedMissing) false else secondCheck, store.lastPeriodicRepairAt(userId), now,
        )
        if (repair) {
            ensurePeriodic(manager, userId, constraints, ExistingPeriodicWorkPolicy.CANCEL_AND_REENQUEUE)
            store.recordPeriodicSchedulerHealth(userId, "RECONCILING", now)
        } else if (state == null) {
            ensurePeriodic(manager, userId, constraints)
            store.recordPeriodicSchedulerHealth(userId, "ENQUEUED")
        } else if (cadenceOutdated && !confirmedMissing) {
            // KEEP would retain the old 12-hour WorkSpec after an in-place APK update.
            // UPDATE keeps the unique periodic job and does not interrupt a running sync.
            ensurePeriodic(manager, userId, constraints, ExistingPeriodicWorkPolicy.UPDATE)
            store.recordPeriodicSchedulerHealth(userId, "RECONCILING")
        } else if (present == true) {
            store.recordPeriodicSchedulerHealth(userId, "HEALTHY")
        }
        return repair || state == null
    }

    private fun systemJobPresent(context: Context, workId: String): Boolean? = runCatching {
        val scheduler = context.getSystemService(JobScheduler::class.java) ?: return@runCatching null
        val jobs = if (Build.VERSION.SDK_INT >= 34) {
            scheduler.pendingJobsInAllNamespaces.values.flatten()
        } else scheduler.allPendingJobs
        jobs.any { it.extras.getString("EXTRA_WORK_SPEC_ID") == workId }
    }.getOrNull()

    suspend fun reconcilePeriodicAfterWorkerStart(context: Context, userId: String) {
        reconcilePeriodic(context, WorkManager.getInstance(context), userId,
            Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
    }

    suspend fun reconcilePeriodicFromWatchdog(context: Context, userId: String): Boolean =
        reconcilePeriodic(context, WorkManager.getInstance(context), userId,
            Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())

    /** Old beta.23 periodic WorkSpecs survive an in-place APK update under KEEP. */
    suspend fun resolveTrigger(context: Context, userId: String, workId: String, configured: SyncTriggerSource): SyncTriggerSource {
        if (configured != SyncTriggerSource.UNKNOWN) return configured
        val manager = try { WorkManager.getInstance(context) } catch (_: Exception) { return SyncTriggerSource.UNKNOWN }
        if (queryWork(manager, BackgroundWorkNames.periodic(userId)).any { it.id.toString() == workId }) {
            return SyncTriggerSource.PERIODIC_WORKER
        }
        if (queryWork(manager, BackgroundWorkNames.backfill(userId)).any { it.id.toString() == workId } ||
            queryWork(manager, BackgroundWorkNames.p0Recovery(userId)).any { it.id.toString() == workId }) {
            return SyncTriggerSource.BACKFILL
        }
        return SyncTriggerSource.UNKNOWN
    }

    suspend fun enqueueBackfill(context: Context, userId: String) {
        val manager = WorkManager.getInstance(context)
        val existing = queryWork(manager, BackgroundWorkNames.backfill(userId))
        if (existing.any { it.state in ACTIVE_STATES }) return
        val request = OneTimeWorkRequestBuilder<BackgroundHealthSyncWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setInputData(triggerInput(BackgroundSyncMode.BACKFILL, BackgroundWorkNames.userKey(userId), SyncTriggerSource.BACKFILL))
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        manager.enqueueUniqueWork(BackgroundWorkNames.backfill(userId), ExistingWorkPolicy.KEEP, request)
    }

    /** Persist the next slice before yielding. Existing failed leaves must not poison it. */
    suspend fun enqueueContinuation(context: Context, userId: String, mode: BackgroundSyncMode,
        parentId: String, origin: SyncTriggerSource, flowId: String) {
        val manager = WorkManager.getInstance(context)
        val name = when (mode) {
            BackgroundSyncMode.INCREMENTAL -> BackgroundWorkNames.immediate(userId)
            BackgroundSyncMode.BACKFILL -> BackgroundWorkNames.backfill(userId)
            BackgroundSyncMode.P0_RECOVERY -> BackgroundWorkNames.p0Recovery(userId)
        }
        if (queryWork(manager, name).any { it.id.toString() != parentId && it.state in ACTIVE_STATES }) return
        val request = OneTimeWorkRequestBuilder<BackgroundHealthSyncWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setInitialDelay(30, TimeUnit.SECONDS)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .setInputData(workDataOf(WORK_MODE to mode.name, WORK_USER_KEY to BackgroundWorkNames.userKey(userId),
                WORK_TRIGGER_SOURCE to origin.name, "parent_worker_id" to parentId, "parent_flow_id" to flowId))
            .build()
        withContext(Dispatchers.IO) {
            manager.enqueueUniqueWork(name, ExistingWorkPolicy.APPEND_OR_REPLACE, request).await()
        }
    }

    /** One bounded, idempotent Beta recovery for the cursor gap found on beta.20. */
    suspend fun enqueueP0Recovery(context: Context, userId: String) {
        val manager = WorkManager.getInstance(context)
        val name = BackgroundWorkNames.p0Recovery(userId)
        if (queryWork(manager, name).isNotEmpty()) return
        val request = OneTimeWorkRequestBuilder<BackgroundHealthSyncWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setInputData(workDataOf(
                WORK_MODE to BackgroundSyncMode.P0_RECOVERY.name,
                WORK_USER_KEY to BackgroundWorkNames.userKey(userId),
                WORK_FROZEN_END to Instant.now().toString(),
                WORK_TRIGGER_SOURCE to SyncTriggerSource.BACKFILL.name,
            ))
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        manager.enqueueUniqueWork(name, ExistingWorkPolicy.KEEP, request)
    }

    suspend fun reconcileAndEnqueue(context: Context, userId: String, trigger: SyncTriggerSource = SyncTriggerSource.APP_START): BackgroundRuntimeStatus {
        val manager = WorkManager.getInstance(context)
        val store = SyncRuntimeStateStore(context)
        val metadata = store.workMetadata(userId)
        val infos = queryForegroundWork(manager, userId)
        val selected = selectCurrent(infos, metadata.workId)
        val decision = BackgroundWorkRecoveryPolicy.decide(
            metadata.result,
            latest(selected?.progressInstant(), metadata.lastProgressAt),
            selected?.let { WorkRuntimeSnapshot(durableState(it), it.runAttemptCount, hasRunnablePredecessor(it, infos)) },
            Instant.now(),
        )
        return when (decision.action) {
            WorkRecoveryAction.KEEP -> {
                selected?.let { recordObserved(context, userId, it, decision.status) }
                reconcilePeriodic(context, manager, userId, Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                decision.status
            }
            WorkRecoveryAction.ENQUEUE -> {
                if (decision.status == BackgroundRuntimeStatus.UP_TO_DATE) store.recordTerminal(userId, "UP_TO_DATE")
                enqueue(context, userId, trigger = trigger)
            }
            WorkRecoveryAction.REPLACE_STALE -> {
                store.recordTerminal(userId, "STALE_RECOVERED")
                manager.cancelUniqueWork(BackgroundWorkNames.backfill(userId))
                enqueue(context, userId, replaceImmediate = true, replacePeriodic = true, trigger = trigger)
            }
        }
    }

    fun observe(context: Context, userId: String): Flow<BackgroundRuntimeStatus> {
        val manager = WorkManager.getInstance(context)
        val state = SyncRuntimeStateStore(context)
        return combine(
            manager.getWorkInfosForUniqueWorkFlow(BackgroundWorkNames.immediate(userId)),
            manager.getWorkInfosForUniqueWorkFlow(BackgroundWorkNames.backfill(userId)),
            manager.getWorkInfosForUniqueWorkFlow(BackgroundWorkNames.periodic(userId)),
            manager.getWorkInfosForUniqueWorkFlow(BackgroundWorkNames.p0Recovery(userId)),
        ) { immediate, backfill, periodic, recovery ->
            ObserverWorkSet(
                active = immediate.filter { it.state in ACTIVE_STATES } +
                    backfill.filter { it.state in ACTIVE_STATES } +
                    periodic.filter { it.state == WorkInfo.State.RUNNING } +
                    recovery.filter { it.state in ACTIVE_STATES },
                all = immediate + backfill + periodic + recovery,
            )
        }
            .map { workSet ->
                val metadata = state.workMetadata(userId)
                val selected = selectCurrent(workSet.active, metadata.workId)
                selected?.let {
                    val status = statusOf(it)
                    recordObserved(context, userId, it, status)
                    status
                } ?: run {
                    val preferredTerminal = workSet.all.firstOrNull {
                        it.id.toString() == metadata.workId && it.state !in ACTIVE_STATES
                    }
                    val status = BackgroundWorkRecoveryPolicy.statusWithoutActiveWork(
                        metadata.result,
                        preferredTerminal?.let(::durableState),
                    )
                    if (preferredTerminal != null && status == BackgroundRuntimeStatus.RETRY_PENDING) {
                        recordObserved(context, userId, preferredTerminal, status)
                    }
                    status
                }
            }
            .distinctUntilChanged()
    }

    private suspend fun queryForegroundWork(manager: WorkManager, userId: String): List<WorkInfo> =
        queryWork(manager, BackgroundWorkNames.immediate(userId)).filter { it.state in ACTIVE_STATES } +
            queryWork(manager, BackgroundWorkNames.backfill(userId)).filter { it.state in ACTIVE_STATES } +
            queryWork(manager, BackgroundWorkNames.periodic(userId)).filter { it.state == WorkInfo.State.RUNNING } +
            queryWork(manager, BackgroundWorkNames.p0Recovery(userId)).filter { it.state in ACTIVE_STATES }

    private suspend fun queryWork(manager: WorkManager, name: String): List<WorkInfo> =
        withTimeout(WORK_QUERY_TIMEOUT_MS) { manager.getWorkInfosForUniqueWorkFlow(name).first() }

    private fun selectCurrent(infos: List<WorkInfo>, preferredId: String?): WorkInfo? {
        val preferred = infos.firstOrNull { it.id.toString() == preferredId }
        if (preferred?.state == WorkInfo.State.RUNNING) return preferred
        return infos.firstOrNull { it.state == WorkInfo.State.RUNNING }
            ?: preferred?.takeIf { it.state in ACTIVE_STATES }
            ?: infos.firstOrNull { it.state == WorkInfo.State.ENQUEUED }
            ?: infos.firstOrNull { it.state == WorkInfo.State.BLOCKED }
            ?: infos.firstOrNull { it.id.toString() == preferredId }
            ?: infos.lastOrNull()
    }

    private fun hasRunnablePredecessor(selected: WorkInfo, infos: List<WorkInfo>): Boolean =
        selected.state != WorkInfo.State.BLOCKED || infos.any { it.id != selected.id && it.state in setOf(WorkInfo.State.RUNNING, WorkInfo.State.ENQUEUED) }

    private fun statusOf(info: WorkInfo): BackgroundRuntimeStatus = when (info.state) {
        WorkInfo.State.RUNNING -> BackgroundRuntimeStatus.RUNNING
        WorkInfo.State.ENQUEUED -> if (info.runAttemptCount > 0) BackgroundRuntimeStatus.RETRY_PENDING else BackgroundRuntimeStatus.ENQUEUED
        WorkInfo.State.BLOCKED -> BackgroundRuntimeStatus.WAITING_FOR_CONSTRAINT
        WorkInfo.State.SUCCEEDED -> BackgroundRuntimeStatus.UP_TO_DATE
        WorkInfo.State.FAILED, WorkInfo.State.CANCELLED -> BackgroundRuntimeStatus.RETRY_PENDING
    }

    private fun recordObserved(context: Context, userId: String, info: WorkInfo, status: BackgroundRuntimeStatus) {
        SyncRuntimeStateStore(context).recordObserved(
            userId,
            info.id.toString(),
            when (status) {
                BackgroundRuntimeStatus.RUNNING -> "SYNCING"
                else -> status.name
            },
            info.progress.getString(PROGRESS_STAGE) ?: status.name,
            info.runAttemptCount,
            info.progressInstant(),
        )
    }

    private fun WorkInfo.progressInstant(): Instant? = progress.getLong(PROGRESS_AT_EPOCH_MS, 0L)
        .takeIf { it > 0L }?.let(Instant::ofEpochMilli)

    private fun latest(first: Instant?, second: Instant?): Instant? = when {
        first == null -> second
        second == null -> first
        first.isAfter(second) -> first
        else -> second
    }

    private fun durableState(info: WorkInfo): DurableWorkState = when (info.state) {
        WorkInfo.State.ENQUEUED -> DurableWorkState.ENQUEUED
        WorkInfo.State.RUNNING -> DurableWorkState.RUNNING
        WorkInfo.State.BLOCKED -> DurableWorkState.BLOCKED
        WorkInfo.State.SUCCEEDED -> DurableWorkState.SUCCEEDED
        WorkInfo.State.FAILED -> DurableWorkState.FAILED
        WorkInfo.State.CANCELLED -> DurableWorkState.CANCELLED
    }

    private data class ObserverWorkSet(val active: List<WorkInfo>, val all: List<WorkInfo>)

    fun cancel(context: Context, userId: String?) {
        val manager = WorkManager.getInstance(context)
        userId?.let {
            manager.cancelUniqueWork(BackgroundWorkNames.immediate(it))
            manager.cancelUniqueWork(BackgroundWorkNames.backfill(it))
            manager.cancelUniqueWork(BackgroundWorkNames.periodic(it))
            manager.cancelUniqueWork(BackgroundWorkNames.p0Recovery(it))
        }
        manager.cancelUniqueWork(LEGACY_BACKFILL)
        manager.cancelUniqueWork(LEGACY_PERIODIC)
    }

    const val WORK_MODE = "sync_mode"
    const val WORK_USER_KEY = "canonical_user_key"
    const val WORK_FROZEN_END = "recovery_frozen_end"
    const val WORK_TRIGGER_SOURCE = "sync_trigger_source"
    internal fun triggerInput(mode: BackgroundSyncMode, userKey: String, trigger: SyncTriggerSource) =
        workDataOf(WORK_MODE to mode.name, WORK_USER_KEY to userKey, WORK_TRIGGER_SOURCE to trigger.name)
    const val PROGRESS_STAGE = "sync_stage"
    const val PROGRESS_AT_EPOCH_MS = "sync_progress_at"
    const val PROGRESS_REQUEST_COUNT = "sync_request_count"
    private const val WORK_QUERY_TIMEOUT_MS = 5_000L
    private val ACTIVE_STATES = setOf(WorkInfo.State.ENQUEUED, WorkInfo.State.RUNNING, WorkInfo.State.BLOCKED)
}

class BackgroundHealthSyncWorker(appContext: Context, params: WorkerParameters) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val workerStartedAt = Instant.now().toString()
        val state = SyncRuntimeStateStore(applicationContext)
        val health = HealthConnectGateway(applicationContext)
        val mode = runCatching {
            BackgroundSyncMode.valueOf(inputData.getString(BackgroundSyncScheduler.WORK_MODE).orEmpty())
        }.getOrDefault(BackgroundSyncMode.INCREMENTAL)
        var uploadStarted = false
        var ingestionClient: IngestionClient? = null
        val auth = NativeGoogleAuth(
            applicationContext,
            BuildConfig.SUPABASE_URL,
            BuildConfig.SUPABASE_PUBLISHABLE_KEY,
            BuildConfig.GOOGLE_WEB_CLIENT_ID,
            BuildConfig.API_BASE_URL,
        )
        val expectedUserKey = inputData.getString(BackgroundSyncScheduler.WORK_USER_KEY) ?: return Result.failure()
        if (!state.automaticSyncAllowed(expectedUserKey)) return Result.failure()
        setProgress(workDataOf(
            BackgroundSyncScheduler.PROGRESS_STAGE to "SESSION",
            BackgroundSyncScheduler.PROGRESS_AT_EPOCH_MS to System.currentTimeMillis(),
            BackgroundSyncScheduler.PROGRESS_REQUEST_COUNT to 0,
        ))
        var session = try {
            withTimeout(SESSION_TIMEOUT_MS) { auth.restore() }
        } catch (_: TimeoutCancellationException) {
            val maxAttempts = BackgroundContinuationPolicy.maxAttempts(
                mode,
                uploadStarted = mode != BackgroundSyncMode.INCREMENTAL,
                checkpointIndex = 0,
            )
            state.recordSessionFailure(expectedUserKey, "RETRY_PENDING")
            return retryOrFailWithoutSession(maxAttempts)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: NativeAuthRejected) {
            state.recordSessionFailure(expectedUserKey, "AUTH_REQUIRED", error)
            return Result.failure()
        } catch (error: Exception) {
            val retry = BackgroundContinuationPolicy.shouldRetry(runAttemptCount, MAX_RETRY_ATTEMPTS)
            state.recordSessionFailure(expectedUserKey, if (retry) "RETRY_PENDING" else "FAILED", error)
            return retryOrFailWithoutSession()
        } ?: run {
            state.recordSessionFailure(expectedUserKey, "AUTH_REQUIRED")
            return Result.failure()
        }
        if (BackgroundWorkNames.userKey(session.canonicalUserId) != expectedUserKey) {
            return Result.failure()
        }
        val owner = session.canonicalUserId
        val origin = BackgroundSyncScheduler.resolveTrigger(applicationContext, owner,
            id.toString(), SyncTriggerSource.fromWorkInput(inputData.getString(BackgroundSyncScheduler.WORK_TRIGGER_SOURCE)))
        val diagnostic = SyncTriggerDiagnostic(origin, workerId = id.toString(),
            startedAt = workerStartedAt, workerAttempt = runAttemptCount)
        // An immediate worker can revive an orphaned periodic schedule without
        // coupling either request to the other's terminal state.
        if (mode == BackgroundSyncMode.INCREMENTAL) {
            BackgroundSyncScheduler.reconcilePeriodicAfterWorkerStart(applicationContext, owner)
        }
        var checkpoints = SyncCheckpointStore(applicationContext, owner, mode)
        if (!AppSyncSingleFlight.gate.tryStart()) {
            // Another WorkManager request owns the sync. Do not claim RUNNING or
            // overwrite its durable status; WorkManager will retry this contender.
            return retryOrFail(BackgroundContinuationPolicy.BACKFILL_MAX_CONTINUATION_ATTEMPTS)
        }
        return try {
            flushPendingStatus(state, owner, session)
            state.recordStarted(owner, id.toString(), runAttemptCount)
            state.bindRunDiagnostic(owner, diagnostic)
            reportProgress(state, owner, "PERMISSION")
            val permissionReady = try {
                withTimeout(PERMISSION_TIMEOUT_MS) {
                    health.availability == androidx.health.connect.client.HealthConnectClient.SDK_AVAILABLE &&
                        health.hasAnyPermission() && health.backgroundReadState() == BackgroundHealthReadState.GRANTED
                }
            } catch (error: TimeoutCancellationException) {
                val checkpoint = checkpoints.load()
                val maxAttempts = BackgroundContinuationPolicy.maxAttempts(
                    mode,
                    uploadStarted = false,
                    checkpoint?.nextBatchIndex ?: 0,
                    checkpoint?.reconciliationPass ?: 0,
                )
                state.recordTerminal(owner, "RETRY_PENDING", error)
                return retryOrFail(maxAttempts)
            }
            if (!permissionReady) {
                state.recordTerminal(owner, "PERMISSION_REQUIRED")
                return Result.failure()
            }
            withTimeout(BACKGROUND_DEADLINE_MS) {
                val proposedEnd = if (mode == BackgroundSyncMode.P0_RECOVERY) {
                    inputData.getString(BackgroundSyncScheduler.WORK_FROZEN_END)
                        ?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: Instant.now()
                } else Instant.now()
                val end = state.activeWindowEnd(owner, mode, proposedEnd)
                val lastSuccess = state.lastSuccessfulSync(owner)
                val proposedWindow = when (mode) {
                    BackgroundSyncMode.BACKFILL -> SyncWindowPolicy.backfill(end)
                    BackgroundSyncMode.P0_RECOVERY -> SyncWindowPolicy.p0Recovery(end)
                    BackgroundSyncMode.INCREMENTAL ->
                        SyncWindowPolicy.incremental(end, lastSuccess)
                }
                val window = proposedWindow.copy(start = state.activeWindowStart(owner, mode, proposedWindow.start))
                val pages = PendingSyncPageStore(java.io.File(applicationContext.noBackupFilesDir, "pending-sync"),
                    BuildConfig.API_BASE_URL, owner, mode)
                var pending = pages.load(window) ?: PendingSyncPage(window)
                reportProgress(state, owner, "HEALTH_READ")
                val completeness = SyncCompletenessStore(applicationContext, owner)
                if (pending.read == null && !pending.complete) {
                    val read = withTimeout(HEALTH_READ_TIMEOUT_MS) {
                        health.readBounded(window.start, window.end,
                            pending.remaining ?: HealthReadDomainPolicy.forMode(mode),
                            startForDomain = { domain -> pending.starts[domain]?.let(Instant::parse)
                                ?: if (mode == BackgroundSyncMode.INCREMENTAL && lastSuccess != null) LateArrivalReplayPolicy.readStart(window, domain) else window.start },
                            resumeTokens = pending.cursors,
                            maxPagesPerDomain = if (pending.page == 0 && checkpoints.load() != null) HealthConnectGateway.MAX_PAGES_PER_DOMAIN else 2)
                    }
                    if (read.domainTraces.isEmpty()) throw SecurityException("PERMISSION_REQUIRED")
                    pending = pending.copy(read = read, starts = pending.starts + read.domainRangeStarts)
                    pages.save(pending) // durable pending data BEFORE any source cursor can advance
                }
                val read = pending.read ?: pending.summary()
                completeness.begin(id.toString(), window, read.domainTraces.keys + pending.totals.keys)
                checkpoints = SyncCheckpointStore(applicationContext, owner, mode, pending.segment)
                state.recordReadSummary(owner, read.records)
                // Source lastModifiedTime is not evidence that SQL received a record.
                // Replay this bounded read by stable identity and require commit receipts.
                val recordsToUpload = read.records
                completeness.save(id.toString(), window, read)
                val client = IngestionClient(BuildConfig.API_BASE_URL, onHttpResult = { result ->
                    state.recordHttpResult(owner, result)
                }).also { ingestionClient = it }
                reportProgress(state, owner, "UPLOAD", 0)
                uploadStarted = true
                val budget = UploadWorkBudget()
                val uploadSummary = if (pending.complete) UploadSummary(0, 0, 0, persistedDomainCounts = pending.totals.mapValues { it.value.mappedCount }) else try {
                    withTimeout(UPLOAD_TIMEOUT_MS) {
                        withContext(Dispatchers.IO) {
                            client.upload(session, recordsToUpload, checkpoints, diagnostic, budget) { done, _ ->
                                state.recordProgress(owner, "UPLOAD", done)
                                completeness.save(id.toString(), window, read, client.confirmedDomainCounts)
                            }
                        }
                    }
                } catch (_: AuthenticationRequired) {
                    reportProgress(state, owner, "SESSION_REFRESH")
                    val refreshed = withTimeout(SESSION_TIMEOUT_MS) { auth.refresh() }
                    NativeSessionRecovery.requireSameOwner(owner, refreshed.canonicalUserId)
                    session = refreshed
                    reportProgress(state, owner, "UPLOAD")
                    withTimeout(UPLOAD_TIMEOUT_MS) {
                        withContext(Dispatchers.IO) { client.upload(session, recordsToUpload, checkpoints, diagnostic, budget) }
                    }
                }
                reportProgress(state, owner, "CHECKPOINT")
                completeness.save(id.toString(), window, read, uploadSummary.persistedDomainCounts)
                if (uploadSummary.continuationPending) {
                    BackgroundSyncScheduler.enqueueContinuation(applicationContext, owner, mode, id.toString(), origin, diagnostic.flowId)
                    state.recordTerminal(owner, "PARTIAL")
                    return@withTimeout
                }
                if (uploadSummary.reconciliationPending) throw BackfillCatchUpRequired()
                if (!pending.complete) {
                    pending = pending.verified(uploadSummary.persistedDomainCounts)
                    pages.save(pending) // receipt-verified read-page cursor is now durable
                }
                if (!pending.complete) {
                    if (read.failedDomains.isNotEmpty()) throw DomainCompletenessExhausted()
                    BackgroundSyncScheduler.enqueueContinuation(applicationContext, owner, mode, id.toString(), origin, diagnostic.flowId)
                    state.recordTerminal(owner, "PARTIAL")
                    return@withTimeout
                }
                val completeRead = pending.summary()
                completeness.save(id.toString(), window, completeRead, pending.totals.mapValues { it.value.mappedCount })
                val result = if (pending.totals.values.all { it.sourceCount == 0 }) "NO_DATA" else "SYNCED"
                reportProgress(state, owner, "REPORT_STATUS")
                withContext(Dispatchers.IO) {
                    client.reportStatus(session, read.records, result, if (health.hasAllPermissions()) "GRANTED" else "PARTIAL", diagnostic,
                        pending.totals.keys)
                }
                if (mode == BackgroundSyncMode.BACKFILL) state.markHistoryComplete(owner)
                state.recordTerminal(owner, "SUCCESS")
                if (mode != BackgroundSyncMode.P0_RECOVERY) {
                    state.saveLastSuccessfulSync(owner, SyncWindowPolicy.completedCursor(window))
                }
                checkpoints.clear()
                SyncCheckpointStore(applicationContext, owner, mode).clear()
                pages.clear()
                state.clearActiveWindow(owner, mode)
                if (mode == BackgroundSyncMode.INCREMENTAL && state.isHistoryPending(owner)) {
                    BackgroundSyncScheduler.enqueueBackfill(applicationContext, owner)
                }
            }
            Result.success()
        } catch (error: AuthenticationRequired) {
            state.recordTerminal(owner, "AUTH_REQUIRED", error)
            Result.failure()
        } catch (error: NativeAuthRejected) {
            state.recordTerminal(owner, "AUTH_REQUIRED", error)
            Result.failure()
        } catch (error: TimeoutCancellationException) {
            val checkpoint = checkpoints.load()
            val maxAttempts = BackgroundContinuationPolicy.maxAttempts(
                mode,
                uploadStarted,
                checkpoint?.nextBatchIndex ?: 0,
                checkpoint?.reconciliationPass ?: 0,
            )
            val retry = BackgroundContinuationPolicy.shouldRetry(runAttemptCount, maxAttempts)
            state.recordTerminal(owner, if (retry) "RETRY_PENDING" else "TIMEOUT", error)
            retryOrFail(maxAttempts)
        } catch (error: IOException) {
            val checkpoint = checkpoints.load()
            val maxAttempts = BackgroundContinuationPolicy.maxAttempts(
                mode,
                uploadStarted,
                checkpoint?.nextBatchIndex ?: 0,
                checkpoint?.reconciliationPass ?: 0,
            )
            val retry = RetryPolicy.shouldRetryWorker(error, runAttemptCount, maxAttempts)
            state.recordTerminal(owner, if (retry) "RETRY_PENDING" else "FAILED", error)
            if (retry) Result.retry() else Result.failure()
        } catch (cancelled: CancellationException) {
            state.recordTerminal(owner, "RETRY_PENDING", cancelled)
            throw cancelled
        } catch (error: Exception) {
            val checkpoint = checkpoints.load()
            val maxAttempts = BackgroundContinuationPolicy.maxAttempts(
                mode,
                uploadStarted,
                checkpoint?.nextBatchIndex ?: 0,
                checkpoint?.reconciliationPass ?: 0,
            )
            val retry = BackgroundContinuationPolicy.shouldRetry(runAttemptCount, maxAttempts)
            state.recordTerminal(owner, if (retry) "RETRY_PENDING" else "FAILED", error)
            retryOrFail(maxAttempts)
        } finally {
            try {
                SyncCompletenessStore(applicationContext, owner).finishPending(id.toString())
                if (kotlinx.coroutines.currentCoroutineContext().isActive) flushPendingStatus(state, owner, session)
            } finally {
                try { ingestionClient?.close() } finally { AppSyncSingleFlight.gate.finish() }
            }
        }
    }

    private suspend fun flushPendingStatus(state: SyncRuntimeStateStore, owner: String, session: NativeAuthSession) {
        if (owner != session.canonicalUserId) return
        val raw = state.pendingStatus(owner) ?: return
        try {
            withTimeout(10_000L) {
                val event = JSONObject(raw)
                val d = event.optJSONObject("diagnostic")
                val diagnostic = d?.let { SyncTriggerDiagnostic(
                    SyncTriggerSource.fromWorkInput(it.optString("origin_trigger_source")), it.getString("flow_id"),
                    it.optString("worker_id").takeUnless { value -> value == "null" || value.isBlank() },
                    it.getString("started_at"), it.optInt("worker_attempt")) }
                val domains = state.workMetadata(owner).readDomainCounts.orEmpty().split(',')
                    .map { it.substringBefore(':') }.filter { it in SyncCompletenessPolicy.SUPPORTED_DOMAINS }.toSet()
                IngestionClient(BuildConfig.API_BASE_URL).use { client ->
                    client.reportStatus(session, emptyList(), event.getString("result"), "UNKNOWN", diagnostic, domains, event.getString("at"))
                }
                state.acknowledgeStatus(owner, raw)
            }
        } catch (_: TimeoutCancellationException) {
            // The durable event remains pending; never replace it with a fabricated success.
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            // No secret/exception message is logged. The next authenticated worker retries once.
        }
    }

    private suspend fun reportProgress(state: SyncRuntimeStateStore, userId: String, stage: String, requestCount: Int = 0) {
        val now = System.currentTimeMillis()
        state.recordProgress(userId, stage, requestCount)
        setProgress(workDataOf(
            BackgroundSyncScheduler.PROGRESS_STAGE to stage,
            BackgroundSyncScheduler.PROGRESS_AT_EPOCH_MS to now,
            BackgroundSyncScheduler.PROGRESS_REQUEST_COUNT to requestCount,
        ))
    }

    private fun retryOrFail(maxAttempts: Int = MAX_RETRY_ATTEMPTS): Result =
        if (BackgroundContinuationPolicy.shouldRetry(runAttemptCount, maxAttempts)) Result.retry() else Result.failure()
    private fun retryOrFailWithoutSession(maxAttempts: Int = MAX_RETRY_ATTEMPTS): Result = retryOrFail(maxAttempts)

    companion object {
        const val MAX_RETRY_ATTEMPTS = BackgroundContinuationPolicy.DEFAULT_MAX_ATTEMPTS
        const val BACKGROUND_DEADLINE_MS = 8 * 60_000L
        const val HEALTH_READ_TIMEOUT_MS = 3 * 60_000L
        const val UPLOAD_TIMEOUT_MS = 4 * 60_000L
        const val SESSION_TIMEOUT_MS = 30_000L
        const val PERMISSION_TIMEOUT_MS = 30_000L
    }
}
