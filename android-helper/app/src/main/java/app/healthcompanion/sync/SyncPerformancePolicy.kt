package app.healthcompanion.sync

import java.time.Instant
import java.time.temporal.ChronoUnit

object PaginationGuard {
    fun isRepeated(nextToken: String?, seenTokens: MutableSet<String>): Boolean =
        nextToken != null && !seenTokens.add(nextToken)
}

object SyncTerminalPolicy {
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
    const val STARTUP_FALLBACK_HOURS = 6L
    const val INCREMENTAL_OVERLAP_HOURS = 1L

    fun incremental(now: Instant, lastSuccess: Instant?): SyncWindow = SyncWindow(
        lastSuccess?.minus(INCREMENTAL_OVERLAP_HOURS, ChronoUnit.HOURS)
            ?: now.minus(STARTUP_FALLBACK_HOURS, ChronoUnit.HOURS),
        now,
    )

    fun backfill(now: Instant): SyncWindow = SyncWindow(now.minus(HISTORY_LOOKBACK_DAYS, ChronoUnit.DAYS), now)
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

enum class BackgroundSyncMode { INCREMENTAL, BACKFILL }

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
    fun userKey(userId: String): String = CanonicalIdentity.sha256(userId).take(16)
    fun immediate(userId: String): String = "health-sync-immediate-${userKey(userId)}"
    fun backfill(userId: String): String = "health-sync-backfill-${userKey(userId)}"
    fun periodic(userId: String): String = "health-sync-periodic-${userKey(userId)}"
}
