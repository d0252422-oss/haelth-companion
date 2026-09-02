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
import java.time.temporal.ChronoUnit
import java.util.concurrent.TimeUnit

class SyncRuntimeStateStore(context: Context) {
    private val preferences = context.getSharedPreferences("sync_runtime_state", Context.MODE_PRIVATE)

    fun markHistoryPending() = preferences.edit().putBoolean(HISTORY_PENDING, true).apply()
    fun markHistoryComplete() = preferences.edit().putBoolean(HISTORY_PENDING, false).apply()
    fun isHistoryPending(): Boolean = preferences.getBoolean(HISTORY_PENDING, false)
    fun saveBackgroundResult(result: String) = preferences.edit()
        .putString(BACKGROUND_RESULT, result)
        .putString(BACKGROUND_RESULT_AT, Instant.now().toString())
        .apply()
    fun lastSuccessfulSync(): Instant? = contextPreferences.getString("last_success", null)
        ?.let { runCatching { Instant.parse(it) }.getOrNull() }
    fun saveLastSuccessfulSync(value: Instant = Instant.now()) {
        contextPreferences.edit().putString("last_success", value.toString()).apply()
    }

    private val contextPreferences = context.getSharedPreferences("sync_status", Context.MODE_PRIVATE)

    private companion object {
        const val HISTORY_PENDING = "history_pending"
        const val BACKGROUND_RESULT = "background_result"
        const val BACKGROUND_RESULT_AT = "background_result_at"
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
                val start = if (state.isHistoryPending()) {
                    end.minus(HISTORY_LOOKBACK_DAYS, ChronoUnit.DAYS)
                } else {
                    (state.lastSuccessfulSync()?.minus(INCREMENTAL_OVERLAP_HOURS, ChronoUnit.HOURS)
                        ?: end.minus(FOREGROUND_FALLBACK_DAYS, ChronoUnit.DAYS))
                }
                val read = health.readBounded(start, end)
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
                if (read.isPartial) state.markHistoryPending() else state.markHistoryComplete()
                state.saveBackgroundResult(result)
                state.saveLastSuccessfulSync()
            }
            Result.success()
        } catch (_: AuthenticationRequired) {
            Result.failure()
        } catch (_: NativeAuthRejected) {
            Result.failure()
        } catch (_: Exception) {
            state.saveBackgroundResult("RETRY_PENDING")
            if (runAttemptCount < MAX_RETRY_ATTEMPTS - 1) Result.retry() else Result.failure()
        }
    }

    companion object {
        const val HISTORY_LOOKBACK_DAYS = 30L
        const val FOREGROUND_FALLBACK_DAYS = 7L
        const val INCREMENTAL_OVERLAP_HOURS = 1L
        const val MAX_RETRY_ATTEMPTS = 3
        const val BACKGROUND_DEADLINE_MS = 8 * 60_000L
    }
}
