//
//  LaunchFlashResolver.swift
//  PorizoApp
//
//  Picks what to show on the launch flash. Pure, dependency-injected,
//  unit-testable. No async, no AVPlayer, no UIKit.
//
//  Content priority:
//    1. mode == .all AND has received songs?  → received library (rotated)
//    2. Has created songs?                     → created library (rotated)
//    3. Has unconsumed pendingSuggestion?      → suggestion + CTA
//    4. Demo audio URL available?              → Porizo demo
//    5. None of the above?                     → nil (skip flash)
//

import Foundation

struct LaunchFlashResolver {
    private let source: LaunchFlashContentSource
    private let onboardingConfig: OnboardingConfig?
    private let defaults: UserDefaults

    /// Maximum number of recent track IDs to track for rotation exclusion.
    static let recentHistoryDepth = 3

    /// Default fallback values used when server config doesn't supply a demo.
    static let demoFallbackTitle = "The Drive Home"
    static let demoFallbackRecipient = "For Dad"
    static let demoFallbackLyric = "You kept one hand on the wheel and one eye on me the whole way home..."

    init(
        source: LaunchFlashContentSource,
        onboardingConfig: OnboardingConfig?,
        defaults: UserDefaults = .standard
    ) {
        self.source = source
        self.onboardingConfig = onboardingConfig
        self.defaults = defaults
    }

    // MARK: - Public

    /// Pick the launch flash content. Returns nil if nothing should be shown.
    /// Pure function except for `defaults` reads (no writes).
    func resolve(mode: LaunchFlashMode) -> LaunchFlashContent? {
        guard mode != .off else { return nil }

        let tracks = filterEligibleTracks(source.loadTracks())
        let recentIds = recentTrackIds()

        let received = tracks.filter { $0.isReceived }
        let created = tracks.filter { !$0.isReceived }

        // Priority 1+2: rotate through libraries (mode-aware)
        if let track = pickWeightedTrack(
            received: mode == .all ? received : [],
            created: created,
            excluding: recentIds
        ) {
            return makeContent(from: track, source: trackSource(track))
        }

        // Priority 3: pending suggestion
        if let suggestion = pendingSuggestion() {
            return makeContent(from: suggestion)
        }

        // Priority 4: Porizo demo
        if let demo = makeDemoContent() {
            return demo
        }

        // Priority 5: skip
        return nil
    }

    // MARK: - Track Filtering

    /// Filter tracks to those eligible for flash playback.
    private func filterEligibleTracks(_ tracks: [Track]) -> [Track] {
        tracks.filter { track in
            let status = track.status.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            return Self.playableTrackStatuses.contains(status) && track.latestVersion > 0
        }
    }

    /// Backend history includes all three values:
    /// - `ready`: current full-render terminal status
    /// - `preview_ready`: preview has a playable URL before final render
    /// - `completed`: legacy/test/share rows that still represent playable songs
    private static let playableTrackStatuses: Set<String> = ["ready", "preview_ready", "completed"]

    // MARK: - Weighted Pick (70/30 received/created)

    private func pickWeightedTrack(
        received: [Track],
        created: [Track],
        excluding recentIds: [String]
    ) -> Track? {
        let receivedCandidates = applyRotation(received, excluding: recentIds)
        let createdCandidates = applyRotation(created, excluding: recentIds)

        let preferReceived = (Int.random(in: 0..<100) < 70) && !receivedCandidates.isEmpty

        if preferReceived {
            return receivedCandidates.randomElement()
                ?? createdCandidates.randomElement()
        } else {
            return createdCandidates.randomElement()
                ?? receivedCandidates.randomElement()
        }
    }

    /// Three-tier rotation fallback: exclude all recent → exclude only most-recent → any.
    private func applyRotation(_ library: [Track], excluding recentIds: [String]) -> [Track] {
        guard !library.isEmpty else { return [] }

        // Tier 1: exclude all recent IDs
        let strict = library.filter { !recentIds.contains($0.id) }
        if !strict.isEmpty { return strict }

        // Tier 2: exclude only the most-recent ID
        if let mostRecent = recentIds.first {
            let lenient = library.filter { $0.id != mostRecent }
            if !lenient.isEmpty { return lenient }
        }

        // Tier 3: any track
        return library
    }

