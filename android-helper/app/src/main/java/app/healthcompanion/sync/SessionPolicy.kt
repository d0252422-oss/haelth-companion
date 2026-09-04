package app.healthcompanion.sync

object SessionPolicy {
    fun needsRefresh(session: AppSession, nowEpochMillis: Long, skewMillis: Long = 60_000): Boolean =
        session.expiresAtEpochMillis - nowEpochMillis <= skewMillis
}
