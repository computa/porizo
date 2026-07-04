package com.porizo.core.domain.share

import com.porizo.core.model.CreateContentType
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

object ShareLogic {
    sealed interface SendChannel {
        data class Sms(val phone: String) : SendChannel
        data object ShareSheet : SendChannel
    }

    fun messageBody(recipientName: String, link: String, contentType: CreateContentType): String {
        val name = recipientName.trim()
        val noun = when (contentType) {
            CreateContentType.Poem -> "poem \u270D\uFE0F"
            CreateContentType.Song -> "song \uD83C\uDFB5"
        }
        val lead = if (name.isEmpty()) {
            "I made you a $noun"
        } else {
            "I made you a $noun $name"
        }
        return "$lead \u2014 open it here: $link"
    }

    fun sendChannel(phone: String?): SendChannel =
        phone?.takeIf { it.trim().isNotEmpty() }?.let {
            SendChannel.Sms(phone = it)
        } ?: run {
            SendChannel.ShareSheet
        }

    fun smsUri(phone: String, body: String): String {
        val encoded = URLEncoder.encode(body, StandardCharsets.UTF_8.name())
        return "smsto:$phone?body=$encoded"
    }
}
