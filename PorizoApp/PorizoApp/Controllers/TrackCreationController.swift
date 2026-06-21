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

    private static let lyricsSyncRetryDelaysNanoseconds: [UInt64] = [
        600_000_000,
        1_200_000_000,
    ]

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

    enum Outcome: Sendable {
        case created(Result)
        case needsInput(StoryGuidanceResponse)
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
        voiceGender: VoiceGender?,
        giftReservationId: String? = nil,
        recipientPhone: String? = nil,
        recipientChannel: String? = nil
    ) async throws -> Outcome {
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
            let confirmResult = try await self.apiClient.confirmStoryV2(
                storyId: storyId,
                additionalNotes: storyContext.finalNotes,
                forceConfirm: true,
                targetContentType: "song"
            )
            switch confirmResult {
            case .needsInput(let guidance):
                self.statusMessage = "One more detail needed..."
                self.progress = 0
                return .needsInput(guidance)
            case .confirmed(let confirmResponse):
                if let confirmedVersion = confirmResponse.narrativeVersion {
                    self.statusMessage = "Locked story draft v\(confirmedVersion)..."
                }
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
                style: storyContext.style,
                giftReservationId: giftReservationId,
                recipientPhone: recipientPhone,
                recipientChannel: recipientChannel
            )
            self.progress = 90

            // Step 4: Sync lyrics to the new track
            self.statusMessage = "Syncing lyrics..."
            try await self.syncLyricsWithRetry(
                trackId: trackResponse.trackId,
                versionNum: trackResponse.versionNum,
                lyrics: storyLyrics.lyrics
            )
            self.progress = 100

            return .created(
                Result(
                    trackId: trackResponse.trackId,
                    versionNum: trackResponse.versionNum,
                    lyrics: storyLyrics.lyrics
                )
            )
        }
    }

    // MARK: - Private

    private func syncLyricsWithRetry(
        trackId: String,
        versionNum: Int,
        lyrics: Lyrics
    ) async throws {
        do {
            try await apiClient.updateLyrics(
                trackId: trackId,
                versionNum: versionNum,
                lyrics: lyrics
            )
            return
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            var lastError = error
            for (index, delay) in Self.lyricsSyncRetryDelaysNanoseconds.enumerated() {
                self.statusMessage = index == 0
                    ? "Retrying lyrics sync..."
                    : "Retrying lyrics sync one last time..."
                try await Task.sleep(nanoseconds: delay)
                do {
                    try await apiClient.updateLyrics(
                        trackId: trackId,
                        versionNum: versionNum,
                        lyrics: lyrics
                    )
                    return
                } catch is CancellationError {
                    throw CancellationError()
                } catch {
                    lastError = error
                }
            }
            throw lastError
        }
    }

}
