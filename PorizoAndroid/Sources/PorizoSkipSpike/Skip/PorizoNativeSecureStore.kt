package porizo.skip.spike

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

object PorizoNativeSecureStore {
    private const val keyAlias = "porizo_android_secure_store_v1"
    private const val prefsName = "porizo_android_secure_store"
    private const val transformation = "AES/GCM/NoPadding"
    private const val gcmTagBits = 128

    fun getString(context: Context, key: String): String? {
        val payload = context.applicationContext
            .getSharedPreferences(prefsName, Context.MODE_PRIVATE)
            .getString(key, null)
            ?: return null
        val pieces = payload.split(":", limit = 2)
        if (pieces.size != 2) {
            removeString(context, key)
            return null
        }

        return try {
            val iv = Base64.decode(pieces[0], Base64.NO_WRAP)
            val ciphertext = Base64.decode(pieces[1], Base64.NO_WRAP)
            val cipher = Cipher.getInstance(transformation)
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(gcmTagBits, iv))
            String(cipher.doFinal(ciphertext), Charsets.UTF_8)
        } catch (_: Exception) {
            removeString(context, key)
            null
        }
    }

    fun setString(context: Context, key: String, value: String) {
        val cipher = Cipher.getInstance(transformation)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val ciphertext = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val payload = Base64.encodeToString(cipher.iv, Base64.NO_WRAP) +
            ":" +
            Base64.encodeToString(ciphertext, Base64.NO_WRAP)
        context.applicationContext
            .getSharedPreferences(prefsName, Context.MODE_PRIVATE)
            .edit()
            .putString(key, payload)
            .apply()
    }

    fun removeString(context: Context, key: String) {
        context.applicationContext
            .getSharedPreferences(prefsName, Context.MODE_PRIVATE)
            .edit()
            .remove(key)
            .apply()
    }

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore")
        keyStore.load(null)
        if (keyStore.containsAlias(keyAlias)) {
            val entry = keyStore.getEntry(keyAlias, null) as KeyStore.SecretKeyEntry
            return entry.secretKey
        }

        val keyGenerator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            "AndroidKeyStore"
        )
        val spec = KeyGenParameterSpec.Builder(
            keyAlias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build()
        keyGenerator.init(spec)
        return keyGenerator.generateKey()
    }
}
