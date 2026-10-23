package app.healthcompanion.sync

import android.content.SharedPreferences
import java.lang.reflect.Proxy
import java.time.Instant
import java.io.IOException
import java.net.SocketTimeoutException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.*
import org.junit.Test

class SyncRuntimeCursorTest {
    private val oldEnd = Instant.parse("2026-10-10T07:44:00Z")
    private val newEnd = Instant.parse("2026-10-20T10:00:00Z")
    private fun state() = SyncRuntimeStateStore(memoryPreferences(), memoryPreferences())

    @Test fun oldBackfillCompletionCannotRegressNewerIncrementalCursor() {
        val state = state()
        state.activeWindowEnd("owner-a", BackgroundSyncMode.BACKFILL, oldEnd)
        state.saveLastSuccessfulSync("owner-a", newEnd)
        state.saveLastSuccessfulSync("owner-a", oldEnd)
        assertEquals(newEnd, state.lastSuccessfulSync("owner-a"))
        // Retaining the greatest completed cursor must not erase unfinished history.
        assertEquals(oldEnd, state.activeWindowEnd("owner-a", BackgroundSyncMode.BACKFILL, newEnd))
    }

    @Test fun completionUsesWindowEndInsteadOfWallClockAndKeepsOwnersSeparate() {
        val state = state()
        state.saveLastSuccessfulSync("owner-a", oldEnd)
        state.saveLastSuccessfulSync("owner-b", newEnd)
        assertEquals(oldEnd, state.lastSuccessfulSync("owner-a"))
        assertEquals(newEnd, state.lastSuccessfulSync("owner-b"))
        state.saveLastSuccessfulSync("owner-a", newEnd)
        state.saveLastSuccessfulSync("owner-a", newEnd)
        assertEquals(newEnd, state.lastSuccessfulSync("owner-a"))
    }

    @Test fun partialRetryDoesNotAdvanceCompletedCursor() {
        val state = state()
        state.saveLastSuccessfulSync("owner-a", oldEnd)
        state.recordStarted("owner-a", "worker", 1)
        state.recordTerminal("owner-a", "RETRY_PENDING")
        assertEquals(oldEnd, state.lastSuccessfulSync("owner-a"))
    }

    @Test fun specializedFailuresAreNotCollapsedIntoGenericIoOrCancellation() = runBlocking {
        val failures = listOf(
            AuthenticationRequired() to "AUTH_REQUIRED",
            IncompleteIngestionReceipt() to "RECEIPT_INCOMPLETE",
            DomainCompletenessExhausted() to "DOMAIN_INCOMPLETE",
            BackfillCatchUpRequired() to "RECONCILIATION_PENDING",
            BatchUploadFailed(503) to "BATCH_HTTP_FAILURE",
            SocketTimeoutException("private health or token") to "SOCKET_TIMEOUT",
            IOException("private health or token") to "IO_FAILURE",
            CancellationException("private health or token") to "WORK_CANCELLED",
        )
        failures.forEach { (error, expected) -> assertEquals(expected, SyncFailureDiagnostic.from(error).reason) }
        val timeout = runCatching { withTimeout(0) { error("unreachable") } }.exceptionOrNull()!!
        assertEquals("DEADLINE_EXCEEDED", SyncFailureDiagnostic.from(timeout).reason)
    }

    @Test fun diagnosticsKeepStageAndOwnerButNeverExceptionMessagesOrUnknownClassNames() {
        val state = state()
        state.recordStarted("owner-a", "worker", 1)
        state.recordProgress("owner-a", "REPORT_STATUS")
        state.recordTerminal("owner-a", "RETRY_PENDING", object : Exception("token=PRIVATE_HEALTH_PAYLOAD") {})
        val metadata = state.workMetadata("owner-a")
        assertEquals("REPORT_STATUS", metadata.terminalStage)
        assertEquals("OTHER_EXCEPTION", metadata.failureReason)
        assertEquals("OtherException", metadata.exceptionClass)
        assertFalse(metadata.toString().contains("PRIVATE_HEALTH_PAYLOAD"))
        assertNull(state.workMetadata("owner-b").failureReason)
    }

    @Test fun startingOrSuccessfullyFinishingAnotherRunClearsStaleFailureDiagnostics() {
        val state = state()
        state.recordTerminal("owner-a", "RETRY_PENDING", IncompleteIngestionReceipt())
        assertEquals("RECEIPT_INCOMPLETE", state.workMetadata("owner-a").failureReason)
        state.recordStarted("owner-a", "next-worker", 2)
        assertNull(state.workMetadata("owner-a").failureReason)
        assertNull(state.workMetadata("owner-a").exceptionClass)
        state.recordTerminal("owner-a", "RETRY_PENDING", SocketTimeoutException("private"))
        state.recordTerminal("owner-a", "SUCCESS")
        assertNull(state.workMetadata("owner-a").failureReason)
        assertNull(state.workMetadata("owner-a").exceptionClass)
    }

    // Exercise the actual state store without Android context or any disk/device.
    private fun memoryPreferences(): SharedPreferences {
        val values = mutableMapOf<String, Any?>()
        lateinit var editor: SharedPreferences.Editor
        editor = Proxy.newProxyInstance(SharedPreferences.Editor::class.java.classLoader,
            arrayOf(SharedPreferences.Editor::class.java)) { _, method, args ->
            when (method.name) {
                "putString", "putInt", "putLong", "putBoolean", "putFloat", "putStringSet" -> { values[args!![0] as String] = args[1]; editor }
                "remove" -> { values.remove(args!![0] as String); editor }
                "clear" -> { values.clear(); editor }
                "apply" -> null
                "commit" -> true
                else -> error("Unexpected preference edit: ${method.name}")
            }
        } as SharedPreferences.Editor
        return Proxy.newProxyInstance(SharedPreferences::class.java.classLoader,
            arrayOf(SharedPreferences::class.java)) { _, method, args ->
            when (method.name) {
                "edit" -> editor
                "contains" -> values.containsKey(args!![0])
                "getAll" -> values.toMap()
                "getString", "getInt", "getLong", "getBoolean", "getFloat", "getStringSet" -> values[args!![0]] ?: args[1]
                else -> error("Unexpected preference read: ${method.name}")
            }
        } as SharedPreferences
    }
}
