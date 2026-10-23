package app.healthcompanion.sync

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout

/** Reconciles unique periodic work after reboot, update, or an inexact watchdog wake. */
class SyncRecoveryReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action !in setOf(
                Intent.ACTION_BOOT_COMPLETED,
                Intent.ACTION_MY_PACKAGE_REPLACED,
                PeriodicSyncWatchdog.ACTION,
            )) return
        val pending = goAsync()
        val app = context.applicationContext
        // Re-arm before the asynchronous work so a transient auth/network error
        // cannot permanently stop the only independent repair wakeup.
        PeriodicSyncWatchdog.schedule(app)
        CoroutineScope(Dispatchers.IO).launch {
            try {
                withTimeout(8_000L) { BackgroundSyncScheduler.reconcileRegisteredWork(app) }
            } catch (_: Exception) {
                // WorkManager's own reschedule receiver remains active. The next
                // application/worker entry retries this bounded reconciliation.
            } finally {
                pending.finish()
            }
        }
    }
}
