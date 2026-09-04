package app.healthcompanion.sync

import org.junit.Assert.assertEquals
import org.junit.Test

class OnboardingStateMachineTest {
    @Test fun signedOutStartsAuthentication() = assertEquals(
        ConnectorUiState.AUTHENTICATING,
        OnboardingStateMachine.transition(ConnectorUiState.SIGNED_OUT, ConnectorEvent.LOGIN_STARTED),
    )

    @Test fun cancelledLoginReturnsToSignedOut() = assertEquals(
        ConnectorUiState.SIGNED_OUT,
        OnboardingStateMachine.transition(ConnectorUiState.AUTHENTICATING, ConnectorEvent.LOGIN_CANCELLED),
    )

    @Test fun restoredSessionIsAuthenticated() = assertEquals(
        ConnectorUiState.AUTHENTICATED,
        OnboardingStateMachine.transition(ConnectorUiState.AUTHENTICATING, ConnectorEvent.SESSION_RESTORED),
    )

    @Test fun permissionDenialIsRecoverable() = assertEquals(
        ConnectorUiState.HEALTH_PERMISSION_DENIED,
        OnboardingStateMachine.transition(ConnectorUiState.HEALTH_PERMISSION_REQUIRED, ConnectorEvent.PERMISSION_DENIED),
    )

    @Test fun grantedPermissionEnablesSync() = assertEquals(
        ConnectorUiState.READY_TO_SYNC,
        OnboardingStateMachine.transition(ConnectorUiState.HEALTH_PERMISSION_REQUIRED, ConnectorEvent.PERMISSION_GRANTED),
    )

    @Test fun syncDistinguishesNoDataFromSuccess() = assertEquals(
        ConnectorUiState.SYNC_NO_DATA,
        OnboardingStateMachine.transition(ConnectorUiState.SYNCING, ConnectorEvent.SYNC_NO_DATA),
    )

    @Test fun loginCannotInterruptActiveSync() = assertEquals(
        ConnectorUiState.SYNCING,
        OnboardingStateMachine.transition(ConnectorUiState.SYNCING, ConnectorEvent.LOGIN_STARTED),
    )

    @Test fun restoredAuthenticatedSessionEnablesLegacyStateMigration() = assertEquals(
        true,
        SessionUpgradePolicy.shouldMigrateLegacySyncState(restoredSession = true, canonicalUserId = "canonical-user"),
    )

    @Test fun freshLoginNeverClaimsLegacyStateFromAnotherAccount() = assertEquals(
        false,
        SessionUpgradePolicy.shouldMigrateLegacySyncState(restoredSession = false, canonicalUserId = "canonical-user"),
    )

    @Test fun failedRestoreLeavesLoginFallbackAvailable() {
        assertEquals(
            ConnectorUiState.AUTH_ERROR,
            OnboardingStateMachine.transition(ConnectorUiState.AUTHENTICATING, ConnectorEvent.LOGIN_FAILED),
        )
        assertEquals(
            ConnectorUiState.AUTHENTICATING,
            OnboardingStateMachine.transition(ConnectorUiState.AUTH_ERROR, ConnectorEvent.LOGIN_STARTED),
        )
    }
}
