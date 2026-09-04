package app.healthcompanion.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class CanonicalIdentityTest {
    private val record = CanonicalHealthRecord("steps", "com.mi.health", "record-1", "2026-08-29T01:00:00Z", "2026-08-29T01:00:00Z", "2026-08-29T00:00:00Z", "2026-08-29T01:00:00Z", "Asia/Taipei", "2026-08-29", 1234.0, "count")

    @Test fun replayIsDeterministic() = assertEquals(CanonicalIdentity.idempotencyKey("USER-A", record), CanonicalIdentity.idempotencyKey("user-a", record))
    @Test fun usersRemainIsolated() = assertNotEquals(CanonicalIdentity.idempotencyKey("user-a", record), CanonicalIdentity.idempotencyKey("user-b", record))
    @Test fun updatedValueChangesIdentity() = assertNotEquals(CanonicalIdentity.idempotencyKey("user-a", record), CanonicalIdentity.idempotencyKey("user-a", record.copy(value = 1235.0)))
}
