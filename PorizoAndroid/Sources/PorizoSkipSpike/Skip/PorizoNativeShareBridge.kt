package porizo.skip.spike

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri

/// Native share bridge (KTD3). Fires the Android system share chooser
/// (ACTION_SEND — surfaces every installed target: SMS/WhatsApp/IG/Mail/…) and,
/// for the one-tap "Send to {name}" path, a direct SMS intent addressed to a
/// captured phone. Requires a foreground Activity (wired via setActivity in
/// MainActivity's onCreate/onResume). Returns a pipe-delimited "OK|…"/"ERR|…".
object PorizoNativeShareBridge {
    private var currentActivity: Activity? = null

    fun setActivity(activity: Activity?) {
        currentActivity = activity
    }

    /// Open the system share sheet with plain text (the message body carrying
    /// the share link). Falls back to an error string if no Activity is present.
    fun shareText(text: String): String {
        val activity = currentActivity ?: return "ERR|Open the app foreground before sharing."
        return try {
            val send = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_TEXT, text)
            }
            activity.startActivity(Intent.createChooser(send, null))
            "OK|shared"
        } catch (error: Throwable) {
            "ERR|${error.message ?: error.javaClass.simpleName}"
        }
    }

    /// Open the SMS composer pre-addressed to `phone` with `body`. Falls back to
    /// the system share sheet if no SMS app can handle the intent.
    fun sendSms(phone: String, body: String): String {
        val activity = currentActivity ?: return "ERR|Open the app foreground before sending."
        return try {
            val uri = Uri.parse("smsto:$phone")
            val sms = Intent(Intent.ACTION_SENDTO, uri).apply {
                putExtra("sms_body", body)
            }
            activity.startActivity(sms)
            "OK|sms"
        } catch (_: ActivityNotFoundException) {
            shareText(body)
        } catch (error: Throwable) {
            "ERR|${error.message ?: error.javaClass.simpleName}"
        }
    }

    /// Copy text to the clipboard (the "Copy link" share target).
    fun copyToClipboard(text: String): String {
        val activity = currentActivity ?: return "ERR|Open the app foreground before copying."
        return try {
            val clipboard = activity.getSystemService(android.content.Context.CLIPBOARD_SERVICE)
                as android.content.ClipboardManager
            clipboard.setPrimaryClip(android.content.ClipData.newPlainText("Porizo link", text))
            "OK|copied"
        } catch (error: Throwable) {
            "ERR|${error.message ?: error.javaClass.simpleName}"
        }
    }
}
