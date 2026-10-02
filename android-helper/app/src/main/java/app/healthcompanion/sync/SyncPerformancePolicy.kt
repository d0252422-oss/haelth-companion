package app.healthcompanion.sync

import java.time.Instant
import java.time.temporal.ChronoUnit

object PaginationGuard {
    fun isRepeated(nextToken: String?, seenTokens: MutableSet<String>): Boolean =
        nextToken != null && !seenTokens.add(nextToken)
}

object SyncTerminalPolicy {
    fun isDurablyComplete(readPartial: Boolean, reconciliationPending: Boolean): Boolean =
        !readPartial && !reconciliationPending

    fun state(hasData: Boolean, partial: Boolean, timedOut: Boolean): ConnectorUiState = when {
        timedOut -> ConnectorUiState.SYNC_TIMEOUT
        partial -> ConnectorUiState.SYNC_PARTIAL
        hasData -> ConnectorUiState.SYNC_SUCCESS
        else -> ConnectorUiState.SYNC_NO_DATA
    }
}

data class SyncWindow(val start: Instant, val end: Instant)

object SyncWindowPolicy {
    const val HISTORY_LOOKBACK_DAYS = 30L
    const val P0_RECOVERY_LOOKBACK_HOURS = 72L
    const val STARTUP_FALLBACK_HOURS = 6L
    const val INCREMENTAL_OVERLAP_HOURS = 1L

    fun incremental(now: Instant, lastSuccess: Instant?): SyncWindow = SyncWindow(
        lastSuccess?.minus(INCREMENTAL_OVERLAP_HOURS, ChronoUnit.HOURS)
            ?: now.minus(STARTUP_FALLBACK_HOURS, ChronoUnit.HOURS),
        now,
    )

    fun backfill(now: Instant): SyncWindow = SyncWindow(now.minus(HISTORY_LOOKBACK_DAYS, ChronoUnit.DAYS), now)

    fun p0Recovery(frozenEnd: Instant): SyncWindow =
        SyncWindow(frozenEnd.minus(P0_RECOVERY_LOOKBACK_HOURS, ChronoUnit.HOURS), frozenEnd)

    // A retried window may finish hours after its frozen end. Only the durable
    // window boundary is safe as the next incremental cursor.
    fun completedCursor(window: SyncWindow): Instant = window.end
}

/** A foreground gesture must not hold the user while durable background sync can continue. */
internal object ForegroundSyncBudget {
    const val BACKGROUND_CAPABLE_MS = 25_000L
    const val FOREGROUND_ONLY_MS = 120_000L

    fun deadlineMs(backgroundReadGranted: Boolean): Long =
        if (backgroundReadGranted) BACKGROUND_CAPABLE_MS else FOREGROUND_ONLY_MS
}

class SyncSingleFlight {
    private var running = false

    @Synchronized fun tryStart(): Boolean {
        if (running) return false
        running = true
        return true
    }

    @Synchronized fun finish() { running = false }
}

object AppSyncSingleFlight {
    val gate = SyncSingleFlight()
}

enum class BackgroundSyncMode { INCREMENTAL, BACKFILL, P0_RECOVERY }

/** The one-time P0 replay is limited to the two missing data domains. */
internal object HealthReadDomainPolicy {
    private val p0RecoveryDomains = setOf("steps", "total_energy")

    fun forMode(mode: BackgroundSyncMode): Set<String>? =
        if (mode == BackgroundSyncMode.P0_RECOVERY) p0RecoveryDomains else null

    fun includes(domains: Set<String>?, domain: String): Boolean = domains == null || domain in domains
}

/** A missing system job is distinct from a WorkManager row waiting for constraints. */
internal object PeriodicSchedulerRecoveryPolicy {
    const val REPAIR_COOLDOWN_MS = 15 * 60_000L

    fun shouldReplace(
        state: DurableWorkState?,
        systemJobPresent: Boolean?,
        lastRepairAtMs: Long,
        nowMs: Long,
    ): Boolean {
        if (lastRepairAtMs > 0 && nowMs - lastRepairAtMs in 0 until REPAIR_COOLDOWN_MS) return false
        return when (state) {
            null, DurableWorkState.FAILED, DurableWorkState.CANCELLED,
            DurableWorkState.SUCCEEDED, DurableWorkState.BLOCKED -> true
            DurableWorkState.ENQUEUED -> systemJobPresent == false
            DurableWorkState.RUNNING, DurableWorkState.UNKNOWN -> false
        }
    }
}

object BackgroundContinuationPolicy {
    const val DEFAULT_MAX_ATTEMPTS = 3
    const val BACKFILL_MAX_CONTINUATION_ATTEMPTS = 12
    const val BACKFILL_RECONCILIATION_MAX_ATTEMPTS = 24

    fun maxAttempts(
        mode: BackgroundSyncMode,
        uploadStarted: Boolean,
        checkpointIndex: Int,
        reconciliationPass: Int = 0,
    ): Int = when {
        mode == BackgroundSyncMode.INCREMENTAL -> DEFAULT_MAX_ATTEMPTS
        mode == BackgroundSyncMode.P0_RECOVERY -> BACKFILL_RECONCILIATION_MAX_ATTEMPTS
        reconciliationPass > 0 -> BACKFILL_RECONCILIATION_MAX_ATTEMPTS
        uploadStarted || checkpointIndex > 0 -> BACKFILL_MAX_CONTINUATION_ATTEMPTS
        else -> DEFAULT_MAX_ATTEMPTS
    }

