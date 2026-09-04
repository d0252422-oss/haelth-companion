package app.healthcompanion.sync

import java.math.BigDecimal
import java.security.MessageDigest

object CanonicalIdentity {
    fun idempotencyKey(user: String, record: CanonicalHealthRecord): String = sha256(listOf(
        "sha256-canonical-v1", user.lowercase(), "android", record.domain, record.sourceApp,
        record.sourceRecordId, record.startedAt ?: "", record.endedAt ?: "", record.recordedAt,
        BigDecimal.valueOf(record.value).stripTrailingZeros().toPlainString(), record.unit, record.stage ?: "",
    ).joinToString("\u001f"))

    fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
}
