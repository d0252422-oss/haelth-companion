package app.healthcompanion.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

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
}
