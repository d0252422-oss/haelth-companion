package app.healthcompanion.sync

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
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit

class MainActivity : ComponentActivity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private lateinit var health: HealthConnectGateway
    private lateinit var auth: NativeGoogleAuth
    private lateinit var checkpoints: SyncCheckpointStore
    private lateinit var status: TextView
    private lateinit var lastSync: TextView
    private lateinit var login: Button
    private lateinit var allow: Button
    private lateinit var sync: Button
    private lateinit var logout: Button
    private lateinit var permissionLauncher: ActivityResultLauncher<Set<String>>
    private var currentSession: NativeAuthSession? = null
    private var currentState = ConnectorUiState.SIGNED_OUT

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        health = HealthConnectGateway(this)
        auth = NativeGoogleAuth(
            this,
            BuildConfig.SUPABASE_URL,
            BuildConfig.SUPABASE_PUBLISHABLE_KEY,
            BuildConfig.GOOGLE_WEB_CLIENT_ID,
            BuildConfig.API_BASE_URL,
        )
        checkpoints = SyncCheckpointStore(this)
        if (health.availability == HealthConnectClient.SDK_AVAILABLE) {
            permissionLauncher = registerForActivityResult(PermissionController.createRequestPermissionResultContract()) { granted ->
                if (granted.isEmpty()) render(ConnectorUiState.HEALTH_PERMISSION_DENIED)
                else {
                    render(ConnectorUiState.READY_TO_SYNC, if (granted.containsAll(health.readPermissions)) "已授權，準備同步" else "已授權可用資料，準備同步")
                    firstSync()
                }
            }
        }
        buildUi()
        restoreState()
    }

    private fun buildUi() {
        val title = TextView(this).apply { text = "生活小助手\n健康資料同步"; textSize = 24f }
        status = TextView(this).apply { textSize = 16f }
        lastSync = TextView(this).apply { textSize = 14f }
        login = Button(this).apply { text = "使用 Google 帳號登入"; setOnClickListener { startLogin() } }
        allow = Button(this).apply { text = "允許 Health Connect"; setOnClickListener { requestPermission() } }
        sync = Button(this).apply { text = "立即同步"; setOnClickListener { firstSync() } }
        logout = Button(this).apply { text = "登出"; setOnClickListener { logout() } }
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 80, 48, 48)
            addView(title); addView(status); addView(lastSync); addView(login); addView(allow); addView(sync); addView(logout)
        })
        render(ConnectorUiState.SIGNED_OUT)
    }

    private fun startLogin() {
        if (currentState == ConnectorUiState.AUTHENTICATING) return
        render(ConnectorUiState.AUTHENTICATING)
        scope.launch {
            runCatching { auth.signIn(this@MainActivity) }
                .onSuccess { session -> currentSession = session; afterAuthentication() }
                .onFailure { error ->
                    render(
                        if (error is NativeAuthCancelled) ConnectorUiState.SIGNED_OUT else ConnectorUiState.AUTH_ERROR,
                        if (error is NativeAuthCancelled) "已取消登入" else if (error is NativeAuthConfiguration) "Beta 登入尚未完成設定" else null,
                    )
                }
        }
    }

    private fun restoreState() = scope.launch {
        render(ConnectorUiState.AUTHENTICATING, "正在恢復安全登入…")
        runCatching { auth.restore() }
            .onSuccess { session ->
                currentSession = session
                if (session == null) render(ConnectorUiState.SIGNED_OUT) else afterAuthentication()
            }
            .onFailure { render(ConnectorUiState.AUTH_ERROR) }
    }

    private fun afterAuthentication() {
        render(ConnectorUiState.AUTHENTICATED)
        when (health.availability) {
            HealthConnectClient.SDK_AVAILABLE -> scope.launch {
                if (health.hasAnyPermission()) {
                    render(ConnectorUiState.READY_TO_SYNC)
                    firstSync()
                } else render(ConnectorUiState.HEALTH_PERMISSION_REQUIRED)
            }
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED ->
                render(ConnectorUiState.HEALTH_CONNECT_UNAVAILABLE, "請安裝或更新 Health Connect")
            else -> render(ConnectorUiState.HEALTH_CONNECT_UNAVAILABLE, "此裝置無法使用 Health Connect")
        }
    }

    private fun requestPermission() {
        if (currentSession == null) { render(ConnectorUiState.SIGNED_OUT); return }
        if (::permissionLauncher.isInitialized) permissionLauncher.launch(health.readPermissions)
        else render(ConnectorUiState.HEALTH_CONNECT_UNAVAILABLE)
    }

    private fun firstSync() {
        if (currentState == ConnectorUiState.SYNCING) return
        scope.launch {
            var session = currentSession
            if (session == null) { render(ConnectorUiState.SIGNED_OUT); return@launch }
            render(ConnectorUiState.SYNCING)
            runCatching {
                val granted = health.grantedReadPermissions()
                if (granted.isEmpty()) throw HealthPermissionMissing()
                val records = withContext(Dispatchers.IO) {
                    health.readBounded(Instant.now().minus(30, ChronoUnit.DAYS), Instant.now())
                }
                val client = IngestionClient(BuildConfig.API_BASE_URL)
                try {
                    withContext(Dispatchers.IO) {
                        client.upload(session!!, records, checkpoints) { done, total ->
                            scope.launch { status.text = "正在同步健康資料… $done/$total" }
                        }
                    }
                } catch (_: AuthenticationRequired) {
                    session = auth.refresh().also { currentSession = it }
                    withContext(Dispatchers.IO) { client.upload(session!!, records, checkpoints) }
                }
                val result = if (records.isEmpty()) "NO_DATA" else "SYNCED"
                val permissionState = if (granted.containsAll(health.readPermissions)) "GRANTED" else "PARTIAL"
                withContext(Dispatchers.IO) { client.reportStatus(session!!, records, result, permissionState) }
                records.isNotEmpty()
            }.onSuccess { hasData ->
                saveLastSync()
                render(if (hasData) ConnectorUiState.SYNC_SUCCESS else ConnectorUiState.SYNC_NO_DATA)
            }.onFailure { error ->
                when (error) {
                    is HealthPermissionMissing -> render(ConnectorUiState.HEALTH_PERMISSION_DENIED)
                    is AuthenticationRequired, is NativeAuthRejected -> {
                        currentSession = null
                        render(ConnectorUiState.AUTH_ERROR)
                    }
                    else -> render(ConnectorUiState.SYNC_ERROR)
                }
            }
        }
    }

    private fun logout() {
        currentSession = null
        checkpoints.clear()
        render(ConnectorUiState.SIGNED_OUT)
        scope.launch { auth.signOut() }
    }

    private fun saveLastSync() {
        val value = Instant.now().toString()
        getSharedPreferences("sync_status", MODE_PRIVATE).edit().putString("last_success", value).apply()
        updateLastSync(value)
    }

    private fun updateLastSync(value: String? = getSharedPreferences("sync_status", MODE_PRIVATE).getString("last_success", null)) {
        lastSync.text = value?.let {
            val formatted = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm").withZone(ZoneId.systemDefault()).format(Instant.parse(it))
            "最近同步：$formatted"
        } ?: "尚未完成同步"
    }

    private fun render(state: ConnectorUiState, detail: String? = null) {
        currentState = state
        status.text = detail ?: when (state) {
            ConnectorUiState.SIGNED_OUT -> "請使用 Google 帳號登入"
            ConnectorUiState.AUTHENTICATING -> "正在安全登入…"
            ConnectorUiState.AUTHENTICATED -> "帳號已連接"
            ConnectorUiState.HEALTH_CONNECT_UNAVAILABLE -> "此裝置目前無法使用 Health Connect"
            ConnectorUiState.HEALTH_PERMISSION_REQUIRED -> "請允許生活小助手讀取你選擇的健康資料"
            ConnectorUiState.HEALTH_PERMISSION_DENIED -> "尚未取得健康資料權限，可重新授權"
            ConnectorUiState.READY_TO_SYNC -> "權限已就緒"
            ConnectorUiState.SYNCING -> "正在同步健康資料…"
            ConnectorUiState.SYNC_SUCCESS -> "✓ 健康資料已連接\n✓ 同步完成\n✓ 健康分析已更新"
            ConnectorUiState.SYNC_NO_DATA -> "✓ 帳號與 Health Connect 已連接\n目前沒有可同步的健康資料"
            ConnectorUiState.AUTH_ERROR -> "登入失敗或已失效，請重新登入"
            ConnectorUiState.SYNC_ERROR -> "同步暫時未完成，請稍後重試"
        }
        val busy = state in setOf(ConnectorUiState.AUTHENTICATING, ConnectorUiState.SYNCING)
        login.visibility = if (state in setOf(ConnectorUiState.SIGNED_OUT, ConnectorUiState.AUTH_ERROR)) View.VISIBLE else View.GONE
        allow.visibility = if (state in setOf(ConnectorUiState.HEALTH_PERMISSION_REQUIRED, ConnectorUiState.HEALTH_PERMISSION_DENIED)) View.VISIBLE else View.GONE
        sync.visibility = if (state in setOf(ConnectorUiState.SYNC_SUCCESS, ConnectorUiState.SYNC_NO_DATA, ConnectorUiState.SYNC_ERROR, ConnectorUiState.READY_TO_SYNC)) View.VISIBLE else View.GONE
        logout.visibility = if (currentSession != null) View.VISIBLE else View.GONE
        login.isEnabled = !busy; allow.isEnabled = !busy; sync.isEnabled = !busy; logout.isEnabled = !busy
        updateLastSync()
    }

    override fun onDestroy() { scope.cancel(); super.onDestroy() }
}

class HealthPermissionMissing : Exception("HEALTH_PERMISSION_MISSING")
