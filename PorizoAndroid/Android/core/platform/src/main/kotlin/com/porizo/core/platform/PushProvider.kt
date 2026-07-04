package com.porizo.core.platform

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.porizo.core.domain.platform.PushGateway
import com.onesignal.OneSignal
import com.onesignal.debug.LogLevel
import com.onesignal.notifications.INotificationClickEvent
import com.onesignal.notifications.INotificationClickListener
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class PushProvider @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val activityHolder: ActivityHolder,
    private val tapStore: PushTapStore,
) : PushGateway {
    private var initializedAppId: String? = null

    override fun initialize(appId: String, verbose: Boolean): String {
        if (appId.isBlank()) {
            return "OneSignal app id is not configured."
        }
        if (initializedAppId == appId) {
            return "OneSignal already initialized."
        }

        return try {
            if (verbose) {
                OneSignal.Debug.logLevel = LogLevel.VERBOSE
            }
            OneSignal.initWithContext(context.applicationContext, appId)
            OneSignal.Notifications.addClickListener(object : INotificationClickListener {
                override fun onClick(event: INotificationClickEvent) {
                    event.notification.additionalData?.toString()?.let(tapStore::save)
                }
            })
            initializedAppId = appId
            "OneSignal initialized."
        } catch (error: Throwable) {
            initializedAppId = null
            "OneSignal initialization failed: ${error.message ?: error.javaClass.simpleName}"
        }
    }

    override fun login(userId: String): String {
        if (userId.isBlank()) {
            return "No user id supplied for OneSignal login."
        }
        return try {
            OneSignal.login(userId)
            "OneSignal external id set."
        } catch (error: Throwable) {
            "OneSignal login failed: ${error.message ?: error.javaClass.simpleName}"
        }
    }

    override fun logout(): String {
        return try {
            OneSignal.logout()
            "OneSignal user logged out."
        } catch (error: Throwable) {
            "OneSignal logout failed: ${error.message ?: error.javaClass.simpleName}"
        }
    }

    override fun optIn(): String =
        try {
            OneSignal.User.pushSubscription.optIn()
            "OneSignal push subscription opted in."
        } catch (error: Throwable) {
            "OneSignal opt-in failed: ${error.message ?: error.javaClass.simpleName}"
        }

    override fun requestNotificationPermission(): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return "Notification runtime permission is not required on this Android version."
        }
        val activity = activityHolder.current()
            ?: return "Open the app foreground before requesting notification permission."
        val permission = Manifest.permission.POST_NOTIFICATIONS
        if (ContextCompat.checkSelfPermission(activity, permission) == PackageManager.PERMISSION_GRANTED) {
            return "Notification permission already granted."
        }
        ActivityCompat.requestPermissions(activity, arrayOf(permission), NOTIFICATION_REQUEST_CODE)
        return "Notification permission requested."
    }

    override fun pushToken(): String? =
        runCatching { OneSignal.User.pushSubscription.token }.getOrNull()

    override fun subscriptionId(): String? =
        runCatching { OneSignal.User.pushSubscription.id }.getOrNull()

    private companion object {
        const val NOTIFICATION_REQUEST_CODE = 3101
    }
}
