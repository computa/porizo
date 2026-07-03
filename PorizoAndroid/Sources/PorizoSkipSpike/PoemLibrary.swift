import Foundation

/// Pure library logic for the Poems tab (U6), mirroring SongLibrary.

enum PoemLibraryFilter: String, CaseIterable, Identifiable {
    case mine
    case received

    var id: String { rawValue }
    var label: String { self == .mine ? "My Poems" : "Received" }
}

enum PoemLibrary {

    /// Filter poems by the My/Received segmented control.
    static func filtered(_ poems: [PorizoPoemSummary], by filter: PoemLibraryFilter) -> [PorizoPoemSummary] {
        switch filter {
        case .mine: return poems.filter { !$0.isReceived }
        case .received: return poems.filter { $0.isReceived }
        }
    }

    /// A one-line preview drawn from the first non-empty verse.
    static func preview(for poem: PorizoPoemSummary) -> String {
        poem.verses.first(where: { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })
            ?? "Tap to read"
    }

    /// Build a playable track for the U3 player from a poem's TTS audio URL.
    static func playableTrack(for poem: PorizoPoemSummary, audioURL: String) -> AndroidPlayableTrack {
        AndroidPlayableTrack(
            id: poem.id,
            title: poem.title,
            recipientName: poem.recipientName,
            artworkURL: nil,
            streamURL: audioURL,
            isOwnedContent: !poem.isReceived
        )
    }
}
