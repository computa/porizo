//
//  ShareController.swift
//  PorizoApp
//
//  Owns the share lifecycle for a track: creating share links, loading
//  status/stats, QR codes, OG variant selection, and revoking shares.
//
//  Extracted from ShareSheetView so share state can be driven from any
//  context (player, notification, deep link) without coupling to a
//  specific view hierarchy.
//

import Foundation
import Observation

// MARK: - Share Phase

/// Represents the current state of share data loading and creation.
enum SharePhase: Equatable {
    case idle
    case loading
    case noShare
    case hasShare
    case creating
    case failed(String)
}

// MARK: - Share Data

/// Snapshot of everything needed to present a share sheet or trigger
/// social sharing. Views read this; they never talk to the API directly.
struct ShareData: Sendable {
    let shareURL: String
    let claimPin: String
    let shareId: String
    let expiresAt: String
}

// MARK: - Share Controller

@Observable
@MainActor
final class ShareController {

    // MARK: - Dependencies

    private let apiClient: APIClient

    // MARK: - Published State

    /// Current phase of the share lifecycle.
    private(set) var phase: SharePhase = .idle

    /// Convenience: is any network operation in progress?
    var isLoading: Bool {
        switch phase {
        case .loading, .creating: return true
        default: return false
        }
    }

    /// The active share link URL, derived from the most recent API response.
    private(set) var shareURL: URL?

    /// Whether a share link is currently being generated.
    var isGeneratingLink: Bool {
        if case .creating = phase { return true }
        return false
    }

    /// Human-readable error from the last failed operation.
    private(set) var shareError: String?

    /// Response from the most recent createShare call.
    private(set) var createResponse: CreateShareResponse?

    /// Statistics for the active share (access counts, claim status, etc.).
    private(set) var stats: ShareStats?

    /// QR code data URL for the active share.
    private(set) var qrCodeData: QRCodeDataResponse?

    /// OG variant picker state (shared with the UI component).
    let ogState = OGVariantPickerState()

    // MARK: - Derived Convenience

    /// Consolidated share data from the best available source.
    /// Returns nil when no share exists.
    var shareData: ShareData? {
        if let r = createResponse {
            return ShareData(
                shareURL: r.shareUrl,
                claimPin: r.claimPin,
                shareId: r.shareId,
                expiresAt: r.expiresAt
            )
        }
        if let s = stats, let url = s.shareUrl, let pin = s.claimPin {
            return ShareData(
                shareURL: url,
                claimPin: pin,
                shareId: s.shareId,
                expiresAt: s.expiresAt
            )
        }
        if let qr = qrCodeData, let r = createResponse {
            return ShareData(
                shareURL: qr.shareUrl,
                claimPin: r.claimPin,
                shareId: r.shareId,
                expiresAt: r.expiresAt
            )
        }
        return nil
    }

    /// The claim PIN from the best available source.
    var claimPin: String? {
        createResponse?.claimPin ?? stats?.claimPin
    }

    /// The share URL string from the best available source.
    var shareURLString: String? {
        createResponse?.shareUrl ?? stats?.shareUrl ?? qrCodeData?.shareUrl
    }

    // MARK: - Initialization

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    // MARK: - Public API

    /// Check whether a share already exists for this track.
    /// Transitions phase to `.hasShare` or `.noShare`.
    func checkShareStatus(trackId: String) {
        phase = .loading
        shareError = nil

        Task {
            do {
                let fetchedStats = try await BackgroundTaskManager.shared
                    .executeWithBackgroundTime(taskName: "checkShareStatus") {
                        try await self.apiClient.getShareStats(trackId: trackId)
                    }
                self.stats = fetchedStats
                self.phase = .hasShare
                loadQRCode(trackId: trackId)
            } catch let error as APIClientError {
                handleShareStatusError(error)
            } catch {
                self.phase = .failed(error.localizedDescription)
                self.shareError = error.localizedDescription
            }
        }
    }

    /// Create a new share link for the given track + version.
    func generateShareLink(
        trackId: String,
        versionNum: Int,
        ogVariant: String? = nil
    ) {
        phase = .creating
        shareError = nil

        let selectedVariant = ogVariant ?? ogState.selectedVariant

        Task {
            do {
                let response = try await BackgroundTaskManager.shared
                    .executeWithBackgroundTime(taskName: "createShare") {
                        try await self.apiClient.createShare(
                            trackId: trackId,
                            versionNum: versionNum,
                            ogVariant: selectedVariant
                        )
                    }
                self.createResponse = response
                self.shareURL = URL(string: response.shareUrl)
                self.ogState.currentVariant = selectedVariant
                self.phase = .hasShare
                loadQRCode(trackId: trackId)
                loadStats(trackId: trackId)
                loadOgPreviews(trackId: trackId)
            } catch {
                self.phase = .failed(error.localizedDescription)
                self.shareError = error.localizedDescription
            }
        }
    }

    /// Revoke the active share link, returning to `.noShare`.
    func revokeShare(trackId: String) {
        Task {
            do {
                try await BackgroundTaskManager.shared
                    .executeWithBackgroundTime(taskName: "revokeShare") {
                        try await self.apiClient.revokeShare(trackId: trackId)
                    }
                self.createResponse = nil
                self.stats = nil
                self.qrCodeData = nil
                self.shareURL = nil
                self.phase = .noShare
            } catch {
                self.phase = .failed(error.localizedDescription)
                self.shareError = error.localizedDescription
            }
        }
    }

