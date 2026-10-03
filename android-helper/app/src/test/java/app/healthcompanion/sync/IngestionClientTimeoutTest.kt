package app.healthcompanion.sync

import java.io.IOException
import java.net.SocketTimeoutException
import java.net.ServerSocket
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.concurrent.thread
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.TimeSource

class IngestionClientTimeoutTest {
    private val session = NativeAuthSession("11111111-1111-4111-8111-111111111111", "test-token")

    @Test fun failedBatchKeepsCheckpointAndRetriesIdenticalPayloadAfterRecovery() = runTest {
        for (failure in listOf(401, 429, 500, 503)) {
            val checkpoints = MemoryCheckpoints()
            val bodies = mutableListOf<String>()
            var unavailable = true
            val client = IngestionClient("https://beta.example", IngestionTransport { _, _, body ->
                bodies += body
                IngestionHttpResult(if (unavailable) failure else 200)
            }, backoff = {})
            val input = records(1)
            val rejected = runCatching { client.upload(session, input, checkpoints) }.exceptionOrNull()
            assertTrue("status=$failure", rejected is AuthenticationRequired || rejected is BatchUploadFailed)
            assertNull("status=$failure", checkpoints.value)
            unavailable = false
            client.upload(session, input, checkpoints)
            assertEquals("status=$failure", bodies.first(), bodies.last())
            assertEquals("status=$failure", 1, checkpoints.value?.nextRecordIndex)
        }
    }

    @Test fun networkFailureKeepsCheckpointUntilRetrySucceeds() = runTest {
        val checkpoints = MemoryCheckpoints()
        val bodies = mutableListOf<String>()
        var unavailable = true
        val client = IngestionClient("https://beta.example", IngestionTransport { _, _, body ->
            bodies += body
            if (unavailable) throw IOException("network unavailable")
            IngestionHttpResult(200)
        }, backoff = {})
        assertTrue(runCatching { client.upload(session, records(1), checkpoints) }.exceptionOrNull() is IOException)
        assertNull(checkpoints.value)
        unavailable = false
        client.upload(session, records(1), checkpoints)
        assertEquals(bodies.first(), bodies.last())
        assertEquals(1, checkpoints.value?.nextRecordIndex)
    }

    @Test fun timeoutRetriesAndPreservesLastCompletedBatchCheckpoint() = runTest {
        val checkpoints = MemoryCheckpoints()
        var calls = 0
        val transport = IngestionTransport { _, _, _ ->
            calls += 1
            if (calls == 1) IngestionHttpResult(201) else throw SocketTimeoutException("bounded timeout")
        }
        val client = IngestionClient("https://beta.example", transport) {}

        runCatching { client.upload(session, records(101), checkpoints) }

        assertEquals(4, calls)
        assertNotNull(checkpoints.value)
        assertEquals(1, checkpoints.value?.nextBatchIndex)
        assertEquals(100, checkpoints.value?.nextRecordIndex)
        assertFalse(checkpoints.cleared)
    }

    @Test fun interruptedMixedDomainUploadResumesWithSleepParentBeforeStages() = runTest {
        val preceding = records(99).map { it.copy(recordedAt = "2026-10-03T00:00:00Z") }
        val parent = preceding.first().copy(
            domain = "sleep", sourceRecordId = "session-1", recordedAt = "2026-10-03T01:00:00Z",
            startedAt = "2026-10-02T23:00:00Z", endedAt = "2026-10-03T01:00:00Z",
            value = 120.0, unit = "minute",
        )
        val stage = parent.copy(
            domain = "sleep_stage", sourceRecordId = "session-1:stage-1",
            recordedAt = "2026-10-03T00:20:00Z", endedAt = "2026-10-03T00:20:00Z",
            value = 80.0, stage = "4", uploadSortAt = parent.recordedAt,
        )
        val trailingDomains = listOf(
            "steps", "total_energy", "spo2", "heart_rate",
            "resting_heart_rate", "hrv", "weight", "workout",
        )
        val trailing = trailingDomains.mapIndexed { index, domain ->
            parent.copy(domain = domain, sourceRecordId = "trailing-$domain",
                recordedAt = "2026-10-03T02:00:0${index}Z", value = 1.0, unit = "count")
        }
        val input = preceding + stage + trailing + parent
        val checkpoints = MemoryCheckpoints()
        val acceptedIds = mutableListOf<String>()
        var calls = 0
        val transport = IngestionTransport { _, _, body ->
            calls++
            val result = if (calls == 1 || calls >= 5) 201 else 503
            if (result == 201) {
                val mutations = org.json.JSONObject(body).getJSONArray("mutations")
                repeat(mutations.length()) { index ->
                    acceptedIds += mutations.getJSONObject(index).getString("source_record_id")
                }
            }
            IngestionHttpResult(result)
        }
        val client = IngestionClient("https://beta.example", transport, backoff = {})

        val interrupted = runCatching { client.upload(session, input, checkpoints) }.exceptionOrNull()
        assertTrue(interrupted is BatchUploadFailed)
        assertEquals(100, checkpoints.value?.nextRecordIndex)
        assertEquals("session-1", acceptedIds.last())

        val completed = client.upload(session, input.reversed(), checkpoints)
        assertEquals(input.size, completed.recordsUploaded)
        assertEquals(input.size, acceptedIds.size)
        assertEquals(input.size, acceptedIds.toSet().size)
        assertTrue(acceptedIds.indexOf("session-1") < acceptedIds.indexOf("session-1:stage-1"))
        assertTrue(trailingDomains.all { domain -> "trailing-$domain" in acceptedIds })
    }

