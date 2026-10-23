package app.healthcompanion.sync

import android.content.SharedPreferences
import java.io.IOException
import java.lang.reflect.Proxy
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.runTest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class AutonomousSyncRecoveryTest {
    @get:Rule val temp = TemporaryFolder()
    private val owner = "11111111-1111-4111-8111-111111111111"
    private val session = NativeAuthSession(owner, "isolated-fixture")
    private val window = SyncWindow(Instant.parse("2026-10-21T00:00:00Z"), Instant.parse("2026-10-22T00:00:00Z"))
    private fun record(id: Int, domain: String = "steps") = CanonicalHealthRecord(domain, "isolated", "$id",
        window.start.toString(), window.start.toString(), window.start.toString(), window.start.toString(),
        "Asia/Taipei", "2026-10-21", id.toDouble(), "count")
    private fun page(count: Int = 101) = PendingSyncPage(window, read = HealthReadResult(
        (1..count).map { record(it) }, emptySet(), emptySet(), 1,
        mapOf("steps" to DomainReadTrace(count, count, 1, "COMPLETE"))))
    private fun store(user: String = owner, api: String = "https://beta.example") =
        PendingSyncPageStore(temp.root, api, user, BackgroundSyncMode.BACKFILL)
    private fun receipt(body: String): IngestionHttpResult {
        val a = JSONObject(body).getJSONArray("mutations")
        val keys = List(a.length()) { a.getJSONObject(it).getString("idempotency_key") }
        return IngestionHttpResult(200, receipt = IngestionReceipt.parse(JSONObject()
            .put("accepted_idempotency_keys", JSONArray()).put("duplicate_idempotency_keys", JSONArray(keys))
            .put("rejected", JSONArray()).toString()))
    }

    @Test fun readThenProcessDeathKeepsPendingPageAndDoesNotConsumeSourceCursor() {
        store().save(page())
        val restored = store().load(window)!!
        assertEquals(page().read!!.records, restored.read!!.records)
        assertTrue(restored.cursors.isEmpty())
        assertFalse(restored.complete)
        assertNull(store("another-owner").load(window))
        assertNull(store(api = "https://different-environment.example").load(window))
        assertThrows(PendingScopeMismatch::class.java) { store().load(window.copy(end = window.end.plusSeconds(1))) }
    }

    @Test fun budgetYieldsAfterDurableBatchAndFreshClientContinuesWithoutReadingSource() = runTest {
        store().save(page())
        val disk = PreferenceDisk()
        var calls = 0
        val input = store().load(window)!!
        val first = IngestionClient("https://beta.example", IngestionTransport { _, _, body -> calls++; receipt(body) })
        val result = first.upload(session, input.read!!.records,
            SyncCheckpointStore(disk.open(), owner, BackgroundSyncMode.BACKFILL), budget = UploadWorkBudget(maxBatches = 1))
        assertTrue(result.continuationPending)
        assertEquals(1, calls)
        val checkpoint = SyncCheckpointStore(disk.open(), owner, BackgroundSyncMode.BACKFILL)
        assertEquals(100, checkpoint.load()!!.nextRecordIndex)
        val restartedInput = store().load(window)!!
        val restarted = IngestionClient("https://beta.example", IngestionTransport { _, _, body -> calls++; receipt(body) })
        val end = restarted.upload(session, restartedInput.read!!.records, checkpoint)
        assertFalse(end.continuationPending)
        assertEquals(101, end.recordsUploaded)
        assertEquals(2, calls)
        store().save(restartedInput.verified(end.persistedDomainCounts))
        assertTrue(store().load(window)!!.complete)
    }

    @Test fun receiptBeforeFailedLocalCommitReplaysSameIdentityWithoutFalseProgress() = runTest {
        val disk = PreferenceDisk().apply { failCommit = true }
        val persisted = mutableSetOf<String>()
        val calls = mutableListOf<String>()
        val transport = IngestionTransport { _, _, body ->
            val id = JSONObject(body).getJSONArray("mutations").getJSONObject(0).getString("idempotency_key")
            calls += id; persisted += id; receipt(body)
        }
        val first = IngestionClient("https://beta.example", transport)
        val failure = runCatching { first.upload(session, listOf(record(1)), SyncCheckpointStore(disk.open(), owner, BackgroundSyncMode.BACKFILL)) }.exceptionOrNull()
        assertTrue(failure is CheckpointPersistenceFailed)
        assertNull(SyncCheckpointStore(disk.open(), owner, BackgroundSyncMode.BACKFILL).load())
        disk.failCommit = false
        IngestionClient("https://beta.example", transport).upload(session, listOf(record(1)), SyncCheckpointStore(disk.open(), owner, BackgroundSyncMode.BACKFILL))
        assertEquals(2, calls.size); assertEquals(calls[0], calls[1]); assertEquals(1, persisted.size)
    }

    @Test fun cappedSleepPageAdvancesParentAndStagesTogetherOnlyAfterVerifiedPage() {
        val input = PendingSyncPage(window, read = HealthReadResult(listOf(record(1, "sleep"), record(2, "sleep_stage")),
            emptySet(), setOf("sleep"), 2,
            mapOf("sleep" to DomainReadTrace(1, 1, 2, "CAPPED"), "sleep_stage" to DomainReadTrace(1, 1, 2, "CAPPED")),
            nextPageTokens = mapOf("sleep" to "opaque-next-page")))
        store().save(input)
        assertTrue(store().load(window)!!.cursors.isEmpty())
        assertThrows(IllegalArgumentException::class.java) { input.verified(mapOf("sleep" to 1)) }
        store().save(input.verified(mapOf("sleep" to 1, "sleep_stage" to 1)))
        val next = store().load(window)!!
        assertEquals(setOf("sleep"), next.remaining)
        assertEquals("opaque-next-page", next.cursors["sleep"])
        assertNull(next.read); assertNotNull(next.segment)
        assertEquals(1, next.totals["sleep_stage"]!!.mappedCount)
    }

    @Test fun laterPageUsesIndependentCheckpointAndPreservesLegacy17800() {
        val disk = PreferenceDisk()
        val legacy = SyncCheckpointStore(disk.open(), owner, BackgroundSyncMode.BACKFILL)
        val original = SyncCheckpoint("v3:old", 178, 17800, receiptContractVersion = 1)
        legacy.save(original)
        val segment = SyncCheckpointStore(disk.open(), owner, BackgroundSyncMode.BACKFILL, "frozen-window|1")
        assertNull(segment.load())
        segment.save(SyncCheckpoint("v3:page", 1, 100, receiptContractVersion = 1))
        assertEquals(original, SyncCheckpointStore(disk.open(), owner, BackgroundSyncMode.BACKFILL).load())
        assertNull(SyncCheckpointStore(disk.open(), "other", BackgroundSyncMode.BACKFILL, "frozen-window|1").load())
    }

    @Test fun sourceFailuresStayPendingAndAreNeverClassifiedAsEmptyComplete() {
        val failed = PendingSyncPage(window, read = HealthReadResult(emptyList(), setOf("steps"), emptySet(), 0,
            mapOf("steps" to DomainReadTrace(null, 0, 0, "READER_ERROR"))))
        val next = failed.verified(emptyMap())
        assertFalse(next.complete); assertEquals(setOf("steps"), next.remaining); assertTrue(next.totals.isEmpty())
    }

    @Test fun revokedRemainingDomainCannotDisappearAndBecomeFalseComplete() {
        val pending = PendingSyncPage(window, remaining = setOf("sleep", "steps"), read = HealthReadResult(
            emptyList(), emptySet(), emptySet(), 1, mapOf("steps" to DomainReadTrace(0, 0, 1, "COMPLETE"))))
        assertEquals(setOf("sleep"), pending.verified(emptyMap()).remaining)
        assertFalse(pending.verified(emptyMap()).complete)
    }

    @Test fun rejectedCursorGetsOnlyOneFixedRangeRestart() {
        val failedRead = HealthReadResult(emptyList(), setOf("steps"), emptySet(), 0,
            mapOf("steps" to DomainReadTrace(null, 0, 0, "READER_ERROR")))
        val input = PendingSyncPage(window, remaining = setOf("steps"), cursors = mapOf("steps" to "expired"), read = failedRead)
        val restarted = input.verified(emptyMap())
        assertTrue(restarted.cursors.isEmpty()); assertEquals(window, restarted.window)
        assertEquals(1, restarted.cursorRestarts["steps"])
        val again = restarted.copy(cursors = mapOf("steps" to "another-expired"), read = failedRead).verified(emptyMap())
        assertEquals("another-expired", again.cursors["steps"])
        assertEquals(1, again.cursorRestarts["steps"]); assertFalse(again.complete)
    }

    @Test fun cancellationAfterServerCommitRetainsPendingPageForIdenticalReplay() = runTest {
        store().save(page(1))
        val disk = PreferenceDisk()
        var key: String? = null
        val first = IngestionClient("https://beta.example", IngestionTransport { _, _, body ->
            key = JSONObject(body).getJSONArray("mutations").getJSONObject(0).getString("idempotency_key")
            throw CancellationException("isolated process interruption")
        })
        assertTrue(runCatching { first.upload(session, store().load(window)!!.read!!.records,
            SyncCheckpointStore(disk.open(), owner, BackgroundSyncMode.BACKFILL)) }.exceptionOrNull() is CancellationException)
        assertNull(SyncCheckpointStore(disk.open(), owner, BackgroundSyncMode.BACKFILL).load())
        IngestionClient("https://beta.example", IngestionTransport { _, _, body ->
            assertEquals(key, JSONObject(body).getJSONArray("mutations").getJSONObject(0).getString("idempotency_key"))
            receipt(body)
        }).upload(session, store().load(window)!!.read!!.records, SyncCheckpointStore(disk.open(), owner, BackgroundSyncMode.BACKFILL))
    }

    @Test fun sameTimestampDifferentSourceIdsSurvivePageRoundTrip() {
        store().save(page(1001))
        assertEquals(1001, store().load(window)!!.read!!.records.map { it.sourceRecordId }.distinct().size)
    }

    @Test fun truncatedPendingDataFailsClosedInsteadOfReturningNoData() {
        store().save(page())
        val file = temp.root.listFiles()!!.single { it.name.endsWith(".gz") }
        file.writeBytes(file.readBytes().take(16).toByteArray())
        assertThrows(IOException::class.java) { store().load(window) }
    }

    @Test fun transientAuthDoesNotRefreshOrBecomeSignedOutAndCancellationPropagates() = runTest {
        var refreshed = 0
        val io = runCatching { NativeSessionRecovery.restore<String>({ throw IOException("isolated") }, { refreshed++ }) }.exceptionOrNull()
        assertTrue(io is IOException); assertEquals(0, refreshed)
        val cancelled = runCatching { NativeSessionRecovery.restore<String>({ throw CancellationException() }, { refreshed++ }) }.exceptionOrNull()
        assertTrue(cancelled is CancellationException); assertEquals(0, refreshed)
    }

    @Test fun actualAuthRejectionRefreshesOnceAndOwnerChangeIsRejected() = runTest {
        var calls = 0; var refreshed = 0
        val result = NativeSessionRecovery.restore({ if (calls++ == 0) throw NativeAuthRejected() else owner }, { refreshed++ })
        assertEquals(owner, result); assertEquals(1, refreshed)
        assertThrows(NativeAuthRejected::class.java) { NativeSessionRecovery.requireSameOwner(owner, "other") }
        assertThrows(IOException::class.java) { NativeSessionRecovery.checkHttp(503) }
        assertThrows(NativeAuthRejected::class.java) { NativeSessionRecovery.checkHttp(401) }
    }

    /** apply is deliberately volatile; only successful commit survives a new process. */
    private class PreferenceDisk {
        private val disk = mutableMapOf<String, Any?>()
        var failCommit = false
        fun open(): SharedPreferences {
            val memory = disk.toMutableMap()
            lateinit var prefs: SharedPreferences
            prefs = Proxy.newProxyInstance(SharedPreferences::class.java.classLoader, arrayOf(SharedPreferences::class.java)) { _, method, args ->
                when (method.name) {
                    "edit" -> {
                        val edits = mutableMapOf<String, Any?>(); val removed = mutableSetOf<String>()
                        lateinit var editor: SharedPreferences.Editor
                        editor = Proxy.newProxyInstance(SharedPreferences.Editor::class.java.classLoader, arrayOf(SharedPreferences.Editor::class.java)) { _, m, a ->
                            when (m.name) {
                                "putString", "putInt", "putBoolean", "putLong" -> { edits[a!![0] as String] = a[1]; editor }
                                "remove" -> { removed += a!![0] as String; editor }
                                "apply", "commit" -> {
                                    memory.putAll(edits); removed.forEach(memory::remove)
                                    if (m.name == "commit") { if (!failCommit) { disk.clear(); disk.putAll(memory) }; !failCommit } else null
                                }
                                else -> error(m.name)
                            }
                        } as SharedPreferences.Editor
                        editor
                    }
                    "getString", "getInt", "getBoolean", "getLong" -> memory[args!![0]] ?: args[1]
                    "contains" -> memory.containsKey(args!![0])
                    "getAll" -> memory.toMap()
                    else -> error(method.name)
                }
            } as SharedPreferences
            return prefs
        }
    }
}