    /// Apply a selected OG variant to the existing share.
    func applyOgVariant(trackId: String, versionNum: Int) {
        guard let selectedVariant = ogState.selectedVariant,
              !selectedVariant.isEmpty else { return }
        ogState.isApplying = true

        Task {
            do {
                let response = try await BackgroundTaskManager.shared
                    .executeWithBackgroundTime(taskName: "applySongOgVariant") {
                        try await self.apiClient.createShare(
                            trackId: trackId,
                            versionNum: versionNum,
                            ogVariant: selectedVariant
                        )
                    }
                self.createResponse = response
                self.shareURL = URL(string: response.shareUrl)
                self.ogState.currentVariant = selectedVariant
                self.ogState.isApplying = false
                self.phase = .hasShare
                loadQRCode(trackId: trackId)
                loadStats(trackId: trackId)
            } catch {
                self.ogState.isApplying = false
                self.phase = .failed(error.localizedDescription)
                self.shareError = error.localizedDescription
            }
        }
    }

    /// Load OG variant previews for the share style picker.
    func loadOgPreviews(trackId: String) {
        ogState.isLoading = true
        ogState.error = nil

        Task {
            do {
                let response = try await BackgroundTaskManager.shared
                    .executeWithBackgroundTime(taskName: "loadSongOgPreviews") {
                        try await self.apiClient.getTrackOgPreviews(trackId: trackId)
                    }
                self.ogState.previews = response.variants
                self.ogState.currentVariant = response.currentVariant
                if let selected = self.ogState.selectedVariant,
                   response.variants.contains(where: { $0.name == selected }) {
                    // Keep explicit user selection when still valid.
                } else {
                    self.ogState.selectedVariant = response.currentVariant
                        ?? response.variants.first?.name
                }
                self.ogState.isLoading = false
            } catch {
                self.ogState.isLoading = false
                self.ogState.error = error.localizedDescription
            }
        }
    }

    /// Prepare data needed for system share sheet / social sharing.
    /// Returns nil if no share exists yet.
    func prepareShareData(
        trackTitle: String,
        recipientName: String
    ) -> ShareMessageContent? {
        guard let data = shareData else { return nil }
        return ShareMessageContent(
            shareURL: data.shareURL,
            claimPin: data.claimPin,
            trackTitle: trackTitle,
            recipientName: recipientName
        )
    }

    /// Reset to idle state. Useful when the controller is reused for a
    /// different track.
    func reset() {
        phase = .idle
        shareURL = nil
        shareError = nil
        createResponse = nil
        stats = nil
        qrCodeData = nil
        ogState.previews = []
        ogState.selectedVariant = nil
        ogState.currentVariant = nil
        ogState.isLoading = false
        ogState.isApplying = false
        ogState.error = nil
    }

    // MARK: - Private Helpers

    private func loadQRCode(trackId: String) {
        Task {
            do {
                let qrData = try await BackgroundTaskManager.shared
                    .executeWithBackgroundTime(taskName: "loadQRCode") {
                        try await self.apiClient.getQRCodeData(trackId: trackId, size: 300)
                    }
                self.qrCodeData = qrData
            } catch {
                print("[ShareController] Failed to load QR code: \(error)")
            }
        }
    }

    private func loadStats(trackId: String) {
        Task {
            do {
                let fetchedStats = try await BackgroundTaskManager.shared
                    .executeWithBackgroundTime(taskName: "loadShareStats") {
                        try await self.apiClient.getShareStats(trackId: trackId)
                    }
                self.stats = fetchedStats
            } catch {
                print("[ShareController] Failed to load stats: \(error)")
            }
        }
    }

    private func handleShareStatusError(_ error: APIClientError) {
        switch error {
        case .httpError(let statusCode, _) where statusCode == 404:
            self.phase = .noShare
        case .serverError(let message, _, _):
            let msg = message.lowercased()
            if msg.contains("no share") || (msg.contains("share") && msg.contains("not found")) {
                self.phase = .noShare
            } else {
                self.phase = .failed(error.localizedDescription)
                self.shareError = error.localizedDescription
            }
        default:
            self.phase = .failed(error.localizedDescription)
            self.shareError = error.localizedDescription
        }
    }
}

// MARK: - Share Message Content

/// Pre-formatted content for sharing via system sheet or social channels.
/// Views use this to build platform-specific share payloads without
/// knowing about the API layer.
struct ShareMessageContent: Sendable {
    let shareURL: String
    let claimPin: String
    let trackTitle: String
    let recipientName: String

    static func activityMessage(shareURL: String, claimPin: String) -> String {
        "I made you a personalized song! Listen here: \(shareURL)\n\nUse PIN: \(claimPin)"
    }

    /// Default message body for Messages, WhatsApp, system share sheet.
    var defaultMessage: String {
        Self.activityMessage(shareURL: shareURL, claimPin: claimPin)
    }

    /// Formatted email subject line.
    var emailSubject: String {
        "\(trackTitle) \u{2013} A Song for \(recipientName)"
    }

    /// Formatted email body.
    var emailBody: String {
        """
        I made a personalized song for you!

        \u{266B} \(trackTitle) \u{266B}
        For \(recipientName)

        Listen here: \(shareURL)
        PIN: \(claimPin)
        """
    }
}
