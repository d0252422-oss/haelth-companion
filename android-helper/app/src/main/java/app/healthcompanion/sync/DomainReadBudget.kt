package app.healthcompanion.sync

import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withTimeout

internal object DomainReadBudget {
    suspend fun <T> read(semaphore: Semaphore, timeoutMs: Long, reader: suspend () -> T): T =
        semaphore.withPermit { withTimeout(timeoutMs) { reader() } }
}
