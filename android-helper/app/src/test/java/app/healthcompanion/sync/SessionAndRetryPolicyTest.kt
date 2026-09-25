package app.healthcompanion.sync

import java.net.SocketTimeoutException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionAndRetryPolicyTest {
    private val session = AppSession("user", "session", "access", "refresh", 100_000)

    @Test fun sessionRefreshUsesSafetySkew() {
        assertFalse(SessionPolicy.needsRefresh(session, 1_000))
        assertTrue(SessionPolicy.needsRefresh(session, 40_000))
    }

    @Test fun authAndOversizeNeverBlindRetry() {
        assertEquals(RetryAction.AUTH_FAIL, RetryPolicy.action(401, 1))
        assertEquals(RetryAction.AUTH_FAIL, RetryPolicy.action(403, 1))
        assertEquals(RetryAction.OVERSIZE_FAIL, RetryPolicy.action(413, 1))
    }

    @Test fun transientRetryIsBounded() {
        assertEquals(RetryAction.RETRY, RetryPolicy.action(429, 1))
        assertEquals(RetryAction.RETRY, RetryPolicy.action(503, 2))
        assertEquals(RetryAction.FAIL, RetryPolicy.action(503, 3))
    }

    @Test fun partialReceiptIsNeverTreatedAsCompleteSuccess() {
        assertEquals(RetryAction.FAIL, RetryPolicy.action(207, 1))
    }

    @Test fun transportTimeoutIsRetryableButPermanentFailuresAreNot() {
        assertTrue(RetryPolicy.isRetryable(SocketTimeoutException("bounded timeout")))
        assertFalse(RetryPolicy.isRetryable(AuthenticationRequired()))
        assertFalse(RetryPolicy.isRetryable(BatchUploadFailed(400)))
    }

    @Test fun workManagerRetriesOnlyTransientFailuresAndRemainsBounded() {
        assertTrue(RetryPolicy.shouldRetryWorker(SocketTimeoutException("bounded timeout"), 0, 3))
        assertTrue(RetryPolicy.shouldRetryWorker(BatchUploadFailed(503), 0, 3))
        assertFalse(RetryPolicy.shouldRetryWorker(BatchUploadFailed(503), 2, 3))
        assertFalse(RetryPolicy.shouldRetryWorker(BatchUploadFailed(400), 0, 3))
        assertFalse(RetryPolicy.shouldRetryWorker(BatchUploadFailed(207), 0, 3))
        assertFalse(RetryPolicy.shouldRetryWorker(OversizedBatchRejected(), 0, 3))
    }
}
