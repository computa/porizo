package com.porizo.core.datastore

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.porizo.core.domain.repository.PendingMagicLoginStore
import com.porizo.core.model.PendingMagicLogin
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

interface SecureStringStore {
    fun getString(key: String): String?
    fun putString(key: String, value: String)
    fun removeString(key: String)
}

class AndroidPendingMagicLoginStore(
    context: Context,
    private val secureStore: SecureStringStore = AndroidKeystoreStringStore(
        context = context,
        keyAlias = "porizo_android_magic_login_key",
        preferencesName = PREFERENCES_NAME,
    ),
) : PendingMagicLoginStore {
    override fun save(pending: PendingMagicLogin, requestSecret: String) {
        require(pending.transactionId.isNotBlank() && pending.email.isNotBlank() && requestSecret.isNotBlank())
        val candidates = ids().filterNot { it == pending.transactionId }.plus(pending.transactionId)
        val ids = candidates.takeLast(MAX_PENDING)
        candidates.dropLast(MAX_PENDING).forEach { evictedId ->
            secureStore.removeString(secretKey(evictedId))
        }
        secureStore.putString(secretKey(pending.transactionId), requestSecret)
        secureStore.putString(INDEX_KEY, ids.joinToString("\n"))
        secureStore.putString(
            PRESENTATION_KEY,
            listOf(
                pending.transactionId,
                pending.email,
                pending.expiresAt,
                pending.resendAvailableAtEpochSeconds.toString(),
            ).joinToString("\n"),
        )
    }

    override fun getPending(): PendingMagicLogin? {
        val parts = secureStore.getString(PRESENTATION_KEY)?.split("\n") ?: return null
        if (parts.size != 4) return null
        return PendingMagicLogin(
            transactionId = parts[0].takeIf(String::isNotBlank) ?: return null,
            email = parts[1].takeIf(String::isNotBlank) ?: return null,
            expiresAt = parts[2].takeIf(String::isNotBlank) ?: return null,
            resendAvailableAtEpochSeconds = parts[3].toLongOrNull() ?: return null,
        )
    }

    override fun getRequestSecret(transactionId: String): String? = secureStore.getString(secretKey(transactionId))

    override fun remove(transactionId: String) {
        secureStore.removeString(secretKey(transactionId))
        secureStore.putString(INDEX_KEY, ids().filterNot { it == transactionId }.joinToString("\n"))
        if (getPending()?.transactionId == transactionId) {
            secureStore.removeString(PRESENTATION_KEY)
        }
    }

    private fun ids(): List<String> = secureStore.getString(INDEX_KEY)
        .orEmpty().lineSequence().filter { it.isNotBlank() }.toList()

    private fun secretKey(transactionId: String) = "magic_request_secret_$transactionId"

    companion object {
        const val PREFERENCES_NAME = "porizo_magic_login_secure_store"
        private const val INDEX_KEY = "magic_transaction_index"
        private const val PRESENTATION_KEY = "magic_pending_presentation"
        private const val MAX_PENDING = 8
    }
}

class AndroidKeystoreStringStore(
    context: Context,
    private val keyAlias: String = "porizo_android_secure_store_key",
    preferencesName: String = "porizo_secure_store",
) : SecureStringStore {
    private val preferences: SharedPreferences =
        context.applicationContext.getSharedPreferences(preferencesName, Context.MODE_PRIVATE)

    override fun getString(key: String): String? {
        val encoded = preferences.getString(key, null) ?: return null
        return runCatching { decrypt(encoded) }.getOrNull()
    }

    override fun putString(key: String, value: String) {
        preferences.edit().putString(key, encrypt(value)).apply()
    }

    override fun removeString(key: String) {
        preferences.edit().remove(key).apply()
    }

    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateSecretKey())
        val cipherText = cipher.doFinal(value.toByteArray(StandardCharsets.UTF_8))
        return listOf(
            VERSION,
            Base64.encodeToString(cipher.iv, Base64.NO_WRAP),
            Base64.encodeToString(cipherText, Base64.NO_WRAP),
        ).joinToString(":")
    }

    private fun decrypt(value: String): String {
        val parts = value.split(":")
        require(parts.size == 3 && parts[0] == VERSION) { "Unsupported encrypted value." }
        val iv = Base64.decode(parts[1], Base64.NO_WRAP)
        val cipherText = Base64.decode(parts[2], Base64.NO_WRAP)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateSecretKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
        return String(cipher.doFinal(cipherText), StandardCharsets.UTF_8)
    }

    private fun getOrCreateSecretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (keyStore.getKey(keyAlias, null) as? SecretKey)?.let { return it }

        val keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        val spec = KeyGenParameterSpec.Builder(
            keyAlias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build()
        keyGenerator.init(spec)
        return keyGenerator.generateKey()
    }

    private companion object {
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val GCM_TAG_BITS = 128
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val VERSION = "v1"
    }
}
