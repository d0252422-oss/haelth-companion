package app.healthcompanion.sync

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.temporal.ChronoUnit

enum class ConnectorUiState {
    SIGNED_OUT, AUTHENTICATING, READY_FOR_PERMISSION, PERMISSION_REQUIRED,
    SYNCING, SYNC_COMPLETE, AUTH_ERROR, PERMISSION_ERROR, SYNC_ERROR,
}

class MainActivity : ComponentActivity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var health: HealthConnectGateway
    private lateinit var identity: IdentityBootstrap
    private lateinit var sessions: SessionStore
    private lateinit var checkpoints: SyncCheckpointStore
    private lateinit var status: TextView
    private lateinit var login: Button
    private lateinit var allow: Button
    private lateinit var sync: Button
    private lateinit var logout: Button
    private lateinit var permissionLauncher: ActivityResultLauncher<Set<String>>

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        health = HealthConnectGateway(this)
        identity = IdentityBootstrap(this, BuildConfig.API_BASE_URL, BuildConfig.AUTH_SETUP_URL)
        sessions = SessionStore(this)
        checkpoints = SyncCheckpointStore(this)
        if (health.availability == HealthConnectClient.SDK_AVAILABLE) {
            permissionLauncher = registerForActivityResult(PermissionController.createRequestPermissionResultContract()) { granted ->
                if (granted.isEmpty()) render(ConnectorUiState.PERMISSION_ERROR)
                else {
                    render(ConnectorUiState.SYNCING, if (granted.containsAll(health.readPermissions)) "已授權，正在首次同步" else "已授權可用資料，正在首次同步")
                    firstSync()
                }
            }
        }
        buildUi()
        consumeClaim(intent)
        restoreState()
    }

    private fun buildUi() {
        val title = TextView(this).apply { text = "生活小助手\n健康資料同步"; textSize = 24f }
        status = TextView(this).apply { textSize = 16f }
        login = Button(this).apply { text = "登入"; setOnClickListener { startLogin() } }
        allow = Button(this).apply { text = "連接健康資料"; setOnClickListener { requestPermission() } }
        sync = Button(this).apply { text = "立即同步"; setOnClickListener { firstSync() } }
        logout = Button(this).apply { text = "登出"; setOnClickListener { logout() } }
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(48, 80, 48, 48)
            addView(title); addView(status); addView(login); addView(allow); addView(sync); addView(logout)
        })
        render(ConnectorUiState.SIGNED_OUT)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent); setIntent(intent); consumeClaim(intent)
    }

    private fun startLogin() {
        render(ConnectorUiState.AUTHENTICATING)
        runCatching { startActivity(identity.setupIntent()) }
            .onFailure { render(ConnectorUiState.AUTH_ERROR) }
    }

    private fun consumeClaim(intent: Intent?) {
        val claim = identity.claimFrom(intent) ?: return
        render(ConnectorUiState.AUTHENTICATING)
        scope.launch {
            runCatching { withContext(Dispatchers.IO) { identity.exchange(claim) } }
                .onSuccess { session ->
                    sessions.save(session)
                    render(ConnectorUiState.READY_FOR_PERMISSION)
                    requestPermission()
                }
                .onFailure { render(ConnectorUiState.AUTH_ERROR) }
        }
    }

    private fun restoreState() {
        when (health.availability) {
            HealthConnectClient.SDK_AVAILABLE -> scope.launch {
                if (sessions.load() == null) render(ConnectorUiState.SIGNED_OUT)
                else if (health.hasAnyPermission()) firstSync()
                else render(ConnectorUiState.PERMISSION_REQUIRED)
            }
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> render(ConnectorUiState.PERMISSION_ERROR, "請安裝或更新 Health Connect")
            else -> render(ConnectorUiState.PERMISSION_ERROR, "此裝置無法使用 Health Connect")
        }
    }

    private fun requestPermission() {
        if (sessions.load() == null) { render(ConnectorUiState.SIGNED_OUT); return }
        if (::permissionLauncher.isInitialized) permissionLauncher.launch(health.readPermissions)
        else render(ConnectorUiState.PERMISSION_ERROR, "此裝置無法啟動 Health Connect 權限")
    }

    private fun firstSync() = scope.launch {
        var session = sessions.load()
        if (session == null) { render(ConnectorUiState.SIGNED_OUT); return@launch }
        render(ConnectorUiState.SYNCING)
        runCatching {
            session = withContext(Dispatchers.IO) { refreshIfNeeded(session!!) }
            val records = withContext(Dispatchers.IO) { health.readBounded(Instant.now().minus(30, ChronoUnit.DAYS), Instant.now()) }
            val client = IngestionClient(BuildConfig.API_BASE_URL)
            try {
                withContext(Dispatchers.IO) { client.upload(session!!, records, checkpoints) { done, total -> scope.launch { status.text = "正在同步健康資料… $done/$total" } } }
            } catch (_: AuthenticationRequired) {
                session = withContext(Dispatchers.IO) { identity.refresh(session!!) }.also(sessions::save)
                withContext(Dispatchers.IO) { client.upload(session!!, records, checkpoints) { done, total -> scope.launch { status.text = "正在同步健康資料… $done/$total" } } }
            }
            withContext(Dispatchers.IO) { client.reportStatus(session!!, records, "SYNCED") }
        }.onSuccess { render(ConnectorUiState.SYNC_COMPLETE) }
            .onFailure { error ->
                if (error is AuthenticationRequired || error.message == "SESSION_REFRESH_FAILED") {
                    sessions.clear(); render(ConnectorUiState.AUTH_ERROR)
                } else render(ConnectorUiState.SYNC_ERROR)
            }
    }

    private fun refreshIfNeeded(session: AppSession): AppSession {
        if (!SessionPolicy.needsRefresh(session, System.currentTimeMillis())) return session
        return identity.refresh(session).also(sessions::save)
    }

    private fun logout() {
        val session = sessions.load()
        sessions.clear(); checkpoints.clear(); render(ConnectorUiState.SIGNED_OUT)
        if (session != null) scope.launch(Dispatchers.IO) { runCatching { identity.logout(session) } }
    }

    private fun render(state: ConnectorUiState, detail: String? = null) {
        status.text = detail ?: when (state) {
            ConnectorUiState.SIGNED_OUT -> "請登入以連接健康資料"
            ConnectorUiState.AUTHENTICATING -> "正在安全登入…"
            ConnectorUiState.READY_FOR_PERMISSION, ConnectorUiState.PERMISSION_REQUIRED -> "請允許生活小助手讀取你選擇的健康資料"
            ConnectorUiState.SYNCING -> "正在同步健康資料…"
            ConnectorUiState.SYNC_COMPLETE -> "✓ 健康資料已連接\n✓ 同步完成\n✓ 健康分析已更新"
            ConnectorUiState.AUTH_ERROR -> "登入已失效，請重新登入"
            ConnectorUiState.PERMISSION_ERROR -> "尚未取得健康資料權限，可再次嘗試"
            ConnectorUiState.SYNC_ERROR -> "同步暫時未完成，請稍後重試"
        }
        login.visibility = if (state in setOf(ConnectorUiState.SIGNED_OUT, ConnectorUiState.AUTH_ERROR)) View.VISIBLE else View.GONE
        allow.visibility = if (state in setOf(ConnectorUiState.READY_FOR_PERMISSION, ConnectorUiState.PERMISSION_REQUIRED, ConnectorUiState.PERMISSION_ERROR)) View.VISIBLE else View.GONE
        sync.visibility = if (state in setOf(ConnectorUiState.SYNC_COMPLETE, ConnectorUiState.SYNC_ERROR)) View.VISIBLE else View.GONE
        logout.visibility = if (sessions.load() != null) View.VISIBLE else View.GONE
    }

    override fun onDestroy() { scope.cancel(); super.onDestroy() }
}
