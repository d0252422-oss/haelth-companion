package app.healthcompanion.sync

import android.os.Bundle
import android.content.Intent
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.health.connect.client.HealthConnectClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.temporal.ChronoUnit

class MainActivity : ComponentActivity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var health: HealthConnectGateway
    private lateinit var status: TextView
    private lateinit var permissionLauncher: ActivityResultLauncher<Set<String>>
    private lateinit var identity: IdentityBootstrap

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        health = HealthConnectGateway(this)
        identity = IdentityBootstrap(this, BuildConfig.API_BASE_URL)
        if (health.availability == HealthConnectClient.SDK_AVAILABLE) {
            permissionLauncher = registerForActivityResult(health.client.permissionController.createRequestPermissionResultContract()) { granted ->
                status.text = if (granted.containsAll(health.readPermissions)) "已授權，正在首次同步" else "需要允許健康資料讀取"
                if (granted.containsAll(health.readPermissions)) firstSync()
            }
        }
        val title = TextView(this).apply { text = "生活小助手\n健康資料同步"; textSize = 24f }
        status = TextView(this).apply { text = "正在檢查 Health Connect"; textSize = 16f }
        val setup = Button(this).apply { text = "繼續安全設定"; setOnClickListener { runCatching { startActivity(identity.setupIntent()) }.onFailure { status.text = "Beta 伺服器尚未設定" } } }
        val allow = Button(this).apply { text = "允許健康資料存取"; setOnClickListener { if (::permissionLauncher.isInitialized) permissionLauncher.launch(health.readPermissions) else status.text = "此裝置無法啟動 Health Connect 權限" } }
        val sync = Button(this).apply { text = "重新同步"; setOnClickListener { firstSync() } }
        setContentView(LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(48, 80, 48, 48); addView(title); addView(status); addView(setup); addView(allow); addView(sync) })
        consumeClaim(intent)
        when (health.availability) {
            HealthConnectClient.SDK_AVAILABLE -> scope.launch { status.text = if (health.hasAllPermissions()) "已連線" else "待授權"; if (health.hasAllPermissions()) firstSync() }
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> status.text = "請安裝或更新 Health Connect"
            else -> status.text = "此裝置無法使用 Health Connect"
        }
    }

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); consumeClaim(intent) }

    private fun consumeClaim(intent: Intent?) {
        val claim = identity.claimFrom(intent) ?: return
        status.text = "正在完成安全綁定"
        scope.launch {
            runCatching { withContext(Dispatchers.IO) { identity.exchange(claim) } }
                .onSuccess { session -> SessionStore(this@MainActivity).save(session); status.text = "帳號已安全綁定"; if (::permissionLauncher.isInitialized) permissionLauncher.launch(health.readPermissions) }
                .onFailure { status.text = "安全綁定失敗，請從健康管理 APP 重新開始" }
        }
    }

    private fun firstSync() = scope.launch {
        val session = SessionStore(this@MainActivity).load()
        if (session == null) { status.text = "需要從已登入的健康管理 APP 繼續安全設定"; return@launch }
        status.text = "同步中"
        runCatching {
            val records = withContext(Dispatchers.IO) { health.readBounded(Instant.now().minus(30, ChronoUnit.DAYS), Instant.now()) }
            withContext(Dispatchers.IO) { IngestionClient(BuildConfig.API_BASE_URL).upload(session, records) }
        }.onSuccess { code -> status.text = if (code in 200..299) "健康資料同步已啟用" else "同步暫時失敗（HTTP $code）" }
            .onFailure { status.text = if (it.message == "STAGING_ENDPOINT_NOT_CONFIGURED") "Beta 伺服器尚未設定" else "同步暫時失敗，稍後會再試" }
    }

    override fun onDestroy() { scope.cancel(); super.onDestroy() }
}
