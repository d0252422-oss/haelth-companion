package app.healthcompanion.sync

import android.app.Activity
import android.content.Context
import android.util.Base64
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.Google
import io.github.jan.supabase.auth.providers.builtin.IDToken
import io.github.jan.supabase.createSupabaseClient
import io.ktor.client.engine.android.Android
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom

class NativeAuthCancelled : Exception("AUTH_CANCELLED")
class NativeAuthConfiguration : Exception("AUTH_CONFIGURATION_MISSING")
class NativeAuthRejected : Exception("AUTH_REJECTED")

class NativeGoogleAuth(
    context: Context,
    private val supabaseUrl: String,
    private val publishableKey: String,
    private val googleWebClientId: String,
    private val webAuthApiUrl: String,
    private val betaApiBaseUrl: String,
) {
    private val appContext = context.applicationContext
    private val credentialManager = CredentialManager.create(appContext)
    private val supabase = createSupabaseClient(supabaseUrl, publishableKey) {
        httpEngine = Android.create()
        install(Auth) {
            alwaysAutoRefresh = true
            autoLoadFromStorage = true
            autoSaveToStorage = true
            sessionManager = SecureSupabaseSessionManager(appContext)
            codeVerifierCache = SecureCodeVerifierCache(appContext)
        }
    }

    suspend fun signIn(activity: Activity): NativeAuthSession {
        requireConfigured()
        val rawNonce = ByteArray(32).also(SecureRandom()::nextBytes)
            .let { Base64.encodeToString(it, Base64.NO_WRAP or Base64.URL_SAFE or Base64.NO_PADDING) }
        val hashedNonce = MessageDigest.getInstance("SHA-256").digest(rawNonce.toByteArray())
            .joinToString("") { "%02x".format(it) }
        val option = GetGoogleIdOption.Builder()
            .setFilterByAuthorizedAccounts(false)
            .setAutoSelectEnabled(false)
            .setServerClientId(googleWebClientId)
            .setNonce(hashedNonce)
            .build()
        val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
        val credential = try {
            credentialManager.getCredential(activity, request).credential
        } catch (_: GetCredentialCancellationException) {
            throw NativeAuthCancelled()
        }
        if (credential !is CustomCredential || credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
            throw NativeAuthRejected()
        }
        val idToken = GoogleIdTokenCredential.createFrom(credential.data).idToken
        try {
            supabase.auth.signInWith(IDToken) {
                provider = Google
                this.idToken = idToken
                nonce = rawNonce
            }
            val webSession = createExistingWebSession(idToken)
            return linkCanonicalIdentity(webSession)
        } catch (error: Exception) {
            runCatching { supabase.auth.signOut() }
            throw error
        }
    }

    suspend fun restore(): NativeAuthSession? {
        requireConfigured()
        supabase.auth.awaitInitialization()
        if (supabase.auth.currentSessionOrNull() == null) return null
        return runCatching { resolveCanonicalIdentity() }.recoverCatching {
            supabase.auth.refreshCurrentSession()
            resolveCanonicalIdentity()
        }.getOrNull()
    }

    suspend fun refresh(): NativeAuthSession {
        supabase.auth.refreshCurrentSession()
        return resolveCanonicalIdentity()
    }

    suspend fun signOut() {
        runCatching { supabase.auth.signOut() }
        runCatching { credentialManager.clearCredentialState(ClearCredentialStateRequest()) }
    }

    private suspend fun createExistingWebSession(idToken: String): String = withContext(Dispatchers.IO) {
        val response = postJson(
            webAuthApiUrl,
            JSONObject().put("action", "createSession").put("idToken", idToken).toString(),
            null,
        )
        val root = JSONObject(response)
        val first = unwrap(root)
        val second = unwrap(first)
        second.optString("sessionToken").takeIf { it.isNotBlank() } ?: throw NativeAuthRejected()
    }

    private suspend fun linkCanonicalIdentity(webSession: String): NativeAuthSession = withContext(Dispatchers.IO) {
        val token = currentAccessToken()
        val response = postJson(
            "$betaApiBaseUrl/v1/mobile/native-auth/link",
            JSONObject().put("web_session_token", webSession).toString(),
            token,
        )
        parseNativeSession(JSONObject(response), token)
    }

    private suspend fun resolveCanonicalIdentity(): NativeAuthSession = withContext(Dispatchers.IO) {
        val token = currentAccessToken()
        val connection = connection("$betaApiBaseUrl/v1/mobile/native-auth/session", "GET", token)
        connection.useResponse { status, body ->
            if (status !in 200..299) throw NativeAuthRejected()
            parseNativeSession(JSONObject(body), token)
        }
    }

    private fun currentAccessToken(): String = supabase.auth.currentSessionOrNull()?.accessToken ?: throw NativeAuthRejected()

    private fun parseNativeSession(json: JSONObject, accessToken: String): NativeAuthSession {
        val canonical = json.optString("canonical_user_id")
        if (!canonical.matches(Regex("^[0-9a-fA-F-]{36}$"))) throw NativeAuthRejected()
        return NativeAuthSession(canonical.lowercase(), accessToken)
    }

    private fun postJson(url: String, body: String, bearer: String?): String {
        val connection = connection(url, "POST", bearer).apply {
            doOutput = true
            setRequestProperty("Content-Type", if (url == webAuthApiUrl) "text/plain;charset=utf-8" else "application/json")
            outputStream.use { it.write(body.toByteArray()) }
        }
        return connection.useResponse { status, response ->
            if (status !in 200..299) throw NativeAuthRejected()
            response
        }
    }

    private fun connection(url: String, method: String, bearer: String?): HttpURLConnection =
        (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 15_000
            readTimeout = 20_000
            bearer?.let { setRequestProperty("Authorization", "Bearer $it") }
        }

    private inline fun <T> HttpURLConnection.useResponse(block: (Int, String) -> T): T = try {
        val status = responseCode
        val stream = if (status in 200..299) inputStream else errorStream
        block(status, stream?.bufferedReader()?.use { it.readText() }.orEmpty())
    } finally {
        disconnect()
    }

    private fun unwrap(value: JSONObject): JSONObject {
        for (key in listOf("data", "result")) {
            val nested = value.optJSONObject(key)
            if (nested != null) return nested
        }
        return value
    }

    private fun requireConfigured() {
        if (!supabaseUrl.startsWith("https://") || supabaseUrl.contains(".invalid")
            || !betaApiBaseUrl.startsWith("https://") || betaApiBaseUrl.contains(".invalid")
            || !webAuthApiUrl.startsWith("https://") || webAuthApiUrl.contains(".invalid")
            || !googleWebClientId.endsWith(".apps.googleusercontent.com")
            || publishableKey == "missing" || publishableKey.isBlank()
        ) throw NativeAuthConfiguration()
    }
}
