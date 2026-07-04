package com.porizo.core.network

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull

class StoryNetworkContractTest {
    private val moshi = PorizoNetworkClient.moshi()

    @Test
    fun storyDtosDecodeBackendPromptFields() {
        val start = moshi.adapter(StartStoryDto::class.java).fromJson(
            """
            {
              "story_id": "story_1",
              "first_question": "What should the song remember?",
              "complete": false
            }
            """.trimIndent(),
        )
        assertNotNull(start)
        assertEquals("What should the song remember?", start.firstQuestion)

        val next = moshi.adapter(ContinueStoryDto::class.java).fromJson(
            """
            {
              "complete": false,
              "next_question": "What changed after that moment?"
            }
            """.trimIndent(),
        )
        assertNotNull(next)
        assertEquals("What changed after that moment?", next.nextQuestion)
        assertFalse(next.complete ?: true)
    }

    @Test
    fun storyLyricsDecodeStructuredBackendLyrics() {
        val dto = moshi.adapter(StoryLyricsDto::class.java).fromJson(
            """
            {
              "lyrics": {
                "title": "For Sarah",
                "anchor_line": "Sarah, you are home",
                "sections": [
                  { "name": "Verse", "lines": ["You saw me clearly", "You stayed"] },
                  { "name": "Chorus", "lines": ["Sarah, you are home"] }
                ]
              },
              "quality_score": 0.91
            }
            """.trimIndent(),
        )

        assertNotNull(dto)
        val model = dto.toModel()
        assertEquals(0.91, model.qualityScore)
        assertEquals(
            """
            For Sarah

            [Verse]
            You saw me clearly
            You stayed
            [Chorus]
            Sarah, you are home

            Anchor: Sarah, you are home
            """.trimIndent(),
            model.lyrics,
        )
    }
}
