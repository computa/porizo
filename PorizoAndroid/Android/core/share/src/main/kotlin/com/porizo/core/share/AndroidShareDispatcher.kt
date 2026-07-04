package com.porizo.core.share

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import com.porizo.core.domain.share.ShareDispatchResult
import com.porizo.core.domain.share.ShareDispatcher
import com.porizo.core.domain.share.ShareLogic
import com.porizo.core.model.CreateContentType

class AndroidShareDispatcher(
    context: Context,
) : ShareDispatcher {
    private val appContext = context.applicationContext

    override fun sendGift(
        recipientName: String,
        phone: String?,
        link: String,
        contentType: CreateContentType,
    ): ShareDispatchResult {
        val body = ShareLogic.messageBody(
            recipientName = recipientName,
            link = link,
            contentType = contentType,
        )
        return when (val channel = ShareLogic.sendChannel(phone)) {
            is ShareLogic.SendChannel.Sms -> {
                if (sendSms(channel.phone, body)) {
                    ShareDispatchResult.SentSms
                } else if (shareText(body)) {
                    ShareDispatchResult.OpenedShareSheet
                } else {
                    ShareDispatchResult.Failed
                }
            }
            ShareLogic.SendChannel.ShareSheet -> {
                if (shareText(body)) ShareDispatchResult.OpenedShareSheet else ShareDispatchResult.Failed
            }
        }
    }

    fun shareText(text: String): Boolean =
        startActivity(
            Intent.createChooser(
                Intent(Intent.ACTION_SEND)
                    .setType("text/plain")
                    .putExtra(Intent.EXTRA_TEXT, text),
                "Share Porizo gift",
            ),
        )

    fun sendSms(phone: String, body: String): Boolean =
        startActivity(
            Intent(Intent.ACTION_SENDTO)
                .setData(Uri.parse(ShareLogic.smsUri(phone, body)))
                .putExtra("sms_body", body),
        )

    override fun copyToClipboard(text: String): Boolean {
        val clipboard = appContext.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return false
        clipboard.setPrimaryClip(ClipData.newPlainText("Porizo gift link", text))
        return true
    }

    private fun startActivity(intent: Intent): Boolean =
        try {
            appContext.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            true
        } catch (_: ActivityNotFoundException) {
            false
        } catch (_: SecurityException) {
            false
        }
}
