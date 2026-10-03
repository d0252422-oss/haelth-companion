package app.healthcompanion.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.time.Instant

class SyncPerformancePolicyTest {
    @Test fun foregroundWaitIsBoundedOnlyWhenBackgroundCanFinishAllDomains() {
        assertEquals(25_000L, ForegroundSyncBudget.deadlineMs(backgroundReadGranted = true))
        assertEquals(120_000L, ForegroundSyncBudget.deadlineMs(backgroundReadGranted = false))
    }

    @Test fun missingSystemJobRepairsOnlyItsUniquePeriodicWork() {
        val now = 1_000_000L
        assertTrue(PeriodicSchedulerRecoveryPolicy.shouldReplace(DurableWorkState.ENQUEUED, false, 0, now))
        assertFalse(PeriodicSchedulerRecoveryPolicy.shouldReplace(DurableWorkState.ENQUEUED, true, 0, now))
        assertFalse(PeriodicSchedulerRecoveryPolicy.shouldReplace(DurableWorkState.ENQUEUED, null, 0, now))
        assertFalse(PeriodicSchedulerRecoveryPolicy.shouldReplace(DurableWorkState.RUNNING, false, 0, now))
        assertFalse(PeriodicSchedulerRecoveryPolicy.shouldReplace(DurableWorkState.ENQUEUED, false, now - 60_000, now))
        assertTrue(PeriodicSchedulerRecoveryPolicy.shouldReplace(DurableWorkState.ENQUEUED, false, now - 900_001, now))
    }

    @Test fun twoHourCadenceUpdatesAnExistingTwelveHourPeriodicWorkOnlyOnce() {
        assertEquals(2L, PeriodicSyncCadencePolicy.INTERVAL_HOURS)
        assertEquals(7_200_000L, PeriodicSyncCadencePolicy.intervalMs)
        assertTrue(PeriodicSyncCadencePolicy.needsUpdate(43_200_000L))
        assertTrue(PeriodicSyncCadencePolicy.needsUpdate(null))
        assertFalse(PeriodicSyncCadencePolicy.needsUpdate(7_200_000L))
    }

    @Test fun failedImmediateDoesNotBlockPeriodicRepair() {
        // The unique immediate and periodic names are independent, and the
        // periodic decision consumes only its own state and OS-job evidence.
        val user = "periodic-recovery-user"
        assertFalse(BackgroundWorkNames.immediate(user) == BackgroundWorkNames.periodic(user))
        assertTrue(PeriodicSchedulerRecoveryPolicy.shouldReplace(DurableWorkState.CANCELLED, null, 0, 1_000_000))
        assertTrue(PeriodicSchedulerRecoveryPolicy.shouldReplace(null, null, 0, 1_000_000))
    }
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