    @Test fun successfulUploadRetainsCompletedCheckpointUntilStatusIsDurable() = runTest {
        val checkpoints = MemoryCheckpoints()
        val seenBodies = mutableListOf<String>()
        val transport = IngestionTransport { _, _, body -> seenBodies += body; IngestionHttpResult(201) }
        val client = IngestionClient("https://beta.example", transport) {}

        val result = client.upload(session, records(101), checkpoints)

        assertEquals(2, result.batchesCompleted)
        assertEquals(101, result.recordsUploaded)
        assertEquals(2, seenBodies.size)
        assertEquals(101, checkpoints.value?.nextRecordIndex)
        assertFalse(checkpoints.cleared)
        assertEquals(
            CanonicalIdentity.idempotencyKey(session.canonicalUserId, records(101).first()),
            CanonicalIdentity.idempotencyKey(session.canonicalUserId, records(101).first()),
        )
    }

    @Test fun connectorStatusFailureRetainsCompletedCursorAndAvoidsBatchReplay() = runTest {
        val checkpoints = MemoryCheckpoints()
        var ingestionCalls = 0
        val transport = IngestionTransport { path, _, _ ->
            if (path.endsWith("/connectors/status")) IngestionHttpResult(503)
            else IngestionHttpResult(201).also { ingestionCalls += 1 }
        }
        val client = IngestionClient("https://beta.example", transport) {}
        val input = records(101)

        client.upload(session, input, checkpoints)
        val statusFailure = runCatching {
            client.reportStatus(session, input, "SYNCED", "GRANTED")
        }.exceptionOrNull()
        client.upload(session, input, checkpoints)

        assertTrue(statusFailure is BatchUploadFailed && statusFailure.statusCode == 503)
        assertEquals(2, ingestionCalls)
        assertEquals(101, checkpoints.value?.nextRecordIndex)
        assertFalse(checkpoints.cleared)
    }

    @Test fun cancellationDoesNotAdvanceOrClearPastLastDurableBatch() = runTest {
        val checkpoints = MemoryCheckpoints()
        var calls = 0
        val client = IngestionClient(
            "https://beta.example",
            IngestionTransport { _, _, _ ->
                calls += 1
                if (calls == 1) IngestionHttpResult(201) else throw kotlinx.coroutines.CancellationException("cancelled")
            },
            backoff = {},
        )

        val failure = runCatching { client.upload(session, records(101), checkpoints) }.exceptionOrNull()

        assertTrue(failure is kotlinx.coroutines.CancellationException)
        assertEquals(100, checkpoints.value?.nextRecordIndex)
        assertFalse(checkpoints.cleared)
    }

