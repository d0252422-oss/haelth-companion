package app.healthcompanion.sync

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.Signature
import java.security.interfaces.ECPublicKey

class IdentityBootstrap(private val context: Context, private val baseUrl: String, private val authSetupUrl: String) {
    private val alias = "health-sync-installation-ec"

    fun setupIntent(): Intent {
        requireConfigured(authSetupUrl)
        val fingerprint = MessageDigest.getInstance("SHA-256").digest(publicKey().encoded).joinToString("") { "%02x".format(it) }
        val uri = Uri.parse(authSetupUrl).buildUpon()
            .appendQueryParameter("connector_setup", "android")
            .appendQueryParameter("environment", "beta")
            .appendQueryParameter("installation_key_fingerprint", fingerprint)
            .appendQueryParameter("return_uri", "healthcompanion-beta://auth/bootstrap")
            .build()
        return Intent(Intent.ACTION_VIEW, uri)
    }

    fun claimFrom(intent: Intent?): String? = intent?.data?.fragment
        ?.split('&')?.mapNotNull { item -> item.split('=', limit = 2).takeIf { it.size == 2 } }
        ?.firstOrNull { it[0] == "claim" }?.get(1)?.let(Uri::decode)

    fun exchange(claim: String): AppSession {
        requireConfigured(baseUrl)
        val signer = Signature.getInstance("SHA256withECDSA").apply { initSign(privateKey()); update(claim.toByteArray()) }
        val body = JSONObject().put("claim", claim).put("installation_public_key", Base64.encodeToString(publicKey().encoded, Base64.NO_WRAP)).put("signature", Base64.encodeToString(signer.sign(), Base64.NO_WRAP)).toString()
        val connection = (URL("$baseUrl/v1/mobile/install-claims/exchange").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"; connectTimeout = 15_000; readTimeout = 15_000; doOutput = true
            setRequestProperty("Content-Type", "application/json")
        }
        connection.outputStream.use { it.write(body.toByteArray()) }
        require(connection.responseCode in 200..299) { "CLAIM_EXCHANGE_FAILED" }
        val result = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
        return parseSession(result)
    }

    fun refresh(session: AppSession): AppSession {
        requireConfigured(baseUrl)
        val message = "${session.sessionId}\u001f${session.refreshToken}"
        val signer = Signature.getInstance("SHA256withECDSA").apply { initSign(privateKey()); update(message.toByteArray()) }
        val body = JSONObject().put("session_id", session.sessionId).put("refresh_token", session.refreshToken)
            .put("signature", Base64.encodeToString(signer.sign(), Base64.NO_WRAP)).toString()
        val connection = post("$baseUrl/v1/mobile/sessions/refresh", body)
        require(connection.responseCode in 200..299) { "SESSION_REFRESH_FAILED" }
        return parseSession(JSONObject(connection.inputStream.bufferedReader().use { it.readText() }))
    }

    fun logout(session: AppSession) {
        requireConfigured(baseUrl)
        val connection = (URL("$baseUrl/v1/mobile/sessions/current").openConnection() as HttpURLConnection).apply {
            requestMethod = "DELETE"; connectTimeout = 15_000; readTimeout = 15_000
            setRequestProperty("Authorization", "Bearer ${session.accessToken}")
            setRequestProperty("X-App-Session-Id", session.sessionId)
        }
        require(connection.responseCode in 200..299) { "SESSION_REVOKE_FAILED" }
    }

    private fun post(url: String, body: String): HttpURLConnection = (URL(url).openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"; connectTimeout = 15_000; readTimeout = 15_000; doOutput = true
        setRequestProperty("Content-Type", "application/json")
        outputStream.use { it.write(body.toByteArray()) }
    }

    private fun parseSession(result: JSONObject) = AppSession(
        result.getString("canonical_user_id"), result.getString("session_id"),
        result.getString("access_token"), result.getString("refresh_token"),
        java.time.Instant.parse(result.getString("expires_at")).toEpochMilli(),
    )

    private fun requireConfigured(url: String) = require(url.startsWith("https://") && !url.contains(".invalid")) { "STAGING_ENDPOINT_NOT_CONFIGURED" }
    private fun store() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private fun publicKey(): ECPublicKey {
        val existing = store().getCertificate(alias)?.publicKey as? ECPublicKey
        if (existing != null) return existing
        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
        generator.initialize(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY).setDigests(KeyProperties.DIGEST_SHA256).build())
        return generator.generateKeyPair().public as ECPublicKey
    }
    private fun privateKey() = store().getKey(alias, null) as java.security.PrivateKey
}
