package porizo.skip.spike

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.onesignal.OneSignal
import com.onesignal.debug.LogLevel
import com.onesignal.notifications.INotificationClickEvent
import com.onesignal.notifications.INotificationClickListener
import org.json.JSONObject

object PorizoNativePushBridge {
    private const val notificationRequestCode = 3101
    private var initializedAppId: String? = null
    private var currentActivity: Activity? = null
    /// Set by the Swift layer to receive a tapped notification's payload JSON.
    private var onTap: ((String) -> Unit)? = null

    fun setActivity(activity: Activity?) {
        currentActivity = activity
    }

    /// Register the Swift tap handler (U14). Invoked with the notification's
    /// additionalData JSON when a notification is opened.
    fun setTapHandler(handler: (String) -> Unit) {
        onTap = handler
    }

    fun initialize(context: Context, appId: String, verbose: Boolean): String {
        if (appId.isBlank()) {
            return "OneSignal app id is not configured."
        }
        if (initializedAppId == appId) {
            return "OneSignal already initialized."
        }

        if (verbose) {
            OneSignal.Debug.logLevel = LogLevel.VERBOSE
        }
        OneSignal.initWithContext(context.applicationContext, appId)
        initializedAppId = appId

        // Forward notification taps to Swift with the payload's additionalData
        // (render_complete / recipient_played). Delivery is dashboard-configured.
        OneSignal.Notifications.addClickListener(object : INotificationClickListener {
            override fun onClick(event: INotificationClickEvent) {
                val data: JSONObject? = event.notification.additionalData
                if (data != null) {
                    onTap?.invoke(data.toString())
                }
            }
        })
        return "OneSignal initialized."
    }

    fun login(userId: String): String {
        if (userId.isBlank()) {
            return "No user id supplied for OneSignal login."
        }
        OneSignal.login(userId)
        return "OneSignal external id set."
    }

    fun logout(): String {
        OneSignal.logout()
        return "OneSignal user logged out."
    }

    fun optIn(): String {
        return try {
            OneSignal.User.pushSubscription.optIn()
            "OneSignal push subscription opted in."
        } catch (error: Throwable) {
            "OneSignal opt-in failed: ${error.message ?: error.javaClass.simpleName}"
        }
    }

    fun requestNotificationPermission(): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return "Notification runtime permission is not required on this Android version."
        }
        val activity = currentActivity ?: return "Open the app foreground before requesting notification permission."
        val permission = Manifest.permission.POST_NOTIFICATIONS
        if (ContextCompat.checkSelfPermission(activity, permission) == PackageManager.PERMISSION_GRANTED) {
            return "Notification permission already granted."
        }
        ActivityCompat.requestPermissions(activity, arrayOf(permission), notificationRequestCode)
        return "Notification permission requested."
    }

    fun pushToken(): String? {
        return try {
            OneSignal.User.pushSubscription.token
        } catch (_: Throwable) {
            null
        }
    }

    fun subscriptionId(): String? {
        return try {
            OneSignal.User.pushSubscription.id
        } catch (_: Throwable) {
            null
        }
    }
}