    @Test fun realBackfillScaleStreamingContinuationResumesExactlyOnce() = runTest {
        val input = records(42_235)
        val initial = BatchPlanner.streamingPlan(session.canonicalUserId, input, null)
        val checkpoints = MemoryCheckpoints(SyncCheckpoint(initial.fingerprint, 171, 17_100))
        val expectedIds = initial.orderedRecords.drop(17_100).map { it.sourceRecordId }
        val uploadedIds = linkedSetOf<String>()
        var ingestionCalls = 0
        val client = IngestionClient(
            "https://beta.example",
            IngestionTransport { _, _, body ->
                ingestionCalls += 1
                val mutations = org.json.JSONObject(body).getJSONArray("mutations")
                repeat(mutations.length()) { index ->
                    assertTrue(uploadedIds.add(mutations.getJSONObject(index).getString("source_record_id")))
                }
                IngestionHttpResult(201)
            },
            backoff = {},
        )

        val result = client.upload(session, input.reversed(), checkpoints)

        assertEquals(252, ingestionCalls)
        assertEquals(25_135, uploadedIds.size)
        assertEquals(expectedIds, uploadedIds.toList())
        assertEquals(42_235, result.recordsUploaded)
        assertEquals(42_235, checkpoints.value?.nextRecordIndex)
        assertFalse(checkpoints.cleared)
    }

    @Test fun datasetDriftContinuesFromFrontierThenRunsBoundedCatchUpPass() = runTest {
        val original = records(250)
        val initial = BatchPlanner.streamingPlan(session.canonicalUserId, original, null)
        val checkpoints = MemoryCheckpoints(SyncCheckpoint(
            planFingerprint = initial.fingerprint,
            nextBatchIndex = 1,
            nextRecordIndex = 100,
            lastRecordKey = BatchPlanner.encodedRecordKey(initial.orderedRecords[99]),
        ))
        val changed = original.toMutableList().also {
            it += records(1).single().copy(
                sourceRecordId = "inserted-before-frontier",
                recordedAt = "2026-08-31T23:59:59Z",
            )
            it[200] = it[200].copy(value = 9_999.0)
        }
        var ingestionCalls = 0
        val client = IngestionClient(
            "https://beta.example",
            IngestionTransport { _, _, _ -> IngestionHttpResult(201).also { ingestionCalls += 1 } },
            backoff = {},
        )

        val catchUp = runCatching { client.upload(session, changed, checkpoints) }.exceptionOrNull()
        assertTrue(catchUp is BackfillCatchUpRequired)
        assertEquals(1, checkpoints.value?.reconciliationPass)
        assertEquals(0, checkpoints.value?.nextRecordIndex)

        val final = client.upload(session, changed, checkpoints)

        assertEquals(5, ingestionCalls)
        assertFalse(final.reconciliationPending)
        assertEquals(251, checkpoints.value?.nextRecordIndex)
        assertEquals(1, checkpoints.value?.reconciliationPass)
    }

    @Test fun exhaustedDirtyPassSeedsLatestSnapshotAndPreservesReconciliationBudget() = runTest {
        val original = records(250)
        val initial = BatchPlanner.streamingPlan(session.canonicalUserId, original, null)
        val checkpoints = MemoryCheckpoints(SyncCheckpoint(
            planFingerprint = initial.fingerprint,
            nextBatchIndex = 1,
            nextRecordIndex = 100,
            lastRecordKey = BatchPlanner.encodedRecordKey(initial.orderedRecords[99]),
            reconciliationPass = IngestionClient.MAX_RECONCILIATION_PASSES,
        ))
        val firstChangedSnapshot = original.toMutableList().also {
            it += records(1).single().copy(
                sourceRecordId = "inserted-before-frontier",
                recordedAt = "2026-08-31T23:59:59Z",
            )
            it[200] = it[200].copy(value = 9_999.0)
        }
        val client = IngestionClient(
            "https://beta.example",
            IngestionTransport { _, _, _ -> IngestionHttpResult(201) },
            backoff = {},
        )

        val dirtyResult = client.upload(session, firstChangedSnapshot, checkpoints)

        assertTrue(dirtyResult.reconciliationPending)
        assertEquals(0, checkpoints.value?.nextBatchIndex)
        assertEquals(0, checkpoints.value?.nextRecordIndex)
        assertEquals(IngestionClient.MAX_RECONCILIATION_PASSES, checkpoints.value?.reconciliationPass)

        val latestStableSnapshot = firstChangedSnapshot + records(1).single().copy(
            sourceRecordId = "inserted-before-clean-pass",
            recordedAt = "2026-09-02T00:00:00Z",
        )
        val final = client.upload(session, latestStableSnapshot, checkpoints)

        assertFalse(final.reconciliationPending)
        assertEquals(latestStableSnapshot.size, checkpoints.value?.nextRecordIndex)
        assertEquals(IngestionClient.MAX_RECONCILIATION_PASSES, checkpoints.value?.reconciliationPass)
    }