    private func trackSource(_ track: Track) -> LaunchFlashSource {
        track.isReceived ? .received : .created
    }

    // MARK: - Pending Suggestion

    /// Returns the pending suggestion if it should be shown.
    /// Returns nil if cleared/expired/exhausted/de-duped.
    private func pendingSuggestion() -> PendingSuggestionContext? {
        PendingSuggestionStore.loadIfActive(
            defaults: defaults,
            tracks: source.loadTracks()
        )
    }

    // MARK: - Content Construction

    private func makeContent(from track: Track, source: LaunchFlashSource) -> LaunchFlashContent {
        LaunchFlashContent(
            trackId: track.id,
            title: track.title,
            recipientName: track.recipientName,
            lyricPreview: nil,  // Not in cached Track model; future work
            audioURL: self.source.loadPlayableAudioURL(for: track.id),
            coverImageURL: track.coverImageUrl.flatMap { URL(string: $0) },
            source: source
        )
    }

    private func makeContent(from suggestion: PendingSuggestionContext) -> LaunchFlashContent {
        return LaunchFlashContent(
            trackId: nil,
            title: suggestion.suggestion.title,
            recipientName: suggestion.recipientName,
            lyricPreview: suggestion.suggestion.previewLine,
            audioURL: (onboardingConfig?.launchFlashAudioUrl ?? onboardingConfig?.sampleAudioUrl).flatMap { URL(string: $0) },
            coverImageURL: nil,
            source: .suggestion
        )
    }

    private func makeDemoContent() -> LaunchFlashContent? {
        // Always return a demo card when reached — caller has already ruled out
        // tracks and suggestions, so falling back to visual-only keeps the flash
        // reliable when /app/config is unreachable (offline, config endpoint
        // down, DEBUG simulator with no local server). Previously we gated on
        // server fields being populated, which made the flash disappear on
        // every config fetch failure.
        let audioURL = (onboardingConfig?.launchFlashAudioUrl ?? onboardingConfig?.sampleAudioUrl).flatMap { URL(string: $0) }

        return LaunchFlashContent(
            trackId: nil,
            title: onboardingConfig?.launchFlashTitle ?? Self.demoFallbackTitle,
            recipientName: onboardingConfig?.launchFlashRecipient ?? Self.demoFallbackRecipient,
            lyricPreview: onboardingConfig?.launchFlashLyricsPreview ?? Self.demoFallbackLyric,
            audioURL: audioURL,
            coverImageURL: nil,
            source: .demo
        )
    }

    // MARK: - Recent IDs Helpers (read-only here; writes happen in ViewModel)

    private func recentTrackIds() -> [String] {
        guard let raw = defaults.string(forKey: "recentLaunchFlashTrackIds"),
              let data = raw.data(using: .utf8),
              let ids = try? JSONDecoder().decode([String].self, from: data)
        else {
            return []
        }
        return ids
    }

}

// MARK: - Recent IDs Mutation Helpers (used by view model after content is shown)

enum LaunchFlashHistory {
    static let storageKey = "recentLaunchFlashTrackIds"

    private static func read(from defaults: UserDefaults = .standard) -> [String] {
        guard let raw = defaults.string(forKey: storageKey),
              let data = raw.data(using: .utf8),
              let ids = try? JSONDecoder().decode([String].self, from: data)
        else {
            return []
        }
        return ids
    }

    /// Prepend a new track ID, dedupe, truncate to recentHistoryDepth.
    /// No-op if trackId is nil (suggestion/demo don't get tracked).
    static func record(trackId: String?, in defaults: UserDefaults = .standard) {
        guard let trackId else { return }

        var ids = read(from: defaults)
        ids.removeAll { $0 == trackId }  // de-dupe
        ids.insert(trackId, at: 0)        // newest-first
        if ids.count > LaunchFlashResolver.recentHistoryDepth {
            ids = Array(ids.prefix(LaunchFlashResolver.recentHistoryDepth))
        }

        if let data = try? JSONEncoder().encode(ids),
           let json = String(data: data, encoding: .utf8) {
            defaults.set(json, forKey: storageKey)
        }
    }

}
