import Foundation

/// Pure library logic for the Songs tab (U5), extracted from the view so it can
/// be unit-tested without SwiftUI. Mirrors iOS MySongsView status semantics.

/// User-facing status of a song row, driving the badge label/style.
enum SongDisplayStatus: Equatable {
    case ready        // playable (has a rendered URL / status ready)
    case creating     // in flight (queued/processing/rendering)
    case draft        // draft / lyrics stage, not yet rendering
    case failed       // terminal failure
}

enum SongLibraryFilter: String, CaseIterable, Identifiable {
    case mine
    case received

    var id: String { rawValue }
    var label: String { self == .mine ? "My Songs" : "Received" }
}

enum SongLibrary {

    /// Map a track's raw status string to a display status.
    /// iOS only branches explicitly on "failed"; everything else is inferred:
    /// ready-ish states are playable, in-flight states are "creating", and the
    /// early lifecycle ("draft"/"lyrics_*") is "draft".
    static func displayStatus(for rawStatus: String) -> SongDisplayStatus {
        switch rawStatus.lowercased() {
        case "failed", "dead_letter", "blocked":
            return .failed
        case "ready", "preview_ready", "full_ready", "completed", "complete":
            return .ready
        case "draft", "lyrics_ready", "lyrics_approved", "created":
            return .draft
        default:
            // queued / processing / rendering / anything else in flight
            return .creating
        }
    }

    /// Badge text for a display status.
    static func badgeLabel(for status: SongDisplayStatus) -> String {
        switch status {
        case .ready: return "Ready"
        case .creating: return "Creating"
        case .draft: return "Draft"
        case .failed: return "Failed"
        }
    }

    /// Filter tracks by the My/Received segmented control.
    static func filtered(_ tracks: [PorizoTrackSummary], by filter: SongLibraryFilter) -> [PorizoTrackSummary] {
        switch filter {
        case .mine: return tracks.filter { !$0.isReceived }
        case .received: return tracks.filter { $0.isReceived }
        }
    }

    /// Build a playable track for the U3 player from a track + its versions.
    /// Returns nil when no version carries a playable URL (nothing to stream).
    static func playableTrack(
        for summary: PorizoTrackSummary,
        versions: [PorizoTrackVersion]
    ) -> AndroidPlayableTrack? {
        // Prefer the latest version that has a URL.
        let candidate = versions
            .sorted { $0.versionNum > $1.versionNum }
            .first { $0.playableUrl != nil }
        guard let version = candidate, let url = version.playableUrl else {
            return nil
        }
        return AndroidPlayableTrack(
            id: summary.id,
            title: summary.title,
            recipientName: summary.recipientName,
            artworkURL: summary.artworkUrl,
            streamURL: url,
            isOwnedContent: !summary.isReceived
        )
    }
}
