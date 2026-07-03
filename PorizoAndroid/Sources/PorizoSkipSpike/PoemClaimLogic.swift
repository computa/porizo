import Foundation

/// Pure poem-claim decision logic (U13). Reuses `ClaimLogic.State`; maps
/// poem-share status and extracts the verses to reveal. No UI, no network.
enum PoemClaimLogic {

    /// Map a poem-share response to a claim state (shares the track claim states).
    static func state(for info: PorizoPoemShareInfoResponse) -> ClaimLogic.State {
        switch info.status {
        case "unbound":
            return .claimable(needsPin: info.requiresPinForClaim ?? info.requiresPin ?? false)
        case "claimed":
            return .claimed
        default:
            return .unavailable
        }
    }

    /// The verses to display: full verses when present, else preview lines.
    static func verses(from info: PorizoPoemShareInfoResponse) -> [String] {
        verses(from: info.poem)
    }

    static func verses(from poem: PorizoPoemBody?) -> [String] {
        guard let poem else { return [] }
        if let verses = poem.verses, !verses.isEmpty { return verses }
        return poem.previewLines ?? []
    }
}
