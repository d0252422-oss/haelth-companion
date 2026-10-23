package app.healthcompanion.sync

import android.content.SharedPreferences
import androidx.work.workDataOf
import java.lang.reflect.Proxy
import java.util.UUID
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class SyncRegistrationRecoveryTest {
    private val id = UUID.fromString("11111111-1111-4111-8111-111111111111")
    private val key = "aaaaaaaaaaaaaaaa"
    private val enqueued = SyncRegistration(id, 3, DurableWorkState.ENQUEUED)
    private fun input(owner: String = key) = workDataOf("canonical_user_key" to owner,
        "sync_mode" to "INCREMENTAL", "sync_trigger_source" to "PERIODIC_WORKER",
        "parent_worker_id" to "22222222-2222-4222-8222-222222222222", "parent_flow_id" to "isolated-flow")

    @Test fun confirmedOrphanUpdatesSameIdentityOnceAndRepeatedWakeDoesNotCompete() = runTest {
        var actual = enqueued
        var present = false
        val updates = mutableListOf<UUID>()
        suspend fun repair() = SyncRegistrationRecovery.repair(enqueued, { present }, {}, { actual }) {
            updates += actual.id; actual = actual.copy(generation = 4); present = true
        }
        assertTrue(repair()); assertFalse(repair())
        assertEquals(listOf(id), updates)
    }

    @Test fun registrationReappearingDuringSettleIsNotReplaced() = runTest {
        var present = false
        assertFalse(SyncRegistrationRecovery.repair(enqueued, { present }, { present = true }, { enqueued }) { fail("updated") })
    }

    @Test fun unknownQueryOrExistingJobCannotBeTreatedAsMissing() = runTest {
        for (present in listOf(null, true)) {
            assertFalse(SyncRegistrationRecovery.repair(enqueued, { present }, { fail("settled") }, { enqueued }) { fail("updated") })
        }
    }

    @Test fun runningBlockedFinishedOrCancelledWorkCannotBeRevived() = runTest {
        for (state in DurableWorkState.entries.filter { it != DurableWorkState.ENQUEUED }) {
            assertFalse(SyncRegistrationRecovery.repair(enqueued.copy(state = state), { false }, {}, { enqueued }) { fail("updated $state") })
        }
    }

    @Test fun generationStateAndIdentityRaceAllAbortUpdate() = runTest {
        for (current in listOf(null, enqueued.copy(generation = 4), enqueued.copy(state = DurableWorkState.RUNNING), enqueued.copy(id = UUID.randomUUID()))) {
            assertFalse(SyncRegistrationRecovery.repair(enqueued, { false }, {}, { current }) { fail("updated") })
        }
    }

    @Test fun updateFailureDoesNotReturnRepairSuccess() = runTest {
        val failure = runCatching { SyncRegistrationRecovery.repair(enqueued, { false }, {}, { enqueued }) { throw CheckpointPersistenceFailed() } }.exceptionOrNull()
        assertTrue(failure is CheckpointPersistenceFailed)
    }

    @Test fun durableDescriptorPreservesExactParentAndInputAndRejectsOtherOwnerModeOrId() {
        val prefs = memory()
        val store = SyncWorkRegistrationStore(prefs)
        store.save(key, BackgroundSyncMode.INCREMENTAL, id, input(), 30_000)
        val reopened = SyncWorkRegistrationStore(prefs)
        assertEquals(input(), reopened.load(key, BackgroundSyncMode.INCREMENTAL, id)!!.input)
        assertEquals(30_000, reopened.load(key, BackgroundSyncMode.INCREMENTAL, id)!!.initialDelayMs)
        assertNull(reopened.load("bbbbbbbbbbbbbbbb", BackgroundSyncMode.INCREMENTAL, id))
        assertNull(reopened.load(key, BackgroundSyncMode.BACKFILL, id))
        assertNull(reopened.load(key, BackgroundSyncMode.INCREMENTAL, UUID.randomUUID()))
        val childId = UUID.randomUUID()
        store.save(key, BackgroundSyncMode.INCREMENTAL, childId, input(), 30_000)
        // A failed child enqueue or KEEP race cannot erase the parent's recovery input.
        assertEquals(input(), reopened.load(key, BackgroundSyncMode.INCREMENTAL, id)!!.input)
        assertEquals(input(), reopened.load(key, BackgroundSyncMode.INCREMENTAL, childId)!!.input)
        reopened.prune(key, BackgroundSyncMode.INCREMENTAL, setOf(childId))
        assertNull(reopened.load(key, BackgroundSyncMode.INCREMENTAL, id))
        assertNotNull(reopened.load(key, BackgroundSyncMode.INCREMENTAL, childId))
    }

    @Test fun descriptorCannotPersistSecretFieldOrClaimAnotherOwner() {
        val store = SyncWorkRegistrationStore(memory())
        assertThrows(IllegalArgumentException::class.java) { store.save(key, BackgroundSyncMode.INCREMENTAL, id, workDataOf("token" to "isolated-secret")) }
        assertThrows(IllegalArgumentException::class.java) { store.save(key, BackgroundSyncMode.INCREMENTAL, id, input("bbbbbbbbbbbbbbbb")) }
    }

    @Test fun stoppedAccountCannotBeSelectedForOfflineRegistrationRepair() {
        val prefs = memory()
        val state = SyncRuntimeStateStore(prefs, memory())
        val owner = "isolated-owner"
        val ownerKey = BackgroundWorkNames.userKey(owner)
        state.registerScheduledScope(ownerKey)
        assertEquals(setOf(ownerKey), state.scheduledUserKeys())
        state.setAutomaticSyncEnabled(owner, false)
        assertTrue(state.scheduledUserKeys().isEmpty())
    }

    @Test fun descriptorCommitFailureIsExplicitAndCannotProceedToEnqueue() {
        val store = SyncWorkRegistrationStore(memory(commit = false))
        assertThrows(CheckpointPersistenceFailed::class.java) { store.save(key, BackgroundSyncMode.INCREMENTAL, id, input()) }
    }

    private fun memory(commit: Boolean = true): SharedPreferences {
        val values = mutableMapOf<String, Any?>()
        lateinit var editor: SharedPreferences.Editor
        editor = Proxy.newProxyInstance(SharedPreferences.Editor::class.java.classLoader, arrayOf(SharedPreferences.Editor::class.java)) { _, m, args ->
            when (m.name) {
                "putString", "putBoolean", "putInt", "putLong" -> { values[args!![0] as String] = args[1]; editor }
                "remove" -> { values.remove(args!![0]); editor }
                "commit" -> commit
                "apply" -> null
                else -> error(m.name)
            }
        } as SharedPreferences.Editor
        return Proxy.newProxyInstance(SharedPreferences::class.java.classLoader, arrayOf(SharedPreferences::class.java)) { _, m, args ->
            when (m.name) {
                "edit" -> editor
                "getAll" -> values.toMap()
                "getString", "getBoolean", "getInt", "getLong" -> values[args!![0]] ?: args[1]
                else -> error(m.name)
            }
        } as SharedPreferences
    }
}
