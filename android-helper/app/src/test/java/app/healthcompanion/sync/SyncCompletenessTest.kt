package app.healthcompanion.sync

import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class SyncCompletenessTest {
    private val allDomains = listOf("steps", "heart_rate", "resting_heart_rate", "sleep", "sleep_stage", "weight", "workout", "hrv", "spo2", "total_energy")
    private val session = NativeAuthSession("11111111-1111-4111-8111-111111111111", "test-token")
    private val record = CanonicalHealthRecord("steps", "fixture", "r1", "2026-10-07T00:00:00Z",
        "2026-10-07T00:00:00Z", "2026-10-06T23:00:00Z", "2026-10-07T00:00:00Z", "Asia/Taipei", "2026-10-07", 10.0, "count")
    private class Checkpoints(var value: SyncCheckpoint? = null) : CheckpointRepository {
        override fun load() = value
        override fun save(checkpoint: SyncCheckpoint) { value = checkpoint }
        override fun clear() { value = null }
    }

    @Test fun everySupportedDomainBlocksSilentMissingPersistence() {
        allDomains.forEach { domain ->
            assertEquals(setOf(domain), SyncCompletenessPolicy.incompleteDomains(mapOf(domain to DomainReadTrace(1, 1, 1, "COMPLETE")), emptyMap()))
        }
    }
    @Test fun everySupportedDomainBlocksSilentMapperDrop() {
        allDomains.forEach { domain ->
            assertEquals(setOf(domain), SyncCompletenessPolicy.incompleteDomains(mapOf(domain to DomainReadTrace(1, 0, 1, "COMPLETE")), emptyMap()))
        }
    }
    @Test fun oneToManyModelsCompareMappedRecordsNotParentSourceCount() {
        val read = mapOf("heart_rate" to DomainReadTrace(2, 800, 1, "COMPLETE"), "sleep_stage" to DomainReadTrace(20, 20, 1, "COMPLETE"))
        assertEquals(setOf("heart_rate"), SyncCompletenessPolicy.incompleteDomains(read, mapOf("heart_rate" to 2, "sleep_stage" to 20)))
        assertTrue(SyncCompletenessPolicy.incompleteDomains(read, mapOf("heart_rate" to 800, "sleep_stage" to 20)).isEmpty())
    }
    @Test fun successfulEmptyReadIsNoSourceDataNotFailure() {
        assertTrue(SyncCompletenessPolicy.incompleteDomains(mapOf("weight" to DomainReadTrace(0, 0, 1, "COMPLETE")), emptyMap()).isEmpty())
    }
    @Test fun failedReadRetainsUnknownInsteadOfZero() {
        val read = mapOf("sleep" to DomainReadTrace(null, 0, 0, "READER_TIMEOUT", recoveryAttempts = 2))
        val json = SyncCompletenessPolicy.contract("run", session.canonicalUserId, "start", "end", read, emptyMap(), read.keys)
        assertEquals("INCOMPLETE", json.getString("status"))
        assertTrue(json.getJSONObject("per_domain").getJSONObject("sleep").isNull("source_count"))
        assertTrue(json.getJSONObject("per_domain").getJSONObject("sleep").isNull("persisted_count"))
        assertEquals("DATA_INTEGRITY_WARNING:sleep", json.getJSONArray("warnings").getString(0))
    }
    @Test fun requestedDomainWithoutReadCannotPass() {
        assertEquals("INCOMPLETE", SyncCompletenessPolicy.contract("run", "user", "start", "end", emptyMap(), emptyMap(), setOf("hrv")).getString("status"))
    }
    @Test fun cappedOrDroppedReadCannotPassEvenWithMatchingCounts() {
        for (trace in listOf(DomainReadTrace(2, 2, 50, "CAPPED"), DomainReadTrace(2, 2, 1, "COMPLETE", mapOf("MAPPER_ERROR" to 1)))) {
            assertEquals(setOf("steps"), SyncCompletenessPolicy.incompleteDomains(mapOf("steps" to trace), mapOf("steps" to 2)))
        }
    }
    @Test fun receiptRequiresExactKeysAndMultiplicity() {
        val a = "a".repeat(64); val b = "b".repeat(64)
        assertTrue(IngestionReceipt(listOf(a), listOf(b), 0).verifies(listOf(a,b)))
        assertFalse(IngestionReceipt(listOf(a), listOf(a), 0).verifies(listOf(a,b)))
        assertFalse(IngestionReceipt(listOf(a,b), emptyList(), 1).verifies(listOf(a,b)))
        assertFalse(IngestionReceipt(listOf(a), emptyList(), 0).verifies(listOf(a,b)))
        assertFalse(IngestionReceipt(listOf(a,b), emptyList(), 0).verifies(listOf(a)))
    }
    @Test fun malformedOrMissingReceiptFailsClosed() {
        listOf("{}", "not json", "{\"accepted_idempotency_keys\":[]}", "{\"accepted_idempotency_keys\":[5],\"duplicate_idempotency_keys\":[],\"rejected\":[]}")
            .forEach { assertNull(IngestionReceipt.parse(it)) }
    }
    @Test fun parseValidDuplicateReceipt() {
        val key = "a".repeat(64)
        val parsed = IngestionReceipt.parse("{\"accepted_idempotency_keys\":[],\"duplicate_idempotency_keys\":[\"$key\"],\"rejected\":[]}")
        assertTrue(requireNotNull(parsed).verifies(listOf(key)))
    }
    @Test fun http200WithoutSqlReceiptRetriesTwiceAndNeverAdvances() = runTest {
        var calls = 0; val checkpoint = Checkpoints()
        val client = IngestionClient("https://beta.example", IngestionTransport { _,_,_ -> calls++; IngestionHttpResult(200) }, backoff = {})
        val error = runCatching { client.upload(session, listOf(record), checkpoint) }.exceptionOrNull()
        assertTrue(error is IncompleteIngestionReceipt)
        assertEquals(3, calls)
        assertNull(checkpoint.value)
        assertFalse(RetryPolicy.shouldRetryWorker(requireNotNull(error), 0, 24))
    }
    @Test fun validReceiptAfterBoundedRetryCompletesWithoutDuplicateCheckpoint() = runTest {
        var calls = 0; val checkpoint = Checkpoints()
        val client = IngestionClient("https://beta.example", IngestionTransport { _,_,body ->
            calls++; if(calls < 3) IngestionHttpResult(200) else successfulReceipt(body)
        }, backoff = {})
        val result = client.upload(session, listOf(record), checkpoint)
        assertEquals(3, calls)
        assertEquals(mapOf("steps" to 1), result.persistedDomainCounts)
        assertEquals(1, checkpoint.value?.receiptContractVersion)
    }
    @Test fun oldHttpOnlyCheckpointReplaysFromStart() = runTest {
        val input = listOf(record)
        val plan = BatchPlanner.streamingPlan(session.canonicalUserId, input, null)
        val checkpoint = Checkpoints(SyncCheckpoint(plan.fingerprint, 1, 1))
        var calls = 0
        val client = IngestionClient("https://beta.example", IngestionTransport { _,_,body -> calls++; successfulReceipt(body) }, backoff = {})
        client.upload(session, input, checkpoint)
        assertEquals(1, calls)
        assertEquals(1, checkpoint.value?.receiptContractVersion)
    }
    @Test fun verifiedCheckpointDoesNotRepeatAlreadyCommittedBatch() = runTest {
        val input = listOf(record)
        val plan = BatchPlanner.streamingPlan(session.canonicalUserId, input, null)
        val checkpoint = Checkpoints(SyncCheckpoint(plan.fingerprint, 1, 1, receiptContractVersion = 1))
        val client = IngestionClient("https://beta.example", IngestionTransport { _,_,_ -> error("Unexpected replay") })
        assertEquals(mapOf("steps" to 1), client.upload(session, input, checkpoint).persistedDomainCounts)
    }
    @Test fun domainQueueWaitDoesNotConsumeReadDeadline() = runTest {
        val semaphore = Semaphore(1)
        val first = async { DomainReadBudget.read(semaphore, 100) { delay(80); "steps" } }
        val second = async { DomainReadBudget.read(semaphore, 100) { delay(80); "sleep" } }
        assertEquals("steps", first.await())
        assertEquals("sleep", second.await())
    }
    @Test fun realReadStillTimesOutAndReleasesSlot() = runTest {
        val semaphore = Semaphore(1)
        val error = runCatching { DomainReadBudget.read(semaphore, 100) { delay(101) } }.exceptionOrNull()
        assertTrue(error is kotlinx.coroutines.TimeoutCancellationException)
        assertEquals("ok", DomainReadBudget.read(semaphore, 100) { "ok" })
    }
    @Test fun exhaustedDomainRecoveryDoesNotRestartWholeWorkerLoop() {
        assertFalse(RetryPolicy.shouldRetryWorker(DomainCompletenessExhausted(), 0, 24))
    }
    @Test fun whitespacePageTokenTerminatesWithoutDuplicateRead() {
        assertNull(PaginationGuard.nextPageToken("  "))
    }
}
