package app.healthcompanion.sync

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
