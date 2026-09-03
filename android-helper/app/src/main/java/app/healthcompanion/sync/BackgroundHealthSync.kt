package app.healthcompanion.sync

import android.content.Context
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
import androidx.work.WorkInfo
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import java.time.Instant
import java.util.concurrent.TimeUnit

class SyncRuntimeStateStore(context: Context) {
    private val preferences = context.getSharedPreferences("sync_runtime_state", Context.MODE_PRIVATE)

    fun markHistoryPending(userId: String) = preferences.edit().putBoolean(key(userId, HISTORY_PENDING), true).apply()
    fun markHistoryComplete(userId: String) = preferences.edit().putBoolean(key(userId, HISTORY_PENDING), false).apply()
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
        .remove(key(userId, BACKGROUND_TERMINAL_AT))
        .apply()
    fun recordStarted(userId: String, workId: String) = preferences.edit()
        .putString(key(userId, BACKGROUND_WORK_ID), workId)
        .putString(key(userId, BACKGROUND_STARTED_AT), Instant.now().toString())
        .putString(key(userId, BACKGROUND_LAST_PROGRESS_AT), Instant.now().toString())
        .putString(key(userId, BACKGROUND_STAGE), "STARTING")
        .putInt(key(userId, BACKGROUND_REQUEST_COUNT), 0)
        .putString(key(userId, BACKGROUND_RESULT), "SYNCING")
        .putString(key(userId, BACKGROUND_RESULT_AT), Instant.now().toString())
        .apply()
    fun recordProgress(userId: String, stage: String, requestCount: Int? = null) {
        val editor = preferences.edit()
            .putString(key(userId, BACKGROUND_LAST_PROGRESS_AT), Instant.now().toString())
            .putString(key(userId, BACKGROUND_STAGE), stage)
        requestCount?.let { editor.putInt(key(userId, BACKGROUND_REQUEST_COUNT), it) }
        editor.apply()
    }
    fun recordTerminal(userId: String, result: String) = preferences.edit()
        .putString(key(userId, BACKGROUND_RESULT), result)
        .putString(key(userId, BACKGROUND_RESULT_AT), Instant.now().toString())
        .putString(key(userId, BACKGROUND_TERMINAL_AT), Instant.now().toString())
        .putString(key(userId, BACKGROUND_STAGE), "TERMINAL")
        .apply()
    fun workMetadata(userId: String): BackgroundWorkMetadata = BackgroundWorkMetadata(
        result = preferences.getString(key(userId, BACKGROUND_RESULT), null),
        workId = preferences.getString(key(userId, BACKGROUND_WORK_ID), null),
        enqueuedAt = instant(userId, BACKGROUND_ENQUEUED_AT),
        startedAt = instant(userId, BACKGROUND_STARTED_AT),
        lastProgressAt = instant(userId, BACKGROUND_LAST_PROGRESS_AT),
        terminalAt = instant(userId, BACKGROUND_TERMINAL_AT),
        stage = preferences.getString(key(userId, BACKGROUND_STAGE), null),
        requestCount = preferences.getInt(key(userId, BACKGROUND_REQUEST_COUNT), 0),
    )
    fun lastSuccessfulSync(userId: String): Instant? = contextPreferences.getString(key(userId, LAST_SUCCESS), null)
        ?.let { runCatching { Instant.parse(it) }.getOrNull() }
    fun saveLastSuccessfulSync(userId: String, value: Instant = Instant.now()) {
        contextPreferences.edit().putString(key(userId, LAST_SUCCESS), value.toString()).apply()
    }
    fun backgroundSummary(userId: String): Pair<String?, Instant?> =
        preferences.getString(key(userId, BACKGROUND_RESULT), null) to
            preferences.getString(key(userId, BACKGROUND_RESULT_AT), null)?.let { runCatching { Instant.parse(it) }.getOrNull() }
    fun clear(userId: String) {
        preferences.edit()
            .remove(key(userId, HISTORY_PENDING))
            .remove(key(userId, BACKGROUND_RESULT))
            .remove(key(userId, BACKGROUND_RESULT_AT))
            .remove(key(userId, ACTIVE_WINDOW_END))
            .remove(key(userId, BACKGROUND_WORK_ID))
            .remove(key(userId, BACKGROUND_ENQUEUED_AT))
            .remove(key(userId, BACKGROUND_STARTED_AT))
            .remove(key(userId, BACKGROUND_LAST_PROGRESS_AT))
            .remove(key(userId, BACKGROUND_TERMINAL_AT))
            .remove(key(userId, BACKGROUND_STAGE))
            .remove(key(userId, BACKGROUND_REQUEST_COUNT))
            .apply()
        contextPreferences.edit().remove(key(userId, LAST_SUCCESS)).apply()
    }
    fun activeWindowEnd(userId: String, proposed: Instant): Instant {
        val scopedKey = key(userId, ACTIVE_WINDOW_END)
        preferences.getString(scopedKey, null)?.let { saved ->
            runCatching { Instant.parse(saved) }.getOrNull()?.let { return it }
        }
        preferences.edit().putString(scopedKey, proposed.toString()).apply()
        return proposed
    }
    fun clearActiveWindow(userId: String) = preferences.edit().remove(key(userId, ACTIVE_WINDOW_END)).apply()

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
    private fun instant(userId: String, name: String): Instant? = preferences.getString(key(userId, name), null)
        ?.let { runCatching { Instant.parse(it) }.getOrNull() }

