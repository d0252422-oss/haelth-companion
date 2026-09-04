package app.healthcompanion.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class SyncPerformancePolicyTest {
    @Test fun paginationTerminatesOnRepeatedToken() {
        val seen = mutableSetOf<String>()
        assertFalse(PaginationGuard.isRepeated("page-2", seen))
        assertTrue(PaginationGuard.isRepeated("page-2", seen))
        assertFalse(PaginationGuard.isRepeated(null, seen))
    }

    @Test fun everyForegroundPathHasTerminalUiState() {
        assertEquals(ConnectorUiState.SYNC_SUCCESS, SyncTerminalPolicy.state(hasData = true, partial = false, timedOut = false))
        assertEquals(ConnectorUiState.SYNC_NO_DATA, SyncTerminalPolicy.state(hasData = false, partial = false, timedOut = false))
        assertEquals(ConnectorUiState.SYNC_PARTIAL, SyncTerminalPolicy.state(hasData = true, partial = true, timedOut = false))
        assertEquals(ConnectorUiState.SYNC_TIMEOUT, SyncTerminalPolicy.state(hasData = true, partial = false, timedOut = true))
    }

    @Test fun highVolumeTenThousandRecordsRemainBoundedAndComplete() {
        val records = (1..10_000).map { index ->
            CanonicalHealthRecord(
                domain = "heart_rate", sourceApp = "test.origin", sourceRecordId = "hr-$index",
                sourceUpdatedAt = "2026-09-02T00:00:00Z", recordedAt = "2026-09-02T00:00:00Z",
                startedAt = "2026-09-02T00:00:00Z", endedAt = "2026-09-02T00:00:00Z",
                timezone = "Asia/Taipei", localDate = "2026-09-02", value = 72.0, unit = "bpm",
            )
        }
        val plan = BatchPlanner.plan("11111111-1111-4111-8111-111111111111", records)
        assertEquals(records.size, plan.batches.sumOf { it.recordCount })
        assertTrue(plan.batches.all { it.recordCount <= BatchPlanner.MAX_RECORDS_PER_BATCH })
        assertTrue(plan.batches.all { it.body.toByteArray().size <= BatchPlanner.MAX_APPROX_SERIALIZED_BYTES_PER_BATCH })
    }

    @Test fun startupIncrementalWindowIsSmallWhenNoSuccessExists() {
        val now = Instant.parse("2026-09-03T00:00:00Z")
        assertEquals(Instant.parse("2026-09-02T18:00:00Z"), SyncWindowPolicy.incremental(now, null).start)
    }

    @Test fun incrementalWindowUsesOneHourOverlap() {
        val now = Instant.parse("2026-09-03T00:00:00Z")
        val last = Instant.parse("2026-09-02T20:00:00Z")
        assertEquals(Instant.parse("2026-09-02T19:00:00Z"), SyncWindowPolicy.incremental(now, last).start)
    }

    @Test fun backfillUsesBoundedThirtyDayWindow() {
        val now = Instant.parse("2026-09-03T00:00:00Z")
        assertEquals(Instant.parse("2026-08-04T00:00:00Z"), SyncWindowPolicy.backfill(now).start)
    }

    @Test fun syncSingleFlightRejectsOverlapAndReopensAfterCompletion() {
        val gate = SyncSingleFlight()
        assertTrue(gate.tryStart())
        assertFalse(gate.tryStart())
        gate.finish()
        assertTrue(gate.tryStart())
    }

    @Test fun workNamesAreDeterministicAndUserScoped() {
        assertEquals(BackgroundWorkNames.immediate("user-a"), BackgroundWorkNames.immediate("user-a"))
        assertFalse(BackgroundWorkNames.immediate("user-a") == BackgroundWorkNames.immediate("user-b"))
        assertFalse(BackgroundWorkNames.periodic("user-a") == BackgroundWorkNames.immediate("user-a"))
    }

    @Test fun staleRunningMetadataIsReplacedEvenWhenWorkManagerStillSaysRunning() {
        val now = Instant.parse("2026-09-03T12:00:00Z")
        assertEquals(
            WorkRecoveryAction.REPLACE_STALE,
            BackgroundWorkRecoveryPolicy.decide(
                "SYNCING", now.minusSeconds(9 * 60), WorkRuntimeSnapshot(DurableWorkState.RUNNING), now,
            ).action,
        )
    }

    @Test fun recentRunningMetadataKeepsExistingWork() {
        val now = Instant.parse("2026-09-03T12:00:00Z")
        assertEquals(
            WorkRecoveryAction.KEEP,
            BackgroundWorkRecoveryPolicy.decide(
                "SYNCING", now.minusSeconds(60), WorkRuntimeSnapshot(DurableWorkState.RUNNING), now,
            ).action,
        )
    }

    @Test fun missingOrTerminalWorkIsEnqueuedAgain() {
        val now = Instant.parse("2026-09-03T12:00:00Z")
        assertEquals(WorkRecoveryAction.ENQUEUE, BackgroundWorkRecoveryPolicy.decide("FAILED", now, null, now).action)
        assertEquals(
            WorkRecoveryAction.ENQUEUE,
            BackgroundWorkRecoveryPolicy.decide("SYNCING", now.minusSeconds(60), WorkRuntimeSnapshot(DurableWorkState.FAILED), now).action,
        )
    }

    @Test fun constrainedEnqueuedWorkIsNotCancelledMerelyForWaiting() {
        val now = Instant.parse("2026-09-03T12:00:00Z")
        assertEquals(
            WorkRecoveryAction.KEEP,
            BackgroundWorkRecoveryPolicy.decide(
                "ENQUEUED", now.minusSeconds(60 * 60), WorkRuntimeSnapshot(DurableWorkState.ENQUEUED), now,
            ).action,
        )
    }

    @Test fun enqueuedIsNeverReportedAsRunning() {
        val decision = BackgroundWorkRecoveryPolicy.decide(null, null, WorkRuntimeSnapshot(DurableWorkState.ENQUEUED), Instant.now())
        assertEquals(BackgroundRuntimeStatus.ENQUEUED, decision.status)
    }

    @Test fun retryingEnqueuedWorkHasExplicitRetryState() {
        val decision = BackgroundWorkRecoveryPolicy.decide(null, null, WorkRuntimeSnapshot(DurableWorkState.ENQUEUED, runAttemptCount = 1), Instant.now())
        assertEquals(BackgroundRuntimeStatus.RETRY_PENDING, decision.status)
    }

    @Test fun runningOnlyFollowsActualWorkerEntry() {
        val now = Instant.parse("2026-09-03T12:00:00Z")
        val decision = BackgroundWorkRecoveryPolicy.decide("ENQUEUED", now.minusSeconds(30), WorkRuntimeSnapshot(DurableWorkState.RUNNING), now)
        assertEquals(BackgroundRuntimeStatus.RUNNING, decision.status)
    }

    @Test fun missingWorkRecoversPersistedRunningState() {
        val decision = BackgroundWorkRecoveryPolicy.decide("SYNCING", Instant.now(), null, Instant.now())
        assertEquals(WorkRecoveryAction.REPLACE_STALE, decision.action)
        assertEquals(BackgroundRuntimeStatus.STALE_RECOVERED, decision.status)
    }

    @Test fun succeededWorkTransitionsUpToDateBeforeNextSchedule() {
        val decision = BackgroundWorkRecoveryPolicy.decide("SYNCING", Instant.now(), WorkRuntimeSnapshot(DurableWorkState.SUCCEEDED), Instant.now())
        assertEquals(BackgroundRuntimeStatus.UP_TO_DATE, decision.status)
        assertEquals(WorkRecoveryAction.ENQUEUE, decision.action)
    }

    @Test fun failedWorkBecomesRetryPending() {
        val decision = BackgroundWorkRecoveryPolicy.decide("SYNCING", Instant.now(), WorkRuntimeSnapshot(DurableWorkState.FAILED), Instant.now())
        assertEquals(BackgroundRuntimeStatus.RETRY_PENDING, decision.status)
    }

    @Test fun cancelledWorkBecomesRetryPending() {
        val decision = BackgroundWorkRecoveryPolicy.decide("SYNCING", Instant.now(), WorkRuntimeSnapshot(DurableWorkState.CANCELLED), Instant.now())
        assertEquals(BackgroundRuntimeStatus.RETRY_PENDING, decision.status)
    }

    @Test fun blockedWorkWithRunnablePredecessorWaits() {
        val decision = BackgroundWorkRecoveryPolicy.decide(null, null, WorkRuntimeSnapshot(DurableWorkState.BLOCKED, hasRunnablePredecessor = true), Instant.now())
        assertEquals(BackgroundRuntimeStatus.WAITING_FOR_CONSTRAINT, decision.status)
        assertEquals(WorkRecoveryAction.KEEP, decision.action)
    }

    @Test fun orphanedBlockedChainIsReplaced() {
        val decision = BackgroundWorkRecoveryPolicy.decide(null, null, WorkRuntimeSnapshot(DurableWorkState.BLOCKED), Instant.now())
        assertEquals(WorkRecoveryAction.REPLACE_STALE, decision.action)
    }

    @Test fun immediateBackfillAndPeriodicNamesNeverCollide() {
        val user = "user-a"
        assertTrue(setOf(BackgroundWorkNames.immediate(user), BackgroundWorkNames.backfill(user), BackgroundWorkNames.periodic(user)).size == 3)
    }

    @Test fun accountWorkNamesRemainIsolated() {
        assertFalse(BackgroundWorkNames.backfill("user-a") == BackgroundWorkNames.backfill("user-b"))
        assertFalse(BackgroundWorkNames.periodic("user-a") == BackgroundWorkNames.periodic("user-b"))
    }

    @Test fun staleThresholdMatchesOverallWorkerDeadline() {
        assertEquals(8L, BackgroundWorkRecoveryPolicy.STALE_AFTER_MINUTES)
    }

    @Test fun localSyncingCannotOverrideActualEnqueuedState() {
        val now = Instant.parse("2026-09-03T12:00:00Z")
        val decision = BackgroundWorkRecoveryPolicy.decide("SYNCING", now.minusSeconds(60), WorkRuntimeSnapshot(DurableWorkState.ENQUEUED), now)
        assertEquals(BackgroundRuntimeStatus.ENQUEUED, decision.status)
    }

    @Test fun localSyncingCannotOverrideBlockedState() {
        val now = Instant.parse("2026-09-03T12:00:00Z")
        val decision = BackgroundWorkRecoveryPolicy.decide("SYNCING", now.minusSeconds(60), WorkRuntimeSnapshot(DurableWorkState.BLOCKED, hasRunnablePredecessor = true), now)
        assertEquals(BackgroundRuntimeStatus.WAITING_FOR_CONSTRAINT, decision.status)
    }

    @Test fun unknownWorkStateFailsClosedToRetry() {
        val decision = BackgroundWorkRecoveryPolicy.decide(null, null, WorkRuntimeSnapshot(DurableWorkState.UNKNOWN), Instant.now())
        assertEquals(BackgroundRuntimeStatus.RETRY_PENDING, decision.status)
        assertEquals(WorkRecoveryAction.ENQUEUE, decision.action)
    }

    @Test fun runningWithoutProgressIsRecovered() {
        val decision = BackgroundWorkRecoveryPolicy.decide("SYNCING", null, WorkRuntimeSnapshot(DurableWorkState.RUNNING), Instant.now())
        assertEquals(WorkRecoveryAction.REPLACE_STALE, decision.action)
    }

    @Test fun runningAtDeadlineBoundaryIsNotPrematurelyReplaced() {
        val now = Instant.parse("2026-09-03T12:00:00Z")
        val atBoundary = now.minusSeconds(BackgroundWorkRecoveryPolicy.STALE_AFTER_MINUTES * 60)
        val decision = BackgroundWorkRecoveryPolicy.decide("SYNCING", atBoundary, WorkRuntimeSnapshot(DurableWorkState.RUNNING), now)
        assertEquals(WorkRecoveryAction.KEEP, decision.action)
    }

    @Test fun runningPastDeadlineIsRecovered() {
        val now = Instant.parse("2026-09-03T12:00:01Z")
        val pastDeadline = now.minusSeconds(BackgroundWorkRecoveryPolicy.STALE_AFTER_MINUTES * 60 + 1)
        val decision = BackgroundWorkRecoveryPolicy.decide("SYNCING", pastDeadline, WorkRuntimeSnapshot(DurableWorkState.RUNNING), now)
        assertEquals(BackgroundRuntimeStatus.STALE_RECOVERED, decision.status)
    }

    @Test fun missingIdleWorkSchedulesWithoutClaimingRunning() {
        val decision = BackgroundWorkRecoveryPolicy.decide("SUCCESS", Instant.now(), null, Instant.now())
        assertEquals(BackgroundRuntimeStatus.ENQUEUED, decision.status)
        assertEquals(WorkRecoveryAction.ENQUEUE, decision.action)
    }

    @Test fun retryAttemptZeroRemainsQueued() {
        val decision = BackgroundWorkRecoveryPolicy.decide(null, null, WorkRuntimeSnapshot(DurableWorkState.ENQUEUED, 0), Instant.now())
        assertEquals(BackgroundRuntimeStatus.ENQUEUED, decision.status)
    }

    @Test fun retryAttemptTwoRemainsBoundedRetryPending() {
        val decision = BackgroundWorkRecoveryPolicy.decide(null, null, WorkRuntimeSnapshot(DurableWorkState.ENQUEUED, 2), Instant.now())
        assertEquals(BackgroundRuntimeStatus.RETRY_PENDING, decision.status)
    }

    @Test fun userScopedWorkNamesDoNotContainCanonicalUserId() {
        val user = "11111111-1111-4111-8111-111111111111"
        assertFalse(BackgroundWorkNames.immediate(user).contains(user))
        assertFalse(BackgroundWorkNames.backfill(user).contains(user))
    }

    @Test fun singleFlightDoesNotPersistAcrossCoordinatorInstances() {
        val oldProcess = SyncSingleFlight()
        assertTrue(oldProcess.tryStart())
        val newProcess = SyncSingleFlight()
        assertTrue(newProcess.tryStart())
    }

    @Test fun logoutEquivalentGateReleaseAllowsManualRetry() {
        val gate = SyncSingleFlight()
        assertTrue(gate.tryStart())
        gate.finish()
        assertTrue(gate.tryStart())
    }
}