    @Test fun sanitizedHttpStatusIsReportedWithoutResponsePayload() = runTest {
        val statuses = mutableListOf<IngestionHttpResult>()
        val client = IngestionClient(
            "https://beta.example",
            IngestionTransport { _, _, _ -> IngestionHttpResult(202) },
            backoff = {},
            onHttpResult = statuses::add,
        )

        client.upload(session, records(1), MemoryCheckpoints())

        assertEquals(listOf(IngestionHttpResult(202)), statuses)
    }

    @Test fun serverErrorCodeIsAllowlistedAndBounded() {
        assertEquals("BACKGROUND_PROVIDER_NOT_CONFIGURED", sanitizedServerError("{\"error\":\"BACKGROUND_PROVIDER_NOT_CONFIGURED\"}"))
        assertNull(sanitizedServerError("{\"error\":\"contains user text\"}"))
        assertNull(sanitizedServerError("not-json"))
    }

    @Test fun partialReceiptDoesNotAdvancePastRejectedBatchOrClearCheckpoint() = runTest {
        val checkpoints = MemoryCheckpoints()
        var calls = 0
        val client = IngestionClient(
            "https://beta.example",
            IngestionTransport { _, _, _ ->
                calls += 1
                IngestionHttpResult(if (calls == 1) 201 else 207)
            },
            backoff = {},
        )

        val failure = runCatching { client.upload(session, records(101), checkpoints) }.exceptionOrNull()

        assertTrue(failure is BatchUploadFailed && failure.statusCode == 207)
        assertEquals(2, calls)
        assertEquals(1, checkpoints.value?.nextBatchIndex)
        assertEquals(100, checkpoints.value?.nextRecordIndex)
        assertFalse(checkpoints.cleared)
    }

    @Test fun connectorStatusFailureCannotBecomeFalseSyncSuccess() = runTest {
        val client = IngestionClient(
            "https://beta.example",
            IngestionTransport { _, _, _ -> IngestionHttpResult(503) },
            backoff = {},
        )

        val failure = runCatching {
            client.reportStatus(session, records(1), "SYNCED", "GRANTED")
        }.exceptionOrNull()

        assertTrue(failure is BatchUploadFailed && failure.statusCode == 503)
    }

    @Test fun productionTransportBoundsAConnectedServerThatNeverResponds() = runBlocking {
        val server = ServerSocket(0)
        thread(isDaemon = true, name = "hung-ingestion-fixture") {
            runCatching {
                server.accept().use { socket ->
                    val reader = socket.getInputStream().bufferedReader()
                    while (reader.readLine()?.isNotEmpty() == true) Unit
                    Thread.sleep(30_000)
                }
            }
        }
        val transport = OkHttpIngestionTransport(
            "http://127.0.0.1:${server.localPort}",
            connectTimeoutMs = 500,
            socketTimeoutMs = 500,
            callTimeoutMs = 150,
        )
        val started = TimeSource.Monotonic.markNow()
        var requestElapsed = 0.milliseconds

        val failure = try {
            runCatching { transport.post("/hung", session, "{}") }.exceptionOrNull()
                .also { requestElapsed = started.elapsedNow() }
        } finally {
            transport.close()
            server.close()
        }

        assertTrue(failure is IOException)
        assertTrue(requestElapsed >= 100.milliseconds)
        assertTrue(requestElapsed < 10_000.milliseconds)
    }

    private fun records(count: Int) = (1..count).map { index ->
        CanonicalHealthRecord(
            domain = "steps",
            sourceApp = "com.example.health",
            sourceRecordId = "record-$index",
            sourceUpdatedAt = "2026-09-01T00:00:${(index % 60).toString().padStart(2, '0')}Z",
            recordedAt = "2026-09-01T00:00:${(index % 60).toString().padStart(2, '0')}Z",
            startedAt = "2026-09-01T00:00:00Z",
            endedAt = "2026-09-01T00:01:00Z",
            timezone = "Asia/Taipei",
            localDate = "2026-09-01",
            value = index.toDouble(),
            unit = "count",
        )
    }

    private class MemoryCheckpoints(initial: SyncCheckpoint? = null) : CheckpointRepository {
        var value: SyncCheckpoint? = initial
        var cleared = false
        override fun load(): SyncCheckpoint? = value
        override fun save(checkpoint: SyncCheckpoint) { value = checkpoint }
        override fun clear() { value = null; cleared = true }
    }
}
