package app.healthcompanion.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
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
            .apply()
        contextPreferences.edit().remove(key(userId, LAST_SUCCESS)).apply()
    }

    private fun key(userId: String, name: String) = "${CanonicalIdentity.sha256(userId).take(16)}_$name"

    private val contextPreferences = context.getSharedPreferences("sync_status", Context.MODE_PRIVATE)

    private companion object {
        const val HISTORY_PENDING = "history_pending"
        const val BACKGROUND_RESULT = "background_result"
        const val BACKGROUND_RESULT_AT = "background_result_at"
        const val LAST_SUCCESS = "last_success"
    }
}

object BackgroundSyncScheduler {
    private const val UNIQUE_BACKFILL = "health-sync-history-backfill"
    private const val UNIQUE_PERIODIC = "health-sync-periodic"

    fun enqueue(context: Context) {
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val backfill = OneTimeWorkRequestBuilder<BackgroundHealthSyncWorker>()
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(UNIQUE_BACKFILL, ExistingWorkPolicy.KEEP, backfill)

        val periodic = PeriodicWorkRequestBuilder<BackgroundHealthSyncWorker>(12, TimeUnit.HOURS)
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(UNIQUE_PERIODIC, ExistingPeriodicWorkPolicy.KEEP, periodic)
    }

    fun cancel(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_BACKFILL)
        WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_PERIODIC)
    }
}

class BackgroundHealthSyncWorker(appContext: Context, params: WorkerParameters) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val state = SyncRuntimeStateStore(applicationContext)
        val health = HealthConnectGateway(applicationContext)
        if (health.availability != androidx.health.connect.client.HealthConnectClient.SDK_AVAILABLE) return Result.failure()
        if (!health.hasAnyPermission() || !health.hasBackgroundReadPermission()) return Result.failure()

        val auth = NativeGoogleAuth(
            applicationContext,
            BuildConfig.SUPABASE_URL,
            BuildConfig.SUPABASE_PUBLISHABLE_KEY,
            BuildConfig.GOOGLE_WEB_CLIENT_ID,
            BuildConfig.API_BASE_URL,
        )
        var session = auth.restore() ?: return Result.failure()
        return try {
            withTimeout(BACKGROUND_DEADLINE_MS) {
                val end = Instant.now()
                val window = SyncWindowPolicy.background(end, state.lastSuccessfulSync(session.canonicalUserId), state.isHistoryPending(session.canonicalUserId))
                val read = health.readBounded(window.start, window.end)
                val client = IngestionClient(BuildConfig.API_BASE_URL)
                try {
                    withContext(Dispatchers.IO) { client.upload(session, read.records, SyncCheckpointStore(applicationContext)) }
                } catch (_: AuthenticationRequired) {
                    session = auth.refresh()
                    withContext(Dispatchers.IO) { client.upload(session, read.records, SyncCheckpointStore(applicationContext)) }
                }
                val result = if (read.isPartial) "SYNCED_PARTIAL" else if (read.records.isEmpty()) "NO_DATA" else "SYNCED"
                withContext(Dispatchers.IO) {
                    client.reportStatus(session, read.records, result, if (health.hasAllPermissions()) "GRANTED" else "PARTIAL")
                }
                if (read.isPartial) state.markHistoryPending(session.canonicalUserId) else state.markHistoryComplete(session.canonicalUserId)
                state.saveBackgroundResult(session.canonicalUserId, result)
                state.saveLastSuccessfulSync(session.canonicalUserId)
            }
            Result.success()
        } catch (_: AuthenticationRequired) {
            Result.failure()
        } catch (_: NativeAuthRejected) {
            Result.failure()
        } catch (_: Exception) {
            session.let { state.saveBackgroundResult(it.canonicalUserId, "RETRY_PENDING") }
            if (runAttemptCount < MAX_RETRY_ATTEMPTS - 1) Result.retry() else Result.failure()
        }
    }

    companion object {
        const val MAX_RETRY_ATTEMPTS = 3
        const val BACKGROUND_DEADLINE_MS = 8 * 60_000L
    }
}
