package app.healthcompanion.sync

import android.content.Context
import android.content.SharedPreferences
import androidx.work.Data
import org.json.JSONObject
import java.util.UUID

/** App-owned scheduling metadata only. No session, canonical identity or health values. */
internal class SyncWorkRegistrationStore(private val preferences: SharedPreferences) {
    constructor(context: Context) : this(context.getSharedPreferences("sync_work_registration", Context.MODE_PRIVATE))

    fun save(userKey: String, mode: BackgroundSyncMode, id: UUID, input: Data,
        initialDelayMs: Long = 0, expedited: Boolean = false) {
        val values = input.keyValueMap
        require(values.keys.all { it in INPUT_KEYS } && values.values.all { it is String })
        require(input.getString(BackgroundSyncScheduler.WORK_USER_KEY) == userKey)
        require(input.getString(BackgroundSyncScheduler.WORK_MODE) == mode.name)
        val value = JSONObject().put("version", 1).put("kind", "ONE_TIME_CONNECTED_EXPONENTIAL_30S").put("id", id.toString())
            .put("initial_delay_ms", initialDelayMs).put("expedited", expedited)
            .put("input", JSONObject(values))
        if (!preferences.edit().putString(key(userKey, mode, id), value.toString()).commit()) throw CheckpointPersistenceFailed()
    }

    fun load(userKey: String, mode: BackgroundSyncMode, id: UUID): SavedSyncWork? = runCatching {
        val value = JSONObject(preferences.getString(key(userKey, mode, id), null) ?: return null)
        if (value.getInt("version") != 1 || value.optString("kind") != "ONE_TIME_CONNECTED_EXPONENTIAL_30S" || value.getString("id") != id.toString()) return null
        val json = value.getJSONObject("input")
        val names = json.keys().asSequence().toList()
        if (names.any { it !in INPUT_KEYS || json.get(it) !is String }) return null
        val input = Data.Builder().apply { names.forEach { putString(it, json.getString(it)) } }.build()
        if (input.getString(BackgroundSyncScheduler.WORK_USER_KEY) != userKey ||
            input.getString(BackgroundSyncScheduler.WORK_MODE) != mode.name) return null
        val delay = value.getLong("initial_delay_ms")
        if (delay !in 0..30_000) return null
        SavedSyncWork(input, delay, value.getBoolean("expedited"))
    }.getOrNull()

    fun prune(userKey: String, mode: BackgroundSyncMode, activeIds: Set<UUID>) {
        val prefix = "${userKey}_${mode.name}_"
        val editor = preferences.edit()
        preferences.all.keys.filter { it.startsWith(prefix) &&
            runCatching { UUID.fromString(it.removePrefix(prefix)) }.getOrNull() !in activeIds }.forEach(editor::remove)
        if (!editor.commit()) throw CheckpointPersistenceFailed()
    }

    private fun key(userKey: String, mode: BackgroundSyncMode, id: UUID): String {
        require(userKey.matches(Regex("[a-f0-9]{16}")))
        return "${userKey}_${mode.name}_$id"
    }

    companion object {
        private val INPUT_KEYS = setOf("sync_mode", "canonical_user_key", "sync_trigger_source",
            "parent_worker_id", "parent_flow_id", "recovery_frozen_end")
    }
}

/** Version 1 requests all use CONNECTED and exponential 30s backoff. */
internal data class SavedSyncWork(val input: Data, val initialDelayMs: Long, val expedited: Boolean)

internal data class SyncRegistration(val id: UUID, val generation: Int, val state: DurableWorkState)

/** Two actual missing-job reads plus a fresh same-generation WorkInfo are required. */
internal object SyncRegistrationRecovery {
    suspend fun repair(
        before: SyncRegistration,
        jobPresent: () -> Boolean?,
        settle: suspend () -> Unit,
        current: suspend () -> SyncRegistration?,
        apply: suspend () -> Unit,
    ): Boolean {
        if (before.state != DurableWorkState.ENQUEUED || jobPresent() != false) return false
        settle()
        if (jobPresent() != false || current() != before) return false
        apply()
        return true
    }
}
