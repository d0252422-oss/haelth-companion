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

object BackgroundWorkRecoveryPolicy {
    const val STALE_AFTER_MINUTES = 10L

    fun decide(localResult: String?, lastProgressAt: Instant?, actualStates: Set<DurableWorkState>, now: Instant): WorkRecoveryAction {
        val active = actualStates.any { it in setOf(DurableWorkState.ENQUEUED, DurableWorkState.RUNNING, DurableWorkState.BLOCKED) }
        val stale = localResult == "SYNCING" &&
            (lastProgressAt == null || lastProgressAt.plus(STALE_AFTER_MINUTES, ChronoUnit.MINUTES).isBefore(now))
        return when {
            stale -> WorkRecoveryAction.REPLACE_STALE
            active -> WorkRecoveryAction.KEEP
            else -> WorkRecoveryAction.ENQUEUE
        }
    }
}

object BackgroundWorkNames {
    fun userKey(userId: String): String = CanonicalIdentity.sha256(userId).take(16)
    fun immediate(userId: String): String = "health-sync-immediate-${userKey(userId)}"
    fun periodic(userId: String): String = "health-sync-periodic-${userKey(userId)}"
}
