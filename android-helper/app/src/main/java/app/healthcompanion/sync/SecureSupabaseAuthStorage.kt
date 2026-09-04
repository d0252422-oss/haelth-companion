package app.healthcompanion.sync

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import io.github.jan.supabase.auth.CodeVerifierCache
import io.github.jan.supabase.auth.SessionManager
import io.github.jan.supabase.auth.user.UserSession
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal class EncryptedValueStore(
    context: Context,
    preferencesName: String,
    private val alias: String,
) {
    private val preferences = context.getSharedPreferences(preferencesName, Context.MODE_PRIVATE)

    fun save(name: String, value: String) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        preferences.edit()
            .putString("${name}_ciphertext", Base64.encodeToString(cipher.doFinal(value.toByteArray()), Base64.NO_WRAP))
            .putString("${name}_iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .apply()
    }

    fun load(name: String): String? = runCatching {
        val ciphertext = Base64.decode(preferences.getString("${name}_ciphertext", null) ?: return null, Base64.NO_WRAP)
        val iv = Base64.decode(preferences.getString("${name}_iv", null) ?: return null, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
        String(cipher.doFinal(ciphertext))
    }.getOrNull()

    fun delete(name: String) {
        preferences.edit().remove("${name}_ciphertext").remove("${name}_iv").apply()
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build(),
        )
        return generator.generateKey()
    }
}

class SecureSupabaseSessionManager(context: Context) : SessionManager {
    private val store = EncryptedValueStore(context, "supabase_auth_secure", "health-sync-supabase-auth-aes")
    private val json = Json { encodeDefaults = true; ignoreUnknownKeys = true }

    override suspend fun saveSession(session: UserSession) = store.save(SESSION, json.encodeToString(session))
    override suspend fun loadSession(): UserSession? = store.load(SESSION)?.let { runCatching { json.decodeFromString<UserSession>(it) }.getOrNull() }
    override suspend fun deleteSession() = store.delete(SESSION)

    private companion object { const val SESSION = "session" }
}

class SecureCodeVerifierCache(context: Context) : CodeVerifierCache {
    private val store = EncryptedValueStore(context, "supabase_pkce_secure", "health-sync-supabase-pkce-aes")

    override suspend fun saveCodeVerifier(codeVerifier: String) = store.save(VERIFIER, codeVerifier)
    override suspend fun loadCodeVerifier(): String? = store.load(VERIFIER)
    override suspend fun deleteCodeVerifier() = store.delete(VERIFIER)

    private companion object { const val VERIFIER = "verifier" }
}
