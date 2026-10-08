package app.healthcompanion.sync

import android.content.Context

data class SyncCheckpoint(
    val planFingerprint: String,
    val nextBatchIndex: Int,
    val nextRecordIndex: Int = 0,
    val lastRecordKey: String? = null,
    val reconciliationPass: Int = 0,
    val datasetChanged: Boolean = false,
    val receiptContractVersion: Int = 0,
)
interface CheckpointRepository {
    fun load(): SyncCheckpoint?
    fun save(checkpoint: SyncCheckpoint)
    fun clear()
}

internal object SyncStateNamespace {
    fun userKey(userId: String): String = CanonicalIdentity.sha256(userId).take(16)
    fun modePrefix(userId: String, mode: BackgroundSyncMode): String =
        "${userKey(userId)}_${mode.name.lowercase()}"
    fun modeKey(userId: String, mode: BackgroundSyncMode, name: String): String =
        "${modePrefix(userId, mode)}_$name"
}

class SyncCheckpointStore(
    context: Context,
    userId: String,
    private val mode: BackgroundSyncMode,
) : CheckpointRepository {
    private val preferences = context.getSharedPreferences("sync_checkpoint", Context.MODE_PRIVATE)
    private val fingerprintKey = SyncStateNamespace.modeKey(userId, mode, PLAN_FINGERPRINT)
    private val batchIndexKey = SyncStateNamespace.modeKey(userId, mode, NEXT_BATCH_INDEX)
    private val recordIndexKey = SyncStateNamespace.modeKey(userId, mode, NEXT_RECORD_INDEX)
    private val lastRecordKey = SyncStateNamespace.modeKey(userId, mode, LAST_RECORD_KEY)
    private val reconciliationPassKey = SyncStateNamespace.modeKey(userId, mode, RECONCILIATION_PASS)
    private val datasetChangedKey = SyncStateNamespace.modeKey(userId, mode, DATASET_CHANGED)
    private val receiptVersionKey = SyncStateNamespace.modeKey(userId, mode, RECEIPT_VERSION)

    init {
        // beta.16 stored one global cursor. It belongs to the outstanding history
        // backfill and must not be claimed or erased by an incremental worker.
        if (mode == BackgroundSyncMode.BACKFILL) migrateLegacyBackfillCheckpoint()
    }

    override fun load(): SyncCheckpoint? {
        val fingerprint = preferences.getString(fingerprintKey, null) ?: return null
        return SyncCheckpoint(
            fingerprint,
            preferences.getInt(batchIndexKey, 0).coerceAtLeast(0),
            preferences.getInt(recordIndexKey, 0).coerceAtLeast(0),
            preferences.getString(lastRecordKey, null),
            preferences.getInt(reconciliationPassKey, 0).coerceAtLeast(0),
            preferences.getBoolean(datasetChangedKey, false),
            preferences.getInt(receiptVersionKey, 0),
        )
    }

    override fun save(checkpoint: SyncCheckpoint) {
        preferences.edit().putString(fingerprintKey, checkpoint.planFingerprint)
            .putInt(batchIndexKey, checkpoint.nextBatchIndex)
            .putInt(recordIndexKey, checkpoint.nextRecordIndex)
            .putInt(reconciliationPassKey, checkpoint.reconciliationPass)
            .putBoolean(datasetChangedKey, checkpoint.datasetChanged)
            .putInt(receiptVersionKey, checkpoint.receiptContractVersion)
            .also { editor ->
                checkpoint.lastRecordKey?.let { editor.putString(lastRecordKey, it) }
                    ?: editor.remove(lastRecordKey)
            }
            .apply()
    }

    override fun clear() {
        preferences.edit()
            .remove(fingerprintKey)
            .remove(batchIndexKey)
            .remove(recordIndexKey)
            .remove(lastRecordKey)
            .remove(reconciliationPassKey)
            .remove(datasetChangedKey)
            .remove(receiptVersionKey)
            .apply()
    }

    private fun migrateLegacyBackfillCheckpoint() {
        if (preferences.contains(fingerprintKey) || !preferences.contains(PLAN_FINGERPRINT)) return
        val fingerprint = preferences.getString(PLAN_FINGERPRINT, null) ?: return
        preferences.edit()
            .putString(fingerprintKey, fingerprint)
            .putInt(batchIndexKey, preferences.getInt(NEXT_BATCH_INDEX, 0).coerceAtLeast(0))
            .putInt(recordIndexKey, preferences.getInt(NEXT_RECORD_INDEX, 0).coerceAtLeast(0))
            .remove(PLAN_FINGERPRINT)
            .remove(NEXT_BATCH_INDEX)
            .remove(NEXT_RECORD_INDEX)
            .commit()
    }

    companion object {
        private const val PLAN_FINGERPRINT = "plan_fingerprint"
        private const val NEXT_BATCH_INDEX = "next_batch_index"
        private const val NEXT_RECORD_INDEX = "next_record_index"
        private const val LAST_RECORD_KEY = "last_record_key"
        private const val RECONCILIATION_PASS = "reconciliation_pass"
        private const val DATASET_CHANGED = "dataset_changed"
        private const val RECEIPT_VERSION = "receipt_contract_version"

        fun clearAll(context: Context, userId: String) {
            val preferences = context.getSharedPreferences("sync_checkpoint", Context.MODE_PRIVATE)
            val editor = preferences.edit()
                .remove(PLAN_FINGERPRINT)
                .remove(NEXT_BATCH_INDEX)
                .remove(NEXT_RECORD_INDEX)
            BackgroundSyncMode.entries.forEach { mode ->
                editor.remove(SyncStateNamespace.modeKey(userId, mode, PLAN_FINGERPRINT))
                    .remove(SyncStateNamespace.modeKey(userId, mode, NEXT_BATCH_INDEX))
                    .remove(SyncStateNamespace.modeKey(userId, mode, NEXT_RECORD_INDEX))
                    .remove(SyncStateNamespace.modeKey(userId, mode, LAST_RECORD_KEY))
                    .remove(SyncStateNamespace.modeKey(userId, mode, RECONCILIATION_PASS))
                    .remove(SyncStateNamespace.modeKey(userId, mode, DATASET_CHANGED))
                    .remove(SyncStateNamespace.modeKey(userId, mode, RECEIPT_VERSION))
            }
            editor.apply()
        }
    }
}
