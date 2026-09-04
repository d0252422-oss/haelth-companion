package app.healthcompanion.sync

import android.content.Context

data class SyncCheckpoint(val planFingerprint: String, val nextBatchIndex: Int)
interface CheckpointRepository {
    fun load(): SyncCheckpoint?
    fun save(checkpoint: SyncCheckpoint)
    fun clear()
}

class SyncCheckpointStore(context: Context) : CheckpointRepository {
    private val preferences = context.getSharedPreferences("sync_checkpoint", Context.MODE_PRIVATE)

    override fun load(): SyncCheckpoint? {
        val fingerprint = preferences.getString("plan_fingerprint", null) ?: return null
        return SyncCheckpoint(fingerprint, preferences.getInt("next_batch_index", 0).coerceAtLeast(0))
    }

    override fun save(checkpoint: SyncCheckpoint) {
        preferences.edit().putString("plan_fingerprint", checkpoint.planFingerprint)
            .putInt("next_batch_index", checkpoint.nextBatchIndex).apply()
    }

    override fun clear() { preferences.edit().clear().apply() }
}
