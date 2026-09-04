package com.porizo.core.model

data class RenderResult(
    val trackId: String,
    val audioUrl: String,
    val title: String,
    val recipientName: String?,
    val artworkUrl: String?,
)

data class RenderPreviewResult(
    val jobId: String?,
    val estimatedCompletionSec: Int?,
    val pollUrl: String?,
)

data class RenderFullResult(
    val jobId: String?,
    val estimatedCompletionSec: Int?,
)

data class ApproveLyricsResult(
    val status: String?,
)

data class LyricsDocument(
    val title: String?,
    val style: String?,
    val sections: List<LyricsSection>,
    val anchorLine: String?,
)

data class LyricsSection(
    val name: String,
    val lines: List<String>,
    val startTime: Double? = null,
    val endTime: Double? = null,
)

data class JobStatus(
    val id: String,
    val status: String,
    val progress: Int?,
    val resultUrl: String?,
    val errorCode: String?,
    val errorMessage: String?,
    val errorTerms: List<String>?,
    val errorCategory: String?,
    val errorSubcategory: String?,
    val canAutoRewrite: Boolean?,
    val suggestedAction: String?,
    val provider: String?,
    val step: String?,
    val stepIndex: Int?,
    val workflowType: String?,
    val startedAt: String?,
    val completedAt: String?,
)

data class PendingRender(
    val trackId: String,
    val versionNum: Int,
    val jobId: String,
    val renderType: String,
    val updatedAt: String,
)
