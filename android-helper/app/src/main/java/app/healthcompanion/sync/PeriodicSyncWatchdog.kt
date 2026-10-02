package app.healthcompanion.sync

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import java.util.concurrent.TimeUnit

/**
 * Inexact safety net for an orphaned WorkManager periodic system job.
 * It only wakes the existing scheduler; it never reads health data itself.
 */
internal object PeriodicSyncWatchdog {
    const val ACTION = "app.healthcompanion.sync.PERIODIC_WATCHDOG"
    const val INTERVAL_MS = 6 * 60 * 60 * 1_000L

    fun schedule(context: Context): Boolean = runCatching {
        val alarm = context.getSystemService(AlarmManager::class.java) ?: return@runCatching false
        val intent = Intent(context, SyncRecoveryReceiver::class.java).setAction(ACTION)
        val pending = PendingIntent.getBroadcast(
            context, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_ONE_SHOT,
        )
        alarm.setAndAllowWhileIdle(
            AlarmManager.ELAPSED_REALTIME_WAKEUP,
            SystemClock.elapsedRealtime() + INTERVAL_MS,
            pending,
        )
        true
    }.getOrDefault(false)
}
