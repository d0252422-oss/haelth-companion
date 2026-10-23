package app.healthcompanion.sync

import java.io.IOException
import kotlinx.coroutines.CancellationException

/** Only an authentication rejection warrants one refresh. Transport failures remain retryable. */
internal object NativeSessionRecovery {
    suspend fun <T> restore(resolve: suspend () -> T, refresh: suspend () -> Unit): T = try {
        resolve()
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (_: NativeAuthRejected) {
        refresh()
        resolve()
    }

    fun checkHttp(status: Int) {
        when {
            status in 200..299 -> Unit
            status == 401 || status == 403 -> throw NativeAuthRejected()
            status == 408 || status == 429 || status >= 500 -> throw IOException("AUTH_SERVICE_TEMPORARY")
            else -> throw NativeAuthConfiguration()
        }
    }

    fun requireSameOwner(expected: String, actual: String) {
        if (expected != actual) throw NativeAuthRejected()
    }
}

/** Yield between verified batches, well before the WorkManager execution deadline. */
internal class UploadWorkBudget(
    private val maxBatches: Int = 12,
    private val maxMillis: Long = 90_000L,
    private val clock: () -> Long = { System.nanoTime() / 1_000_000 },
) {
    private val started = clock()
    fun exhausted(completedHere: Int): Boolean = completedHere >= maxBatches || clock() - started >= maxMillis
}

internal class CheckpointPersistenceFailed : IOException("CHECKPOINT_PERSISTENCE_FAILED")
internal class PendingScopeMismatch : IOException("PENDING_SCOPE_MISMATCH")