    private val contextPreferences = context.getSharedPreferences("sync_status", Context.MODE_PRIVATE)

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
        const val BACKGROUND_STAGE = "background_stage"
        const val BACKGROUND_REQUEST_COUNT = "background_request_count"
    }
}

data class BackgroundWorkMetadata(
    val result: String?, val workId: String?, val enqueuedAt: Instant?, val startedAt: Instant?,
    val lastProgressAt: Instant?, val terminalAt: Instant?, val stage: String?, val requestCount: Int,
)

object BackgroundSyncScheduler {
    private const val LEGACY_BACKFILL = "health-sync-history-backfill"
    private const val LEGACY_PERIODIC = "health-sync-periodic"

    fun enqueue(context: Context, userId: String, replaceImmediate: Boolean = false) {
        val manager = WorkManager.getInstance(context)
        manager.cancelUniqueWork(LEGACY_BACKFILL)
        manager.cancelUniqueWork(LEGACY_PERIODIC)
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val userKey = BackgroundWorkNames.userKey(userId)
        val immediate = OneTimeWorkRequestBuilder<BackgroundHealthSyncWorker>()
            .setConstraints(constraints)
            .setInputData(workDataOf(WORK_MODE to BackgroundSyncMode.INCREMENTAL.name, WORK_USER_KEY to userKey))
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .build()
        SyncRuntimeStateStore(context).recordEnqueued(userId, immediate.id.toString())
        val immediatePolicy = if (replaceImmediate) ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.KEEP
        var continuation = manager.beginUniqueWork(BackgroundWorkNames.immediate(userId), immediatePolicy, immediate)
        if (SyncRuntimeStateStore(context).isHistoryPending(userId)) {
            val backfill = OneTimeWorkRequestBuilder<BackgroundHealthSyncWorker>()
                .setConstraints(constraints)
                .setInputData(workDataOf(WORK_MODE to BackgroundSyncMode.BACKFILL.name, WORK_USER_KEY to userKey))
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            continuation = continuation.then(backfill)
        }
        continuation.enqueue()

        val periodic = PeriodicWorkRequestBuilder<BackgroundHealthSyncWorker>(12, TimeUnit.HOURS)
            .setConstraints(constraints)
            .setInputData(workDataOf(WORK_MODE to BackgroundSyncMode.INCREMENTAL.name, WORK_USER_KEY to userKey))
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        manager.enqueueUniquePeriodicWork(BackgroundWorkNames.periodic(userId), ExistingPeriodicWorkPolicy.KEEP, periodic)
    }

    suspend fun reconcileAndEnqueue(context: Context, userId: String) {
        val manager = WorkManager.getInstance(context)
        val states = runCatching {
            withTimeout(5_000L) {
                manager.getWorkInfosForUniqueWorkFlow(BackgroundWorkNames.immediate(userId)).first()
            }
        }.getOrDefault(emptyList()).map(::durableState).toSet()
        val store = SyncRuntimeStateStore(context)
        val metadata = store.workMetadata(userId)
        when (BackgroundWorkRecoveryPolicy.decide(metadata.result, metadata.lastProgressAt, states, Instant.now())) {
            WorkRecoveryAction.KEEP -> Unit
            WorkRecoveryAction.ENQUEUE -> enqueue(context, userId)
            WorkRecoveryAction.REPLACE_STALE -> {
                store.recordTerminal(userId, "STALE_RECOVERED")
                enqueue(context, userId, replaceImmediate = true)
            }
        }
    }

    private fun durableState(info: WorkInfo): DurableWorkState = when (info.state) {
        WorkInfo.State.ENQUEUED -> DurableWorkState.ENQUEUED
        WorkInfo.State.RUNNING -> DurableWorkState.RUNNING
        WorkInfo.State.BLOCKED -> DurableWorkState.BLOCKED
        WorkInfo.State.SUCCEEDED -> DurableWorkState.SUCCEEDED
        WorkInfo.State.FAILED -> DurableWorkState.FAILED
        WorkInfo.State.CANCELLED -> DurableWorkState.CANCELLED
    }

    fun cancel(context: Context, userId: String?) {
        val manager = WorkManager.getInstance(context)
        userId?.let {
            manager.cancelUniqueWork(BackgroundWorkNames.immediate(it))
            manager.cancelUniqueWork(BackgroundWorkNames.periodic(it))
        }
        manager.cancelUniqueWork(LEGACY_BACKFILL)
        manager.cancelUniqueWork(LEGACY_PERIODIC)
    }

    const val WORK_MODE = "sync_mode"
    const val WORK_USER_KEY = "canonical_user_key"
}

