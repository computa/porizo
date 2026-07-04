package com.porizo.core.domain.claim

import com.porizo.core.model.PoemBody
import com.porizo.core.model.PoemShareInfo

object PoemClaimLogic {
    fun stateFor(info: PoemShareInfo): ClaimLogic.State =
        when (info.status) {
            "active", "unbound" -> ClaimLogic.State.Claimable(
                needsPin = info.requiresPinForClaim ?: info.requiresPin ?: false,
            )
            "claimed" -> ClaimLogic.State.Claimed
            else -> ClaimLogic.State.Unavailable
        }

    fun verses(info: PoemShareInfo): List<String> = verses(info.poem)

    fun verses(poem: PoemBody?): List<String> {
        if (poem == null) return emptyList()
        val verses = poem.verses
        if (!verses.isNullOrEmpty()) return verses
        return poem.previewLines.orEmpty()
    }
}
