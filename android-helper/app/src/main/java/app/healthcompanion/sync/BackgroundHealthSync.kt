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
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
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
            .putInt(key(userId, BACKGROUND_REQUEST_COUNT), attemptCount)
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

    suspend fun enqueue(context: Context, userId: String, replaceImmediate: Boolean = false): BackgroundRuntimeStatus {
        val manager = WorkManager.getInstance(context)
        manager.cancelUniqueWork(LEGACY_BACKFILL)
        manager.cancelUniqueWork(LEGACY_PERIODIC)
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        if (!replaceImmediate) {
            val current = selectCurrent(queryForegroundWork(manager, userId), SyncRuntimeStateStore(context).workMetadata(userId).workId)
            if (current != null && current.state in ACTIVE_STATES) {
                val status = statusOf(current)
                recordObserved(context, userId, current, status)
                ensurePeriodic(manager, userId, constraints)
                return status
            }
        }
        val userKey = BackgroundWorkNames.userKey(userId)
        val immediate = OneTimeWorkRequestBuilder<BackgroundHealthSyncWorker>()
            .setConstraints(constraints)
            .setInputData(workDataOf(WORK_MODE to BackgroundSyncMode.INCREMENTAL.name, WORK_USER_KEY to userKey))
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .build()
        val immediatePolicy = if (replaceImmediate) ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.KEEP
        manager.beginUniqueWork(BackgroundWorkNames.immediate(userId), immediatePolicy, immediate).enqueue()
        SyncRuntimeStateStore(context).recordEnqueued(userId, immediate.id.toString())
        ensurePeriodic(manager, userId, constraints)
        return BackgroundRuntimeStatus.ENQUEUED
    }

    private fun ensurePeriodic(manager: WorkManager, userId: String, constraints: Constraints) {
        val userKey = BackgroundWorkNames.userKey(userId)
        val periodic = PeriodicWorkRequestBuilder<BackgroundHealthSyncWorker>(12, TimeUnit.HOURS)
            .setConstraints(constraints)
            .setInputData(workDataOf(WORK_MODE to BackgroundSyncMode.INCREMENTAL.name, WORK_USER_KEY to userKey))
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        manager.enqueueUniquePeriodicWork(BackgroundWorkNames.periodic(userId), ExistingPeriodicWorkPolicy.KEEP, periodic)
    }

    suspend fun enqueueBackfill(context: Context, userId: String) {
        val manager = WorkManager.getInstance(context)
        val existing = queryWork(manager, BackgroundWorkNames.backfill(userId))
        if (existing.any { it.state in ACTIVE_STATES }) return
        val request = OneTimeWorkRequestBuilder<BackgroundHealthSyncWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setInputData(workDataOf(WORK_MODE to BackgroundSyncMode.BACKFILL.name, WORK_USER_KEY to BackgroundWorkNames.userKey(userId)))
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        manager.enqueueUniqueWork(BackgroundWorkNames.backfill(userId), ExistingWorkPolicy.KEEP, request)
    }

    suspend fun reconcileAndEnqueue(context: Context, userId: String): BackgroundRuntimeStatus {
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
                ensurePeriodic(manager, userId, Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                decision.status
            }
            WorkRecoveryAction.ENQUEUE -> {
                if (decision.status == BackgroundRuntimeStatus.UP_TO_DATE) store.recordTerminal(userId, "UP_TO_DATE")
                enqueue(context, userId)
            }
            WorkRecoveryAction.REPLACE_STALE -> {
                store.recordTerminal(userId, "STALE_RECOVERED")
                manager.cancelUniqueWork(BackgroundWorkNames.backfill(userId))
                enqueue(context, userId, replaceImmediate = true)
            }
        }
    }

    fun observe(context: Context, userId: String): Flow<BackgroundRuntimeStatus> {
        val manager = WorkManager.getInstance(context)
        return combine(
            manager.getWorkInfosForUniqueWorkFlow(BackgroundWorkNames.immediate(userId)),
            manager.getWorkInfosForUniqueWorkFlow(BackgroundWorkNames.backfill(userId)),
        ) { immediate, backfill -> immediate + backfill }
            .map { infos ->
                val selected = selectCurrent(infos, SyncRuntimeStateStore(context).workMetadata(userId).workId)
                selected?.let {
                    val status = statusOf(it)
                    recordObserved(context, userId, it, status)
                    status
                } ?: BackgroundRuntimeStatus.UP_TO_DATE
            }
            .distinctUntilChanged()
    }

    private suspend fun queryForegroundWork(manager: WorkManager, userId: String): List<WorkInfo> =
        queryWork(manager, BackgroundWorkNames.immediate(userId)) + queryWork(manager, BackgroundWorkNames.backfill(userId))

    private suspend fun queryWork(manager: WorkManager, name: String): List<WorkInfo> = runCatching {
        withTimeout(WORK_QUERY_TIMEOUT_MS) { manager.getWorkInfosForUniqueWorkFlow(name).first() }
    }.getOrDefault(emptyList())

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

    fun cancel(context: Context, userId: String?) {
        val manager = WorkManager.getInstance(context)
        userId?.let {
            manager.cancelUniqueWork(BackgroundWorkNames.immediate(it))
            manager.cancelUniqueWork(BackgroundWorkNames.backfill(it))
            manager.cancelUniqueWork(BackgroundWorkNames.periodic(it))
        }
        manager.cancelUniqueWork(LEGACY_BACKFILL)
        manager.cancelUniqueWork(LEGACY_PERIODIC)
    }

    const val WORK_MODE = "sync_mode"
    const val WORK_USER_KEY = "canonical_user_key"
    const val PROGRESS_STAGE = "sync_stage"
    const val PROGRESS_AT_EPOCH_MS = "sync_progress_at"
    const val PROGRESS_REQUEST_COUNT = "sync_request_count"
    private const val WORK_QUERY_TIMEOUT_MS = 5_000L
    private val ACTIVE_STATES = setOf(WorkInfo.State.ENQUEUED, WorkInfo.State.RUNNING, WorkInfo.State.BLOCKED)
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
        val expectedUserKey = inputData.getString(BackgroundSyncScheduler.WORK_USER_KEY) ?: return Result.failure()
        setProgress(workDataOf(
            BackgroundSyncScheduler.PROGRESS_STAGE to "SESSION",
            BackgroundSyncScheduler.PROGRESS_AT_EPOCH_MS to System.currentTimeMillis(),
            BackgroundSyncScheduler.PROGRESS_REQUEST_COUNT to 0,
        ))
        var session = try {
            withTimeout(SESSION_TIMEOUT_MS) { auth.restore() }
        } catch (_: TimeoutCancellationException) {
            return retryOrFailWithoutSession()
        } ?: return Result.failure()
        if (BackgroundWorkNames.userKey(session.canonicalUserId) != expectedUserKey) {
            state.recordTerminal(session.canonicalUserId, "FAILED_AUTH")
            return Result.failure()
        }
        state.recordStarted(session.canonicalUserId, id.toString())
        reportProgress(state, session.canonicalUserId, "PERMISSION")
        val permissionReady = try {
            withTimeout(PERMISSION_TIMEOUT_MS) {
                health.availability == androidx.health.connect.client.HealthConnectClient.SDK_AVAILABLE &&
                    health.hasAnyPermission() && health.backgroundReadState() == BackgroundHealthReadState.GRANTED
            }
        } catch (_: TimeoutCancellationException) {
            state.recordTerminal(session.canonicalUserId, "RETRY_PENDING")
            return retryOrFail()
        }
        if (!permissionReady) {
            state.recordTerminal(session.canonicalUserId, "PERMISSION_REQUIRED")
            return Result.failure()
        }
        if (!AppSyncSingleFlight.gate.tryStart()) {
            state.recordTerminal(session.canonicalUserId, "RETRY_PENDING")
            return Result.retry()
        }
        return try {
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
                reportProgress(state, session.canonicalUserId, "HEALTH_READ")
                val read = withTimeout(HEALTH_READ_TIMEOUT_MS) { health.readBounded(window.start, window.end) }
                val client = IngestionClient(BuildConfig.API_BASE_URL)
                reportProgress(state, session.canonicalUserId, "UPLOAD", 0)
                try {
                    withTimeout(UPLOAD_TIMEOUT_MS) {
                        withContext(Dispatchers.IO) {
                            client.upload(session, read.records, SyncCheckpointStore(applicationContext)) { done, _ ->
                                state.recordProgress(session.canonicalUserId, "UPLOAD", done)
                            }
                        }
                    }
                } catch (_: AuthenticationRequired) {
                    reportProgress(state, session.canonicalUserId, "SESSION_REFRESH")
                    session = withTimeout(SESSION_TIMEOUT_MS) { auth.refresh() }
                    withTimeout(UPLOAD_TIMEOUT_MS) {
                        withContext(Dispatchers.IO) { client.upload(session, read.records, SyncCheckpointStore(applicationContext)) }
                    }
                }
                reportProgress(state, session.canonicalUserId, "CHECKPOINT")
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
                if (mode == BackgroundSyncMode.INCREMENTAL && state.isHistoryPending(session.canonicalUserId)) {
                    BackgroundSyncScheduler.enqueueBackfill(applicationContext, session.canonicalUserId)
                }
            }
            Result.success()
        } catch (_: AuthenticationRequired) {
            state.recordTerminal(session.canonicalUserId, "FAILED_AUTH")
            Result.failure()
        } catch (_: NativeAuthRejected) {
            state.recordTerminal(session.canonicalUserId, "FAILED_AUTH")
            Result.failure()
        } catch (_: TimeoutCancellationException) {
            state.recordTerminal(session.canonicalUserId, if (runAttemptCount < MAX_RETRY_ATTEMPTS - 1) "RETRY_PENDING" else "TIMEOUT")
            retryOrFail()
        } catch (cancelled: CancellationException) {
            state.recordTerminal(session.canonicalUserId, "RETRY_PENDING")
            throw cancelled
        } catch (_: Exception) {
            state.recordTerminal(session.canonicalUserId, if (runAttemptCount < MAX_RETRY_ATTEMPTS - 1) "RETRY_PENDING" else "FAILED")
            retryOrFail()
        } finally {
            AppSyncSingleFlight.gate.finish()
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

    private fun retryOrFail(): Result = if (runAttemptCount < MAX_RETRY_ATTEMPTS - 1) Result.retry() else Result.failure()
    private fun retryOrFailWithoutSession(): Result = retryOrFail()

    companion object {
        const val MAX_RETRY_ATTEMPTS = 3
        const val BACKGROUND_DEADLINE_MS = 8 * 60_000L
        const val HEALTH_READ_TIMEOUT_MS = 3 * 60_000L
        const val UPLOAD_TIMEOUT_MS = 4 * 60_000L
        const val SESSION_TIMEOUT_MS = 30_000L
        const val PERMISSION_TIMEOUT_MS = 30_000L
    }
}
