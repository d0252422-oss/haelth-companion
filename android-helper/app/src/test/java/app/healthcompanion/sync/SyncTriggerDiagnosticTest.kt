package app.healthcompanion.sync

import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncTriggerDiagnosticTest {
    private val session = NativeAuthSession("11111111-1111-4111-8111-111111111111", "test-token")

    @Test fun periodicWorkerProvenanceIsDistinctFromAppAndManualTriggers() {
        assertEquals(SyncTriggerSource.PERIODIC_WORKER, SyncTriggerSource.fromWorkInput("PERIODIC_WORKER"))
        assertEquals(SyncTriggerSource.APP_START, SyncTriggerSource.fromWorkInput("APP_START"))
        assertEquals(SyncTriggerSource.BOOT_RECOVERY, SyncTriggerSource.fromWorkInput("BOOT_RECOVERY"))
        assertEquals(SyncTriggerSource.UNKNOWN, SyncTriggerSource.fromWorkInput(null))
        assertEquals(SyncTriggerSource.UNKNOWN, SyncTriggerSource.fromWorkInput("RETRY"))
        val diagnostic = SyncTriggerDiagnostic(SyncTriggerSource.PERIODIC_WORKER,
            flowId = "11111111-1111-4111-8111-111111111112",
            workerId = "11111111-1111-4111-8111-111111111113",
            startedAt = "2026-09-29T07:13:00Z")
        assertEquals("PERIODIC_WORKER", diagnostic.request(1).getString("trigger_source"))
        assertEquals("RETRY", diagnostic.request(2).getString("trigger_source"))
        assertEquals("PERIODIC_WORKER", diagnostic.request(2).getString("origin_trigger_source"))
        assertEquals("RETRY", diagnostic.copy(workerAttempt = 1).request(1).getString("trigger_source"))
        assertEquals("MANUAL_SYNC", SyncTriggerDiagnostic(SyncTriggerSource.MANUAL_SYNC).request(1).getString("trigger_source"))
        val periodic = BackgroundSyncScheduler.triggerInput(BackgroundSyncMode.INCREMENTAL, "user-key", SyncTriggerSource.PERIODIC_WORKER)
        val appStart = BackgroundSyncScheduler.triggerInput(BackgroundSyncMode.INCREMENTAL, "user-key", SyncTriggerSource.APP_START)
        val backfill = BackgroundSyncScheduler.triggerInput(BackgroundSyncMode.BACKFILL, "user-key", SyncTriggerSource.BACKFILL)
        assertEquals("PERIODIC_WORKER", periodic.getString(BackgroundSyncScheduler.WORK_TRIGGER_SOURCE))
        assertEquals("APP_START", appStart.getString(BackgroundSyncScheduler.WORK_TRIGGER_SOURCE))
        assertEquals("BACKFILL", backfill.getString(BackgroundSyncScheduler.WORK_TRIGGER_SOURCE))
    }

    @Test fun retryChangesOnlyRequestDiagnosticsNotMutationIdentityOrCheckpoint() = runTest {
        val bodies = mutableListOf<JSONObject>()
        val checkpoints = object : CheckpointRepository {
            var saved: SyncCheckpoint? = null
            override fun load() = saved
            override fun save(checkpoint: SyncCheckpoint) { saved = checkpoint }
            override fun clear() { saved = null }
        }
        val client = IngestionClient("https://beta.example", IngestionTransport { _, _, body ->
            bodies += JSONObject(body)
            successfulReceipt(body, if (bodies.size == 1) 500 else 200)
        }, backoff = {})
        val record = CanonicalHealthRecord(
            domain = "steps", sourceApp = "fixture", sourceRecordId = "record-1",
            sourceUpdatedAt = "2026-09-29T07:13:00Z", recordedAt = "2026-09-29T07:13:00Z",
            startedAt = null, endedAt = null, timezone = "Asia/Taipei", localDate = "2026-09-29",
            value = 100.0, unit = "count", stage = null,
        )
        val diagnostic = SyncTriggerDiagnostic(SyncTriggerSource.PERIODIC_WORKER,
            flowId = "11111111-1111-4111-8111-111111111112",
            workerId = "11111111-1111-4111-8111-111111111113",
            startedAt = "2026-09-29T07:13:00Z")

        client.upload(session, listOf(record), checkpoints, diagnostic)

        assertEquals(2, bodies.size)
        assertEquals("PERIODIC_WORKER", bodies[0].getJSONObject("sync_diagnostic").getString("trigger_source"))
        assertEquals("RETRY", bodies[1].getJSONObject("sync_diagnostic").getString("trigger_source"))
        assertEquals(bodies[0].getJSONArray("mutations").toString(), bodies[1].getJSONArray("mutations").toString())
        assertEquals(1, checkpoints.saved?.nextRecordIndex)
        assertFalse(bodies[1].has("email"))
        assertFalse(bodies[1].getJSONObject("sync_diagnostic").has("canonical_user_id"))
        assertTrue(bodies[1].getJSONObject("sync_diagnostic").getInt("attempt") == 2)
        assertNull(bodies[1].optString("line_user_id").takeIf { it.isNotEmpty() })
    }
}
