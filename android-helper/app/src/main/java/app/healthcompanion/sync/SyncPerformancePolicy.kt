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
    const val FALLBACK_LOOKBACK_DAYS = 7L
    const val INCREMENTAL_OVERLAP_HOURS = 1L

    fun background(now: Instant, lastSuccess: Instant?, historyPending: Boolean): SyncWindow {
        val start = when {
            historyPending -> now.minus(HISTORY_LOOKBACK_DAYS, ChronoUnit.DAYS)
            lastSuccess != null -> lastSuccess.minus(INCREMENTAL_OVERLAP_HOURS, ChronoUnit.HOURS)
            else -> now.minus(FALLBACK_LOOKBACK_DAYS, ChronoUnit.DAYS)
        }
        return SyncWindow(start, now)
    }
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
