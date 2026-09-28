package app.healthcompanion.sync

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.health.connect.client.HealthConnectClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout

/** Reconciles unique periodic work after reboot or an in-place package update. */
class SyncRecoveryReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action !in setOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED)) return
        val pending = goAsync()
        val app = context.applicationContext
        CoroutineScope(Dispatchers.IO).launch {
            try {
                withTimeout(8_000L) {
                    val auth = NativeGoogleAuth(
                        app, BuildConfig.SUPABASE_URL, BuildConfig.SUPABASE_PUBLISHABLE_KEY,
                        BuildConfig.GOOGLE_WEB_CLIENT_ID, BuildConfig.API_BASE_URL,
                    )
                    val session = auth.restore() ?: return@withTimeout
                    val health = HealthConnectGateway(app)
                    if (health.availability == HealthConnectClient.SDK_AVAILABLE &&
                        health.hasAnyPermission() &&
                        health.backgroundReadState() == BackgroundHealthReadState.GRANTED
                    ) {
                        BackgroundSyncScheduler.reconcileAndEnqueue(app, session.canonicalUserId)
                        BackgroundSyncScheduler.enqueueP0Recovery(app, session.canonicalUserId)
                    }
                }
            } catch (_: Exception) {
                // WorkManager's own reschedule receiver remains active. The next
                // application/worker entry retries this bounded reconciliation.
            } finally {
                pending.finish()
            }
        }
    }
}
