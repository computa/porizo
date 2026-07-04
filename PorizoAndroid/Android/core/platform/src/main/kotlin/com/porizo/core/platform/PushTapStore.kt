package com.porizo.core.platform

import android.content.Context
import com.porizo.core.domain.platform.PushRoute
import com.porizo.core.domain.platform.PushRouteStore
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class PushTapStore @Inject constructor(@ApplicationContext context: Context) : PushRouteStore {
    private val preferences = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun save(payloadJson: String) {
        preferences.edit().putString(KEY_PENDING_PUSH, payloadJson).apply()
    }

    override fun consume(): PushRoute? {
        val payload = preferences.getString(KEY_PENDING_PUSH, null)?.takeIf { it.isNotBlank() } ?: return null
        preferences.edit().remove(KEY_PENDING_PUSH).apply()
        return PushRouting.route(payload)
    }

    private companion object {
        const val PREFS_NAME = "porizo_push_taps"
        const val KEY_PENDING_PUSH = "pending_push_payload"
    }
}
