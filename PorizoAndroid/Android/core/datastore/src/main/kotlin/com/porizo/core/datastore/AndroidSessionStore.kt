package com.porizo.core.datastore

import android.content.Context
import com.porizo.core.model.AuthSession
import java.time.Instant
import java.util.UUID

class AndroidSessionStore(
    context: Context,
    private val secureStore: SecureStringStore = AndroidKeystoreStringStore(context),
) {
    private val preferences = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun getOrCreateDeviceId(): String {
        preferences.getString(KEY_DEVICE_ID, null)
            ?.takeIf { it.isNotBlank() }
            ?.let { return it }

        val generated = "android_${UUID.randomUUID().toString().lowercase().take(12)}"
        preferences.edit().putString(KEY_DEVICE_ID, generated).apply()
        return generated
    }

    fun loadAuthSession(): AuthSession? {
        val userId = secureStore.getString(KEY_AUTH_USER_ID)?.takeIf { it.isNotBlank() } ?: return null
        val accessToken = secureStore.getString(KEY_AUTH_ACCESS_TOKEN)?.takeIf { it.isNotBlank() } ?: return null
        val refreshToken = secureStore.getString(KEY_AUTH_REFRESH_TOKEN)?.takeIf { it.isNotBlank() } ?: return null
        val expiresIn = secureStore.getString(KEY_AUTH_EXPIRES_IN)?.toIntOrNull() ?: DEFAULT_EXPIRES_IN
        val issuedAt = secureStore.getString(KEY_AUTH_ISSUED_AT)?.toLongOrNull() ?: 0L
        return AuthSession(userId, accessToken, refreshToken, expiresIn, issuedAt)
    }

    fun saveAuthSession(session: AuthSession) {
        val issuedAt = session.issuedAtEpochSeconds.takeIf { it > 0L } ?: Instant.now().epochSecond
        secureStore.putString(KEY_AUTH_USER_ID, session.userId)
        secureStore.putString(KEY_AUTH_ACCESS_TOKEN, session.accessToken)
        secureStore.putString(KEY_AUTH_REFRESH_TOKEN, session.refreshToken)
        secureStore.putString(KEY_AUTH_EXPIRES_IN, session.expiresInSeconds.toString())
        secureStore.putString(KEY_AUTH_ISSUED_AT, issuedAt.toString())
    }

    fun clearAuthSession() {
        secureStore.removeString(KEY_AUTH_USER_ID)
        secureStore.removeString(KEY_AUTH_ACCESS_TOKEN)
        secureStore.removeString(KEY_AUTH_REFRESH_TOKEN)
        secureStore.removeString(KEY_AUTH_EXPIRES_IN)
        secureStore.removeString(KEY_AUTH_ISSUED_AT)
    }

    fun currentAccessToken(): String? = loadAuthSession()?.accessToken

    fun currentDeviceToken(): String? =
        secureStore.getString(KEY_DEVICE_TOKEN)?.takeIf { it.isNotBlank() }

    fun loadDeviceTokenExpiry(): String? =
        secureStore.getString(KEY_DEVICE_TOKEN_EXPIRY)?.takeIf { it.isNotBlank() }

    fun saveDeviceToken(token: String, expiresAt: String) {
        secureStore.putString(KEY_DEVICE_TOKEN, token)
        secureStore.putString(KEY_DEVICE_TOKEN_EXPIRY, expiresAt)
    }

    fun clearDeviceToken() {
        secureStore.removeString(KEY_DEVICE_TOKEN)
        secureStore.removeString(KEY_DEVICE_TOKEN_EXPIRY)
    }

    private companion object {
        const val DEFAULT_EXPIRES_IN = 3600
        const val PREFS_NAME = "porizo_session_store"
        const val KEY_DEVICE_ID = "porizo_android_device_id"
        const val KEY_AUTH_USER_ID = "porizo_android_auth_user_id"
        const val KEY_AUTH_ACCESS_TOKEN = "porizo_android_auth_access_token"
        const val KEY_AUTH_REFRESH_TOKEN = "porizo_android_auth_refresh_token"
        const val KEY_AUTH_EXPIRES_IN = "porizo_android_auth_expires_in"
        const val KEY_AUTH_ISSUED_AT = "porizo_android_auth_issued_at"
        const val KEY_DEVICE_TOKEN = "porizo_android_device_token"
        const val KEY_DEVICE_TOKEN_EXPIRY = "porizo_android_device_token_expiry"
    }
}