class BackgroundHealthSyncWorker(appContext: Context, params: WorkerParameters) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val state = SyncRuntimeStateStore(applicationContext)
        val health = HealthConnectGateway(applicationContext)
        val auth = NativeGoogleAuth(
            applicationContext,
            BuildConfig.SUPABASE_URL,
            BuildConfig.SUPABASE_PUBLISHABLE_KEY,
            BuildConfig.GOOGLE_WEB_CLIENT_ID,
            BuildConfig.API_BASE_URL,
        )
        var session = auth.restore() ?: return Result.failure()
        val expectedUserKey = inputData.getString(BackgroundSyncScheduler.WORK_USER_KEY) ?: return Result.failure()
        if (BackgroundWorkNames.userKey(session.canonicalUserId) != expectedUserKey) return Result.failure()
        if (health.availability != androidx.health.connect.client.HealthConnectClient.SDK_AVAILABLE ||
            !health.hasAnyPermission() || health.backgroundReadState() != BackgroundHealthReadState.GRANTED
        ) {
            state.recordTerminal(session.canonicalUserId, "PERMISSION_REQUIRED")
            return Result.failure()
        }
        if (!AppSyncSingleFlight.gate.tryStart()) {
            state.recordTerminal(session.canonicalUserId, "RETRY_PENDING")
            return Result.retry()
        }
        return try {
            state.recordStarted(session.canonicalUserId, id.toString())
            withTimeout(BACKGROUND_DEADLINE_MS) {
                val end = state.activeWindowEnd(session.canonicalUserId, Instant.now())
                val mode = runCatching {
                    BackgroundSyncMode.valueOf(inputData.getString(BackgroundSyncScheduler.WORK_MODE).orEmpty())
                }.getOrDefault(BackgroundSyncMode.INCREMENTAL)
                val window = if (mode == BackgroundSyncMode.BACKFILL) {
                    SyncWindowPolicy.backfill(end)
                } else {
                    SyncWindowPolicy.incremental(end, state.lastSuccessfulSync(session.canonicalUserId))
                }
                state.recordProgress(session.canonicalUserId, "READING_HEALTH")
                val read = withTimeout(HEALTH_READ_TIMEOUT_MS) { health.readBounded(window.start, window.end) }
                val client = IngestionClient(BuildConfig.API_BASE_URL)
                state.recordProgress(session.canonicalUserId, "UPLOADING", 0)
                try {
                    withTimeout(UPLOAD_TIMEOUT_MS) {
                        withContext(Dispatchers.IO) {
                            client.upload(session, read.records, SyncCheckpointStore(applicationContext)) { done, _ ->
                                state.recordProgress(session.canonicalUserId, "UPLOADING", done)
                            }
                        }
                    }
                } catch (_: AuthenticationRequired) {
                    session = auth.refresh()
                    withTimeout(UPLOAD_TIMEOUT_MS) {
                        withContext(Dispatchers.IO) { client.upload(session, read.records, SyncCheckpointStore(applicationContext)) }
                    }
                }
                val result = if (read.isPartial) "SYNCED_PARTIAL" else if (read.records.isEmpty()) "NO_DATA" else "SYNCED"
                withContext(Dispatchers.IO) {
                    client.reportStatus(session, read.records, result, if (health.hasAllPermissions()) "GRANTED" else "PARTIAL")
                }
                if (mode == BackgroundSyncMode.BACKFILL) {
                    if (read.isPartial) state.markHistoryPending(session.canonicalUserId) else state.markHistoryComplete(session.canonicalUserId)
                }
                state.recordTerminal(session.canonicalUserId, if (read.isPartial) "PARTIAL" else "SUCCESS")
                state.saveLastSuccessfulSync(session.canonicalUserId)
                state.clearActiveWindow(session.canonicalUserId)
            }
            Result.success()
        } catch (_: AuthenticationRequired) {
            state.recordTerminal(session.canonicalUserId, "FAILED_AUTH")
            Result.failure()
        } catch (_: NativeAuthRejected) {
            state.recordTerminal(session.canonicalUserId, "FAILED_AUTH")
            Result.failure()
        } catch (_: TimeoutCancellationException) {
            if (runAttemptCount < MAX_RETRY_ATTEMPTS - 1) {
                state.recordTerminal(session.canonicalUserId, "RETRY_PENDING")
                Result.retry()
            } else {
                state.recordTerminal(session.canonicalUserId, "TIMEOUT")
                Result.failure()
            }
        } catch (_: Exception) {
            if (runAttemptCount < MAX_RETRY_ATTEMPTS - 1) {
                state.recordTerminal(session.canonicalUserId, "RETRY_PENDING")
                Result.retry()
            } else {
                state.recordTerminal(session.canonicalUserId, "FAILED")
                Result.failure()
            }
        } finally {
            AppSyncSingleFlight.gate.finish()
        }
    }

    companion object {
        const val MAX_RETRY_ATTEMPTS = 3
        const val BACKGROUND_DEADLINE_MS = 8 * 60_000L
        const val HEALTH_READ_TIMEOUT_MS = 3 * 60_000L
        const val UPLOAD_TIMEOUT_MS = 4 * 60_000L
    }
}
