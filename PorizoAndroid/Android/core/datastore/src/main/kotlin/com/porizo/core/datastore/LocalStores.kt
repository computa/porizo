package com.porizo.core.datastore

import android.content.Context
import com.porizo.core.model.CreateDraft
import com.porizo.core.model.PendingRender

class CreateDraftStore(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun load(): CreateDraft? {
        val recipientName = preferences.getString(KEY_RECIPIENT_NAME, null) ?: return null
        return CreateDraft(
            recipientName = recipientName,
            occasionRawValue = preferences.getString(KEY_OCCASION, "") ?: "",
            voiceSourceRawValue = preferences.getString(KEY_VOICE_SOURCE, "") ?: "",
            tone = preferences.getString(KEY_TONE, "") ?: "",
            message = preferences.getString(KEY_MESSAGE, "") ?: "",
            targetDuration = Double.fromBits(preferences.getLong(KEY_TARGET_DURATION_BITS, 0L)),
            includeNameHook = preferences.getBoolean(KEY_INCLUDE_NAME_HOOK, false),
            appOnlySave = preferences.getBoolean(KEY_APP_ONLY_SAVE, true),
            updatedAt = preferences.getString(KEY_UPDATED_AT, "") ?: "",
        )
    }

    fun save(draft: CreateDraft) {
        preferences.edit()
            .putString(KEY_RECIPIENT_NAME, draft.recipientName)
            .putString(KEY_OCCASION, draft.occasionRawValue)
            .putString(KEY_VOICE_SOURCE, draft.voiceSourceRawValue)
            .putString(KEY_TONE, draft.tone)
            .putString(KEY_MESSAGE, draft.message)
            .putLong(KEY_TARGET_DURATION_BITS, draft.targetDuration.toBits())
            .putBoolean(KEY_INCLUDE_NAME_HOOK, draft.includeNameHook)
            .putBoolean(KEY_APP_ONLY_SAVE, draft.appOnlySave)
            .putString(KEY_UPDATED_AT, draft.updatedAt)
            .apply()
    }

    fun clear() {
        preferences.edit().clear().apply()
    }

    private companion object {
        const val PREFS_NAME = "porizo_create_draft"
        const val KEY_RECIPIENT_NAME = "recipient_name"
        const val KEY_OCCASION = "occasion"
        const val KEY_VOICE_SOURCE = "voice_source"
        const val KEY_TONE = "tone"
        const val KEY_MESSAGE = "message"
        const val KEY_TARGET_DURATION_BITS = "target_duration_bits"
        const val KEY_INCLUDE_NAME_HOOK = "include_name_hook"
        const val KEY_APP_ONLY_SAVE = "app_only_save"
        const val KEY_UPDATED_AT = "updated_at"
    }
}

class RenderPollStore(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun load(): PendingRender? {
        val trackId = preferences.getString(KEY_TRACK_ID, null) ?: return null
        val jobId = preferences.getString(KEY_JOB_ID, null) ?: return null
        return PendingRender(
            trackId = trackId,
            versionNum = preferences.getInt(KEY_VERSION_NUM, 1),
            jobId = jobId,
            renderType = preferences.getString(KEY_RENDER_TYPE, "preview") ?: "preview",
            updatedAt = preferences.getString(KEY_UPDATED_AT, "") ?: "",
        )
    }

    fun save(pending: PendingRender) {
        preferences.edit()
            .putString(KEY_TRACK_ID, pending.trackId)
            .putInt(KEY_VERSION_NUM, pending.versionNum)
            .putString(KEY_JOB_ID, pending.jobId)
            .putString(KEY_RENDER_TYPE, pending.renderType)
            .putString(KEY_UPDATED_AT, pending.updatedAt)
            .apply()
    }

    fun clear() {
        preferences.edit().clear().apply()
    }

    private companion object {
        const val PREFS_NAME = "porizo_pending_render"
        const val KEY_TRACK_ID = "track_id"
        const val KEY_VERSION_NUM = "version_num"
        const val KEY_JOB_ID = "job_id"
        const val KEY_RENDER_TYPE = "render_type"
        const val KEY_UPDATED_AT = "updated_at"
    }
}
