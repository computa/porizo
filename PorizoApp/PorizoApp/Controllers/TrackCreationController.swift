//
//  TrackCreationController.swift
//  PorizoApp
//
//  Extracts the 4-step track creation pipeline from CreatingTrackView
//  so it can be reused across different UI surfaces.
//

import Foundation

/// Orchestrates the track creation pipeline: confirm story, generate lyrics,
/// create track, and sync lyrics. Publishes progress for UI binding.
@Observable
@MainActor
final class TrackCreationController {

    // MARK: - Published State

    /// Progress percentage (0-100) through the creation pipeline.
    var progress: Int = 0

    /// Human-readable status message for the current pipeline step.
    var statusMessage: String = "Creating your song..."

    /// Whether a creation is currently in flight.
    private(set) var isCreating: Bool = false

    // MARK: - Callbacks

    /// Fired when lyrics are generated (step 2 of 4), before track creation completes.
    /// Allows the UI to show a read-only lyrics preview while the pipeline continues.
    var onLyricsGenerated: ((Lyrics) -> Void)?

    // MARK: - Dependencies

    private let apiClient: APIClient

    // MARK: - Init

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    // MARK: - Public API

    /// Result of a successful track creation pipeline.
    struct Result: Sendable {
        let trackId: String
        let versionNum: Int
        let lyrics: Lyrics
    }

    /// Runs the 4-step creation pipeline inside a background-time-protected task.
    ///
    /// - Parameters:
    ///   - storyContext: The story to convert into a track.
    ///   - voiceMode: AI voice or user's own voice.
    ///   - voiceGender: Optional gender for AI voice mode.
    /// - Returns: The created track's ID, version number, and generated lyrics.
    /// - Throws: `APIClientError` or cancellation.
    func createTrack(
        storyContext: StoryContext,
        voiceMode: VoiceMode,
        voiceGender: VoiceGender?
    ) async throws -> Result {
        guard !isCreating else {
            throw APIClientError.invalidResponse
        }

        isCreating = true
        progress = 0
        statusMessage = "Creating your song..."

        defer { isCreating = false }

        return try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "createTrack") {
            guard let storyId = storyContext.storyId else {
                throw APIClientError.invalidResponse
            }

            // Step 1: Confirm the story
            self.statusMessage = "Confirming your story..."
            self.progress = 10
            let confirmResponse = try await self.apiClient.confirmStoryV2(
                storyId: storyId,
                additionalNotes: storyContext.finalNotes
            )
            if let confirmedVersion = confirmResponse.narrativeVersion {
                self.statusMessage = "Locked story draft v\(confirmedVersion)..."
            }

            // Step 2: Generate lyrics
            self.statusMessage = "Writing your lyrics..."
            self.progress = 25
            let storyLyrics = try await self.apiClient.generateStoryLyrics(storyId: storyId)

            // Emit lyrics early so the UI can show a read-only preview
            if !Task.isCancelled {
                self.onLyricsGenerated?(storyLyrics.lyrics)
            }

            // Step 3: Create the track
            self.statusMessage = "Setting up your song..."
            self.progress = 45
            let trackResponse = try await self.apiClient.storyToTrack(
                storyId: storyId,
                voiceMode: voiceMode.rawValue,
                voiceGender: voiceGender?.rawValue,
                style: storyContext.style
            )
            self.progress = 90

            // Step 4: Sync lyrics to the new track
            self.statusMessage = "Syncing lyrics..."
            try await self.apiClient.updateLyrics(
                trackId: trackResponse.trackId,
                versionNum: trackResponse.versionNum,
                lyrics: storyLyrics.lyrics
            )
            self.progress = 100

            return Result(
                trackId: trackResponse.trackId,
                versionNum: trackResponse.versionNum,
                lyrics: storyLyrics.lyrics
            )
        }
    }

}