    fun shouldRetry(runAttemptCount: Int, maxAttempts: Int): Boolean =
        runAttemptCount < maxAttempts - 1
}

enum class DurableWorkState { ENQUEUED, RUNNING, BLOCKED, SUCCEEDED, FAILED, CANCELLED, UNKNOWN }
enum class WorkRecoveryAction { KEEP, ENQUEUE, REPLACE_STALE }
enum class BackgroundRuntimeStatus {
    ENQUEUED,
    WAITING_FOR_CONSTRAINT,
    RUNNING,
    RETRY_PENDING,
    UP_TO_DATE,
    FAILED,
    STALE_RECOVERED,
}

data class WorkRuntimeSnapshot(
    val state: DurableWorkState,
    val runAttemptCount: Int = 0,
    val hasRunnablePredecessor: Boolean = false,
)

data class WorkRecoveryDecision(
    val action: WorkRecoveryAction,
    val status: BackgroundRuntimeStatus,
)

object BackgroundWorkRecoveryPolicy {
    const val STALE_AFTER_MINUTES = 8L

    fun statusWithoutActiveWork(
        localResult: String?,
        preferredTerminalState: DurableWorkState? = null,
    ): BackgroundRuntimeStatus = when {
        localResult in setOf("FAILED", "FAILED_AUTH", "TIMEOUT", "PERMISSION_REQUIRED") ->
            BackgroundRuntimeStatus.FAILED
        localResult in setOf("PARTIAL", "RETRY_PENDING", "SYNCING") ->
            BackgroundRuntimeStatus.RETRY_PENDING
        preferredTerminalState in setOf(DurableWorkState.FAILED, DurableWorkState.CANCELLED) ->
            BackgroundRuntimeStatus.RETRY_PENDING
        preferredTerminalState == DurableWorkState.SUCCEEDED -> BackgroundRuntimeStatus.UP_TO_DATE
        localResult in setOf("SUCCESS", "UP_TO_DATE") -> BackgroundRuntimeStatus.UP_TO_DATE
        localResult in setOf("ENQUEUED", "STALE_RECOVERED") -> BackgroundRuntimeStatus.ENQUEUED
        else -> BackgroundRuntimeStatus.ENQUEUED
    }

    fun decide(
        localResult: String?,
        lastProgressAt: Instant?,
        actual: WorkRuntimeSnapshot?,
        now: Instant,
    ): WorkRecoveryDecision {
        val staleRunning = actual?.state == DurableWorkState.RUNNING &&
            (lastProgressAt == null || lastProgressAt.plus(STALE_AFTER_MINUTES, ChronoUnit.MINUTES).isBefore(now))
        return when {
            staleRunning -> WorkRecoveryDecision(WorkRecoveryAction.REPLACE_STALE, BackgroundRuntimeStatus.STALE_RECOVERED)
            actual == null && localResult == "SYNCING" ->
                WorkRecoveryDecision(WorkRecoveryAction.REPLACE_STALE, BackgroundRuntimeStatus.STALE_RECOVERED)
            actual == null -> WorkRecoveryDecision(WorkRecoveryAction.ENQUEUE, BackgroundRuntimeStatus.ENQUEUED)
            actual.state == DurableWorkState.RUNNING ->
                WorkRecoveryDecision(WorkRecoveryAction.KEEP, BackgroundRuntimeStatus.RUNNING)
            actual.state == DurableWorkState.ENQUEUED -> WorkRecoveryDecision(
                WorkRecoveryAction.KEEP,
                if (actual.runAttemptCount > 0) BackgroundRuntimeStatus.RETRY_PENDING else BackgroundRuntimeStatus.ENQUEUED,
            )
            actual.state == DurableWorkState.BLOCKED && !actual.hasRunnablePredecessor ->
                WorkRecoveryDecision(WorkRecoveryAction.REPLACE_STALE, BackgroundRuntimeStatus.STALE_RECOVERED)
            actual.state == DurableWorkState.BLOCKED ->
                WorkRecoveryDecision(WorkRecoveryAction.KEEP, BackgroundRuntimeStatus.WAITING_FOR_CONSTRAINT)
            actual.state == DurableWorkState.SUCCEEDED ->
                WorkRecoveryDecision(WorkRecoveryAction.ENQUEUE, BackgroundRuntimeStatus.UP_TO_DATE)
            actual.state in setOf(DurableWorkState.FAILED, DurableWorkState.CANCELLED, DurableWorkState.UNKNOWN) ->
                WorkRecoveryDecision(WorkRecoveryAction.ENQUEUE, BackgroundRuntimeStatus.RETRY_PENDING)
            else -> WorkRecoveryDecision(WorkRecoveryAction.ENQUEUE, BackgroundRuntimeStatus.FAILED)
        }
    }
}

object BackgroundWorkNames {
    fun userKey(userId: String): String = SyncStateNamespace.userKey(userId)
    fun immediate(userId: String): String = "health-sync-immediate-${userKey(userId)}"
    fun backfill(userId: String): String = "health-sync-backfill-${userKey(userId)}"
    // v21's one-time replay completed before Total Energy permission was granted.
    // A new unique request replays the same bounded window without altering SQL rows.
    fun p0Recovery(userId: String): String = "health-sync-p0-recovery-v23-${userKey(userId)}"
    fun periodic(userId: String): String = "health-sync-periodic-${userKey(userId)}"
}