    @Test fun partialReadOrPendingReconciliationCannotAdvanceDurableSuccess() {
        assertTrue(SyncTerminalPolicy.isDurablyComplete(readPartial = false, reconciliationPending = false))
        assertFalse(SyncTerminalPolicy.isDurablyComplete(readPartial = true, reconciliationPending = false))
        assertFalse(SyncTerminalPolicy.isDurablyComplete(readPartial = false, reconciliationPending = true))
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

    @Test fun lateArrivingSleepAndOtherDomainsGetSevenDayReadWithoutRepeatingOldUploads() {
        val end = Instant.parse("2026-10-03T00:00:00Z")
        val last = Instant.parse("2026-10-02T22:00:00Z")
        val window = SyncWindowPolicy.incremental(end, last)
        for (domain in listOf("sleep", "steps", "total_energy", "spo2", "workout", "weight", "hrv")) {
            assertEquals(Instant.parse("2026-09-26T00:00:00Z"), LateArrivalReplayPolicy.readStart(window, domain))
        }
        assertEquals(Instant.parse("2026-10-02T00:00:00Z"), LateArrivalReplayPolicy.readStart(window, "heart_rate"))

        fun record(domain: String, endedAt: String, modifiedAt: String) = CanonicalHealthRecord(
            domain = domain, sourceApp = "test.origin", sourceRecordId = "$domain-$endedAt",
            sourceUpdatedAt = modifiedAt, recordedAt = endedAt,
            startedAt = endedAt, endedAt = endedAt,
            timezone = "Asia/Taipei", localDate = "2026-09-30", value = 1.0, unit = "count",
        )
        val oldEnd = "2026-09-30T00:00:00Z"
        assertTrue(LateArrivalReplayPolicy.shouldUpload(record("sleep", oldEnd, "2026-10-02T23:00:00Z"), last, window))
        assertTrue(LateArrivalReplayPolicy.shouldUpload(record("spo2", oldEnd, "2026-10-02T21:00:00Z"), last, window))
        assertFalse(LateArrivalReplayPolicy.shouldUpload(record("sleep", oldEnd, "2026-10-01T00:00:00Z"), last, window))
        assertTrue(LateArrivalReplayPolicy.shouldUpload(record("steps", "2026-10-02T22:30:00Z", "2026-10-01T00:00:00Z"), last, window))
        assertTrue(LateArrivalReplayPolicy.shouldUpload(record("sleep", oldEnd, "invalid"), last, window))
    }

    @Test fun longOfflineGapIsNeverClippedByLateArrivalLookback() {
        val window = SyncWindowPolicy.incremental(
            Instant.parse("2026-10-03T00:00:00Z"), Instant.parse("2026-09-20T00:00:00Z"),
        )
        assertEquals(window.start, LateArrivalReplayPolicy.readStart(window, "sleep"))
        assertEquals(window.start, LateArrivalReplayPolicy.readStart(window, "heart_rate"))
    }

    @Test fun delayedRetryAdvancesOnlyThroughFrozenWindowEnd() {
        val start = Instant.parse("2026-09-26T11:10:00Z")
        val frozenEnd = Instant.parse("2026-09-27T17:53:08Z")
        val finishedAt = Instant.parse("2026-09-28T15:35:00Z")
        val completed = SyncWindowPolicy.completedCursor(SyncWindow(start, frozenEnd))
        assertEquals(frozenEnd, completed)
        assertEquals(frozenEnd.minusSeconds(3600), SyncWindowPolicy.incremental(finishedAt, completed).start)
        assertEquals(finishedAt, SyncWindowPolicy.incremental(finishedAt, completed).end)
    }

    @Test fun p0RecoveryCoversBothMissingTaipeiDatesWithFrozenEnd() {
        val frozenEnd = Instant.parse("2026-09-28T15:45:00Z")
        val window = SyncWindowPolicy.p0Recovery(frozenEnd)
        assertEquals(Instant.parse("2026-09-25T15:45:00Z"), window.start)
        assertEquals(frozenEnd, window.end)
        assertTrue(window.start.isBefore(Instant.parse("2026-09-26T16:00:00Z")))
        assertTrue(window.end.isAfter(Instant.parse("2026-09-28T00:00:00Z")))
    }

    @Test fun p0RecoveryHasItsOwnUserScopedWorkAndCheckpoint() {
        val user = "p0-recovery-user"
        val names = setOf(
            BackgroundWorkNames.immediate(user), BackgroundWorkNames.backfill(user),
            BackgroundWorkNames.periodic(user), BackgroundWorkNames.p0Recovery(user),
        )
        assertEquals(4, names.size)
        assertTrue(BackgroundWorkNames.p0Recovery(user).startsWith("health-sync-p0-recovery-v23-"))
        assertFalse(BackgroundWorkNames.p0Recovery(user).contains(user))
        assertFalse(
            SyncStateNamespace.modeKey(user, BackgroundSyncMode.P0_RECOVERY, "next_record_index") ==
                SyncStateNamespace.modeKey(user, BackgroundSyncMode.INCREMENTAL, "next_record_index"),
        )
        assertEquals(
            BackgroundContinuationPolicy.BACKFILL_RECONCILIATION_MAX_ATTEMPTS,
            BackgroundContinuationPolicy.maxAttempts(BackgroundSyncMode.P0_RECOVERY, true, 1),
        )
    }

    @Test fun p0ReplayReadsOnlyMissingDomainsWhileNormalSyncStillReadsAll() {
        val recovery = HealthReadDomainPolicy.forMode(BackgroundSyncMode.P0_RECOVERY)
        assertEquals(setOf("steps", "total_energy"), recovery)
        assertTrue(HealthReadDomainPolicy.includes(recovery, "steps"))
        assertTrue(HealthReadDomainPolicy.includes(recovery, "total_energy"))
        assertFalse(HealthReadDomainPolicy.includes(recovery, "heart_rate"))
        assertFalse(HealthReadDomainPolicy.includes(recovery, "active_calories"))
        assertEquals(null, HealthReadDomainPolicy.forMode(BackgroundSyncMode.INCREMENTAL))
        assertEquals(null, HealthReadDomainPolicy.forMode(BackgroundSyncMode.BACKFILL))
        assertTrue(HealthReadDomainPolicy.includes(null, "heart_rate"))
    }

    @Test fun backfillUsesBoundedThirtyDayWindow() {
        val now = Instant.parse("2026-09-03T00:00:00Z")
        assertEquals(Instant.parse("2026-08-04T00:00:00Z"), SyncWindowPolicy.backfill(now).start)
    }

    @Test fun backfillWithDurableUploadCheckpointGetsBoundedContinuationAttempts() {
        assertEquals(
            BackgroundContinuationPolicy.BACKFILL_MAX_CONTINUATION_ATTEMPTS,
            BackgroundContinuationPolicy.maxAttempts(
                BackgroundSyncMode.BACKFILL,
                uploadStarted = true,
                checkpointIndex = 130,
            ),
        )
        assertTrue(
            BackgroundContinuationPolicy.shouldRetry(
                runAttemptCount = 2,
                maxAttempts = BackgroundContinuationPolicy.BACKFILL_MAX_CONTINUATION_ATTEMPTS,
            ),
        )
    }

    @Test fun incrementalAndUnstartedBackfillKeepDefaultRetryBound() {
        assertEquals(
            BackgroundContinuationPolicy.DEFAULT_MAX_ATTEMPTS,
            BackgroundContinuationPolicy.maxAttempts(
                BackgroundSyncMode.INCREMENTAL,
                uploadStarted = true,
                checkpointIndex = 130,
            ),
        )
        assertEquals(
            BackgroundContinuationPolicy.BACKFILL_MAX_CONTINUATION_ATTEMPTS,
            BackgroundContinuationPolicy.maxAttempts(
                BackgroundSyncMode.BACKFILL,
                uploadStarted = false,
                checkpointIndex = 130,
            ),
        )
        assertFalse(
            BackgroundContinuationPolicy.shouldRetry(
                runAttemptCount = 2,
                maxAttempts = BackgroundContinuationPolicy.DEFAULT_MAX_ATTEMPTS,
            ),
        )
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

    @Test fun checkpointAndWindowKeysAreIsolatedByUserAndSyncMode() {
        val backfillCheckpoint = SyncStateNamespace.modeKey("user-a", BackgroundSyncMode.BACKFILL, "plan_fingerprint")
        val incrementalCheckpoint = SyncStateNamespace.modeKey("user-a", BackgroundSyncMode.INCREMENTAL, "plan_fingerprint")
        val anotherUser = SyncStateNamespace.modeKey("user-b", BackgroundSyncMode.BACKFILL, "plan_fingerprint")
        val backfillWindow = SyncStateNamespace.modeKey("user-a", BackgroundSyncMode.BACKFILL, "active_window_end")

        assertEquals(4, setOf(backfillCheckpoint, incrementalCheckpoint, anotherUser, backfillWindow).size)
        assertFalse(backfillCheckpoint.contains("user-a"))
    }

    @Test fun continuedBackfillIOExceptionUsesExtendedAttemptBound() {
        val maxAttempts = BackgroundContinuationPolicy.maxAttempts(
            BackgroundSyncMode.BACKFILL,
            uploadStarted = true,
            checkpointIndex = 171,
        )
        assertTrue(RetryPolicy.shouldRetryWorker(IOException("network"), 9, maxAttempts))
        assertTrue(RetryPolicy.shouldRetryWorker(IOException("network"), 10, maxAttempts))
        assertFalse(RetryPolicy.shouldRetryWorker(IOException("network"), 11, maxAttempts))
        assertFalse(
            RetryPolicy.shouldRetryWorker(
                IOException("network"),
                2,
                BackgroundContinuationPolicy.DEFAULT_MAX_ATTEMPTS,
            ),
        )
        assertEquals(
            BackgroundContinuationPolicy.BACKFILL_RECONCILIATION_MAX_ATTEMPTS,
            BackgroundContinuationPolicy.maxAttempts(
                BackgroundSyncMode.BACKFILL,
                uploadStarted = true,
                checkpointIndex = 0,
                reconciliationPass = 1,
            ),
        )
        assertTrue(
            RetryPolicy.shouldRetryWorker(
                IOException("catch-up"),
                11,
                BackgroundContinuationPolicy.maxAttempts(
                    BackgroundSyncMode.BACKFILL,
                    uploadStarted = false,
                    checkpointIndex = 0,
                    reconciliationPass = 1,
                ),
            ),
        )
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

    @Test fun observerDoesNotReportFailedTerminalWorkAsUpToDate() {
        for (result in listOf("FAILED", "FAILED_AUTH", "TIMEOUT", "PERMISSION_REQUIRED")) {
            assertEquals(BackgroundRuntimeStatus.FAILED, BackgroundWorkRecoveryPolicy.statusWithoutActiveWork(result))
        }
        assertEquals(BackgroundRuntimeStatus.RETRY_PENDING, BackgroundWorkRecoveryPolicy.statusWithoutActiveWork("PARTIAL"))
        assertEquals(BackgroundRuntimeStatus.RETRY_PENDING, BackgroundWorkRecoveryPolicy.statusWithoutActiveWork("RETRY_PENDING"))
        assertEquals(BackgroundRuntimeStatus.UP_TO_DATE, BackgroundWorkRecoveryPolicy.statusWithoutActiveWork("SUCCESS"))
        assertEquals(BackgroundRuntimeStatus.ENQUEUED, BackgroundWorkRecoveryPolicy.statusWithoutActiveWork(null))
    }

    @Test fun persistedFailureWinsOverHistoricalSuccessfulWork() {
        assertEquals(
            BackgroundRuntimeStatus.FAILED,
            BackgroundWorkRecoveryPolicy.statusWithoutActiveWork("FAILED", DurableWorkState.SUCCEEDED),
        )
    }

    @Test fun currentTerminalFailureWithoutSessionMetadataRemainsRetryable() {
        assertEquals(
            BackgroundRuntimeStatus.RETRY_PENDING,
            BackgroundWorkRecoveryPolicy.statusWithoutActiveWork("ENQUEUED", DurableWorkState.FAILED),
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
