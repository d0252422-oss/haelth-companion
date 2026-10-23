package app.healthcompanion.sync

import java.io.IOException
import java.net.SocketTimeoutException
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.currentCoroutineContext
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class RetryProgressTest {
    private val session = NativeAuthSession("11111111-1111-4111-8111-111111111111", "test-token")
    private fun records(count: Int) = (1..count).map { index ->
        CanonicalHealthRecord("steps", "fixture", "fixture-$index", "2026-10-20T00:00:00Z",
            "2026-10-20T00:00:00Z", "2026-10-20T00:00:00Z", "2026-10-20T00:01:00Z", "Asia/Taipei", "2026-10-20", index.toDouble(), "count")
    }
    private fun keys(body: String): List<String> {
        val mutations = JSONObject(body).getJSONArray("mutations")
        return List(mutations.length()) { mutations.getJSONObject(it).getString("idempotency_key") }
    }
    private fun duplicateReceipt(body: String): IngestionHttpResult {
        val response = JSONObject().put("accepted_idempotency_keys", JSONArray())
            .put("duplicate_idempotency_keys", JSONArray(keys(body))).put("rejected", JSONArray()).toString()
        return IngestionHttpResult(200, receipt = IngestionReceipt.parse(response))
    }
    private class Checkpoints : CheckpointRepository {
        var value: SyncCheckpoint? = null
        override fun load() = value
        override fun save(checkpoint: SyncCheckpoint) { value = checkpoint }
        override fun clear() { error("Upload must not clear durable progress before terminal completion") }
    }

    @Test fun allDuplicateBatchVerifiesEveryKeyAndSavesProgress() = runTest {
        var calls = 0
        val checkpoint = Checkpoints()
        val client = IngestionClient("https://beta.example", IngestionTransport { _, _, body -> calls++; duplicateReceipt(body) }, backoff = {})
        val result = client.upload(session, records(100), checkpoint)
        assertEquals(1, calls)
        assertEquals(100, checkpoint.value?.nextRecordIndex)
        assertEquals(1, checkpoint.value?.receiptContractVersion)
        assertEquals(mapOf("steps" to 100), result.persistedDomainCounts)
        assertFalse(result.reconciliationPending)
    }

    @Test fun duplicateBatchThenFailureResumesAtNextBatchAcrossClientRestart() = runTest {
        val checkpoint = Checkpoints()
        val input = records(101)
        val firstKeys = mutableSetOf<String>()
        var calls = 0
        val first = IngestionClient("https://beta.example", IngestionTransport { _, _, body ->
            calls++
            if (calls == 1) { firstKeys.addAll(keys(body)); duplicateReceipt(body) }
            else throw SocketTimeoutException("bounded fixture timeout")
        }, backoff = {})
        assertTrue(runCatching { first.upload(session, input, checkpoint) }.exceptionOrNull() is SocketTimeoutException)
        assertEquals(100, checkpoint.value?.nextRecordIndex)
        var resumed = 0
        val next = IngestionClient("https://beta.example", IngestionTransport { _, _, body ->
            resumed++
            assertEquals(1, keys(body).size)
            assertTrue(keys(body).none { it in firstKeys })
            duplicateReceipt(body)
        }, backoff = {})
        assertEquals(101, next.upload(session, input, checkpoint).recordsUploaded)
        assertEquals(1, resumed)
        assertEquals(101, checkpoint.value?.nextRecordIndex)
    }

    @Test fun lostResponseReplaysIdenticalKeysAndThenAcceptsDuplicateReceipt() = runTest {
        val persisted = mutableSetOf<String>()
        val sent = mutableListOf<List<String>>()
        val checkpoint = Checkpoints()
        val client = IngestionClient("https://beta.example", IngestionTransport { _, _, body ->
            sent += keys(body)
            persisted.addAll(keys(body))
            if (sent.size == 1) throw IOException("fixture response lost after commit")
            duplicateReceipt(body)
        }, backoff = {})
        client.upload(session, records(100), checkpoint)
        assertEquals(2, sent.size)
        assertEquals(sent[0], sent[1])
        assertEquals(100, persisted.size)
        assertEquals(100, checkpoint.value?.nextRecordIndex)
    }

    @Test fun missingWrongOwnerAndRejectedRevisionNeverAdvanceCheckpoint() = runTest {
        for (kind in listOf("missing", "wrong-owner", "revision-rejected")) {
            val checkpoint = Checkpoints()
            val client = IngestionClient("https://beta.example", IngestionTransport { _, _, body ->
                when (kind) {
                    "missing" -> IngestionHttpResult(200, receipt = IngestionReceipt.parse("{}"))
                    "wrong-owner" -> {
                        val otherKeys = records(1).map { CanonicalIdentity.idempotencyKey("22222222-2222-4222-8222-222222222222", it) }
                        assertNotEquals(keys(body), otherKeys)
                        IngestionHttpResult(200, receipt = IngestionReceipt(emptyList(), otherKeys, 0))
                    }
                    else -> IngestionHttpResult(207, receipt = IngestionReceipt(emptyList(), emptyList(), 1, mapOf("STALE_REVISION" to 1)))
                }
            }, backoff = {})
            assertNotNull(kind, runCatching { client.upload(session, records(1), checkpoint) }.exceptionOrNull())
            assertNull(kind, checkpoint.value)
        }
    }

    @Test fun cancellationSurfacingAsIoDoesNotRetryOrAdvanceCheckpoint() = runTest {
        val checkpoint = Checkpoints()
        var calls = 0
        val child = launch {
            val client = IngestionClient("https://beta.example", IngestionTransport { _, _, _ ->
                calls++; currentCoroutineContext().cancel(); throw IOException("isolated cancellation")
            }, backoff = {})
            client.upload(session, records(1), checkpoint)
        }
        child.join()
        assertTrue(child.isCancelled)
        assertEquals(1, calls)
        assertNull(checkpoint.value)
    }

    @Test fun checkpointCommitFailureHasDistinctStageAndRetainsSafeReplay() = runTest {
        val checkpoints = Checkpoints()
        var stage: String? = null
        val failing = object : CheckpointRepository {
            override fun load() = checkpoints.value
            override fun save(checkpoint: SyncCheckpoint) { throw CheckpointPersistenceFailed() }
            override fun clear() = error("must not clear")
        }
        val client = IngestionClient("https://beta.example", IngestionTransport { _, _, body -> duplicateReceipt(body) },
            backoff = {}, onStage = { stage = it })
        assertTrue(runCatching { client.upload(session, records(1), failing) }.exceptionOrNull() is CheckpointPersistenceFailed)
        assertEquals("CHECKPOINT_SAVE", stage)
        assertNull(checkpoints.value)
    }

    @Test fun failureAtFirstBatchAfter2400RetainsItsExactPlanAndResumeFrontier() = runTest {
        val input = records(2501)
        val checkpoint = Checkpoints()
        IngestionClient("https://beta.example", IngestionTransport { _, _, body -> duplicateReceipt(body) }, backoff = {})
            .upload(session, input, checkpoint, budget = UploadWorkBudget(maxBatches = 24))
        val before = checkpoint.value
        assertEquals(2400, before!!.nextRecordIndex)
        var stage: String? = null
        val attempted = mutableListOf<List<String>>()
        val failing = IngestionClient("https://beta.example", IngestionTransport { _, _, body ->
            attempted += keys(body); throw IOException("isolated transport failure")
        }, backoff = {}, onStage = { stage = it })
        assertTrue(runCatching { failing.upload(session, input, checkpoint) }.exceptionOrNull() is IOException)
        assertEquals(before, checkpoint.value)
        assertEquals("BATCH_POST", stage)
        val replayed = mutableListOf<List<String>>()
        IngestionClient("https://beta.example", IngestionTransport { _, _, body -> replayed += keys(body); duplicateReceipt(body) }, backoff = {})
            .upload(session, input, checkpoint)
        assertEquals(attempted.first(), replayed.first())
        assertEquals(2501, checkpoint.value!!.nextRecordIndex)
    }
}
