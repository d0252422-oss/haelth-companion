package app.healthcompanion.sync

data class CanonicalHealthRecord(
    val domain: String,
    val sourceApp: String,
    val sourceRecordId: String,
    val sourceUpdatedAt: String,
    val recordedAt: String,
    val startedAt: String?,
    val endedAt: String?,
    val timezone: String,
    val localDate: String,
    val value: Double,
    val unit: String,
    val stage: String? = null,
)
