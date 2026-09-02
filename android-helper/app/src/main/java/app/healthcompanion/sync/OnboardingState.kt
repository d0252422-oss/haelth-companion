package app.healthcompanion.sync

enum class ConnectorUiState {
    SIGNED_OUT,
    AUTHENTICATING,
    AUTHENTICATED,
    HEALTH_CONNECT_UNAVAILABLE,
    HEALTH_PERMISSION_REQUIRED,
    HEALTH_PERMISSION_DENIED,
    READY_TO_SYNC,
    SYNCING,
    SYNC_PARTIAL,
    SYNC_TIMEOUT,
    SYNC_SUCCESS,
    SYNC_NO_DATA,
    AUTH_ERROR,
    SYNC_ERROR,
}

enum class ConnectorEvent {
    LOGIN_STARTED,
    LOGIN_SUCCEEDED,
    LOGIN_CANCELLED,
    LOGIN_FAILED,
    SESSION_RESTORED,
    SESSION_MISSING,
    HEALTH_UNAVAILABLE,
    PERMISSION_REQUIRED,
    PERMISSION_DENIED,
    PERMISSION_GRANTED,
    SYNC_STARTED,
    SYNC_SUCCEEDED,
    SYNC_PARTIAL,
    SYNC_TIMEOUT,
    SYNC_NO_DATA,
    SYNC_FAILED,
    LOGGED_OUT,
}

object OnboardingStateMachine {
    fun transition(current: ConnectorUiState, event: ConnectorEvent): ConnectorUiState = when (event) {
        ConnectorEvent.LOGIN_STARTED -> if (current == ConnectorUiState.SYNCING) current else ConnectorUiState.AUTHENTICATING
        ConnectorEvent.LOGIN_SUCCEEDED, ConnectorEvent.SESSION_RESTORED -> ConnectorUiState.AUTHENTICATED
        ConnectorEvent.LOGIN_CANCELLED, ConnectorEvent.SESSION_MISSING, ConnectorEvent.LOGGED_OUT -> ConnectorUiState.SIGNED_OUT
        ConnectorEvent.LOGIN_FAILED -> ConnectorUiState.AUTH_ERROR
        ConnectorEvent.HEALTH_UNAVAILABLE -> ConnectorUiState.HEALTH_CONNECT_UNAVAILABLE
        ConnectorEvent.PERMISSION_REQUIRED -> ConnectorUiState.HEALTH_PERMISSION_REQUIRED
        ConnectorEvent.PERMISSION_DENIED -> ConnectorUiState.HEALTH_PERMISSION_DENIED
        ConnectorEvent.PERMISSION_GRANTED -> ConnectorUiState.READY_TO_SYNC
        ConnectorEvent.SYNC_STARTED -> if (current in setOf(ConnectorUiState.READY_TO_SYNC, ConnectorUiState.SYNC_SUCCESS, ConnectorUiState.SYNC_PARTIAL, ConnectorUiState.SYNC_TIMEOUT, ConnectorUiState.SYNC_NO_DATA, ConnectorUiState.SYNC_ERROR)) ConnectorUiState.SYNCING else current
        ConnectorEvent.SYNC_SUCCEEDED -> ConnectorUiState.SYNC_SUCCESS
        ConnectorEvent.SYNC_PARTIAL -> ConnectorUiState.SYNC_PARTIAL
        ConnectorEvent.SYNC_TIMEOUT -> ConnectorUiState.SYNC_TIMEOUT
        ConnectorEvent.SYNC_NO_DATA -> ConnectorUiState.SYNC_NO_DATA
        ConnectorEvent.SYNC_FAILED -> ConnectorUiState.SYNC_ERROR
    }
}
