//
//  V1ScreenPlaceholders.swift
//  PorizoApp
//
//  Lightweight placeholders and previews for v1.pen screens that are not yet
//  wired to backend flows. These are navigation-only surfaces.
//

import SwiftUI

// MARK: - Create Step Placeholder

struct V1CreateStepPlaceholderView: View {
    let title: String
    let subtitle: String
    let primaryPlaceholder: String
    let ctaTitle: String

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                VelvetHeader(title: "Who's this for?", showBackButton: false)

                VStack(spacing: 24) {
                    VStack(spacing: 8) {
                        Text(title)
                            .font(DesignTokens.displayFont(size: 26, weight: .semibold))
                            .foregroundColor(DesignTokens.textPrimary)
                            .multilineTextAlignment(.center)

                        Text(subtitle)
                            .font(DesignTokens.bodyFont(size: 14))
                            .foregroundColor(DesignTokens.textSecondary)
                    }
                    .padding(.top, 12)

                    VStack(spacing: 12) {
                        TextField(primaryPlaceholder, text: .constant(""))
                            .textFieldStyle(.plain)
                            .padding(16)
                            .background(DesignTokens.surface)
                            .cornerRadius(14)
                            .foregroundColor(DesignTokens.textPrimary)
                    }

                    Spacer()

                    VelvetButton(ctaTitle, style: .primary, action: {})
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 32)
            }
        }
    }
}

// MARK: - Settings Sheet (v1.pen 13)

struct V1SettingsSheetView: View {
    var body: some View {
        ZStack(alignment: .bottom) {
            Color.black.opacity(0.6)
                .ignoresSafeArea()

            VStack(spacing: 16) {
                Capsule()
                    .fill(DesignTokens.textTertiary)
                    .frame(width: 40, height: 4)
                    .padding(.top, 8)

                VStack(spacing: 12) {
                    sheetRow(icon: "person.crop.circle", title: "Profile")
                    sheetRow(icon: "wand.and.stars", title: "Voice Enrollment")
                    sheetRow(icon: "creditcard", title: "Manage Subscription")
                    sheetRow(icon: "questionmark.circle", title: "Help & Support")
                    sheetRow(icon: "arrow.right.square", title: "Sign Out")
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            }
            .frame(maxWidth: .infinity)
            .background(DesignTokens.surface)
            .clipShape(RoundedCorners(radius: 24, corners: [.topLeft, .topRight]))
        }
    }

    private func sheetRow(icon: String, title: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 18))
                .foregroundColor(DesignTokens.textPrimary)
                .frame(width: 24)

            Text(title)
                .font(DesignTokens.bodyFont(size: 16))
                .foregroundColor(DesignTokens.textPrimary)

            Spacer()
        }
        .padding(.vertical, 8)
    }
}

// MARK: - Share Song (v1.pen 17)

struct V1ShareSongView: View {
    let apiClient: APIClient
    let trackId: String
    let versionNum: Int
    let trackTitle: String
    let recipientName: String
    let onDismiss: () -> Void

    // Share state
    @State private var shareState: ShareState = .loading
    @State private var shareResponse: CreateShareResponse?
    @State private var qrCodeData: QRCodeDataResponse?
    @State private var copiedToClipboard = false

    enum ShareState {
        case loading
        case noShare
        case hasShare
        case creating
        case error(String)
    }

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header
                HStack {
                    VelvetIconButton(icon: "xmark", action: onDismiss)
                    Spacer()
                    Text("Share Song")
                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        .foregroundColor(DesignTokens.textPrimary)
                    Spacer()
                    Color.clear.frame(width: 44, height: 44)
                }
                .padding(.horizontal, 16)
                .frame(height: 56)

                ScrollView {
                    switch shareState {
                    case .loading:
                        loadingView
                    case .noShare:
                        createShareView
                    case .creating:
                        creatingView
                    case .hasShare:
                        shareDetailsView
                    case .error(let message):
                        errorView(message: message)
                    }
                }
            }
        }
        .onAppear {
            checkShareStatus()
        }
    }

    // MARK: - Loading View

    private var loadingView: some View {
        VStack(spacing: 16) {
            ProgressView()
                .scaleEffect(1.2)
                .tint(DesignTokens.gold)
            Text("Loading...")
                .font(DesignTokens.bodyFont(size: 14))
                .foregroundColor(DesignTokens.textSecondary)
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .padding(.top, 40)
    }

    // MARK: - Create Share View

    private var createShareView: some View {
        VStack(spacing: 16) {
            VStack(spacing: 6) {
                Image(systemName: "gift.fill")
                    .font(.system(size: 36))
                    .foregroundColor(DesignTokens.gold)
                Text("Send this song to \(recipientName)")
                    .font(DesignTokens.displayFont(size: 20, weight: .semibold))
                    .foregroundColor(DesignTokens.textPrimary)
                    .multilineTextAlignment(.center)
            }
            .padding(.top, 12)

            // How it works
            VStack(alignment: .leading, spacing: 10) {
                Text("How it works")
                    .font(DesignTokens.bodyFont(size: 13, weight: .semibold))
                    .foregroundColor(DesignTokens.textPrimary)

                howItWorksItem(number: "1", text: "We'll create a private link and PIN")
                howItWorksItem(number: "2", text: "Share the link with \(recipientName)")
                howItWorksItem(number: "3", text: "Tell them the PIN separately")
                howItWorksItem(number: "4", text: "They can listen for 30 days")
            }
            .padding(12)
            .background(DesignTokens.surface)
            .cornerRadius(10)

            VelvetButton("Create Share Link", icon: "link.badge.plus", style: .primary) {
                createShare()
            }
        }
        .padding(.horizontal, 16)
    }

    // MARK: - Creating View

    private var creatingView: some View {
        VStack(spacing: 16) {
            ProgressView()
                .scaleEffect(1.2)
                .tint(DesignTokens.gold)
            Text("Creating share link...")
                .font(DesignTokens.bodyFont(size: 14))
                .foregroundColor(DesignTokens.textSecondary)
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .padding(.top, 40)
    }

    // MARK: - Share Details View

    private var shareDetailsView: some View {
        VStack(spacing: 16) {
            VStack(spacing: 6) {
                Image(systemName: "gift.fill")
                    .font(.system(size: 36))
                    .foregroundColor(DesignTokens.gold)
                Text("Send this song to \(recipientName)")
                    .font(DesignTokens.displayFont(size: 20, weight: .semibold))
                    .foregroundColor(DesignTokens.textPrimary)
                    .multilineTextAlignment(.center)
            }
            .padding(.top, 12)

            // QR Code
            if let qrData = qrCodeData, let image = qrCodeImage(from: qrData.qrDataUrl) {
                VStack(spacing: 8) {
                    Image(uiImage: image)
                        .interpolation(.none)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 180, height: 180)
                        .background(Color.white)
                        .cornerRadius(12)

                    Text("Scan to listen")
                        .font(DesignTokens.bodyFont(size: 12))
                        .foregroundColor(DesignTokens.textSecondary)
                }
            }

            // PIN display
            if let response = shareResponse {
                VStack(spacing: 6) {
                    Text("Secret PIN")
                        .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                        .foregroundColor(DesignTokens.textSecondary)

                    Text(response.claimPin)
                        .font(.system(size: 28, weight: .bold, design: .monospaced))
                        .foregroundColor(DesignTokens.gold)
                        .tracking(6)

                    Text("Share this PIN separately with \(recipientName)")
                        .font(DesignTokens.bodyFont(size: 11))
                        .foregroundColor(DesignTokens.textTertiary)
                        .multilineTextAlignment(.center)
                }
                .padding(12)
                .frame(maxWidth: .infinity)
                .background(DesignTokens.surface)
                .cornerRadius(10)
            }

            // Share link display
            if let response = shareResponse {
                VStack(spacing: 8) {
                    Text("Share Link")
                        .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                        .foregroundColor(DesignTokens.textSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    Button {
                        copyToClipboard(response.shareUrl)
                    } label: {
                        HStack {
                            Text(response.shareUrl)
                                .font(DesignTokens.bodyFont(size: 13))
                                .foregroundColor(DesignTokens.textPrimary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                            Spacer()
                            Image(systemName: copiedToClipboard ? "checkmark" : "doc.on.doc")
                                .foregroundColor(copiedToClipboard ? DesignTokens.success : DesignTokens.gold)
                        }
                        .padding(12)
                        .background(DesignTokens.surface)
                        .cornerRadius(10)
                    }
                }
            }

            // Action buttons
            if let response = shareResponse {
                VStack(spacing: 10) {
                    ShareLink(
                        item: response.shareUrl,
                        subject: Text("\(trackTitle) - A song for \(recipientName)"),
                        message: Text("I made you a personalized song! Use PIN \(response.claimPin) to unlock it.")
                    ) {
                        HStack {
                            Image(systemName: "square.and.arrow.up")
                            Text("Share Link")
                        }
                        .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                        .foregroundColor(.black)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(DesignTokens.gold)
                        .cornerRadius(12)
                    }

                    Button {
                        copyToClipboard(response.shareUrl)
                    } label: {
                        HStack {
                            Image(systemName: "link")
                            Text(copiedToClipboard ? "Copied!" : "Copy Link")
                        }
                        .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                        .foregroundColor(DesignTokens.gold)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(DesignTokens.gold.opacity(0.15))
                        .cornerRadius(12)
                    }
                }
            }

            Spacer().frame(height: 24)
        }
        .padding(.horizontal, 16)
    }

    // MARK: - Error View

    private func errorView(message: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 36))
                .foregroundColor(DesignTokens.warning)

            Text("Something went wrong")
                .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                .foregroundColor(DesignTokens.textPrimary)

            Text(message)
                .font(DesignTokens.bodyFont(size: 13))
                .foregroundColor(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)

            VelvetButton("Try Again", icon: "arrow.clockwise", style: .secondary) {
                checkShareStatus()
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 32)
    }

    // MARK: - Helper Views

    private func howItWorksItem(number: String, text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text(number)
                .font(DesignTokens.bodyFont(size: 11, weight: .bold))
                .foregroundColor(.black)
                .frame(width: 18, height: 18)
                .background(DesignTokens.gold)
                .clipShape(Circle())

            Text(text)
                .font(DesignTokens.bodyFont(size: 13))
                .foregroundColor(DesignTokens.textSecondary)
        }
    }

    // MARK: - Actions

    private func checkShareStatus() {
        shareState = .loading

        Task {
            do {
                // Try to get existing share stats - if it exists, we have a share
                _ = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "checkShareStatus") {
                    try await apiClient.getShareStats(trackId: trackId)
                }
                // Share exists - load QR code
                await MainActor.run {
                    loadQRCodeAndShareInfo()
                }
            } catch let error as APIClientError {
                await MainActor.run {
                    switch error {
                    case .httpError(let statusCode, _) where statusCode == 404:
                        self.shareState = .noShare
                    case .serverError(let message, _, _):
                        let msg = message.lowercased()
                        if msg.contains("no share") || (msg.contains("share") && msg.contains("not found")) {
                            self.shareState = .noShare
                        } else {
                            self.shareState = .error(message)
                        }
                    default:
                        self.shareState = .error(error.localizedDescription)
                    }
                }
            } catch {
                await MainActor.run {
                    self.shareState = .error(error.localizedDescription)
                }
            }
        }
    }

    private func createShare() {
        shareState = .creating

        Task {
            do {
                let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "createShare") {
                    try await apiClient.createShare(trackId: trackId, versionNum: versionNum)
                }
                await MainActor.run {
                    self.shareResponse = response
                    self.shareState = .hasShare
                    loadQRCode()
                }
            } catch {
                await MainActor.run {
                    self.shareState = .error(error.localizedDescription)
                }
            }
        }
    }

    private func loadQRCodeAndShareInfo() {
        shareState = .hasShare
        // Fetch QR code and construct synthetic response for existing shares
        // Note: PIN is only available at creation time for security
        Task {
            do {
                let qrData = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "loadQRCodeAndShareInfo") {
                    try await apiClient.getQRCodeData(trackId: trackId, size: 300)
                }
                await MainActor.run {
                    self.shareResponse = CreateShareResponse(
                        shareId: "",
                        shareUrl: qrData.shareUrl,
                        qrCodeUrl: "",
                        expiresAt: "",
                        claimPin: "—" // PIN only shown at creation
                    )
                    self.qrCodeData = qrData
                }
            } catch {
                print("[V1ShareSong] Failed to load QR code: \(error)")
                await MainActor.run {
                    shareState = .noShare // Revert state on failure
                }
            }
        }
    }

    private func loadQRCode() {
        Task {
            do {
                let qrData = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "loadQRCode") {
                    try await apiClient.getQRCodeData(trackId: trackId, size: 300)
                }
                await MainActor.run {
                    self.qrCodeData = qrData
                }
            } catch {
                print("[V1ShareSong] Failed to load QR code: \(error)")
            }
        }
    }

    private func copyToClipboard(_ text: String) {
        UIPasteboard.general.string = text
        copiedToClipboard = true

        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            copiedToClipboard = false
        }
    }

    private func qrCodeImage(from dataUrl: String) -> UIImage? {
        guard let commaIndex = dataUrl.firstIndex(of: ",") else { return nil }
        let base64String = String(dataUrl[dataUrl.index(after: commaIndex)...])
        guard let data = Data(base64Encoded: base64String) else { return nil }
        return UIImage(data: data)
    }
}

// MARK: - Preview-only initializer for V1ScreenCatalogView

extension V1ShareSongView {
    /// Preview initializer with mock data - only for V1ScreenCatalogView
    init() {
        self.apiClient = APIClient(baseURL: AppConfig.apiBaseURL)
        self.trackId = "preview-track"
        self.versionNum = 1
        self.trackTitle = "Happy Birthday Song"
        self.recipientName = "Chioma"
        self.onDismiss = {}
    }
}

// MARK: - Now Playing Preview (v1.pen 19)

struct V1NowPlayingPreviewView: View {
    @StateObject private var playerState = PlayerState()

    var body: some View {
        NowPlayingView(
            playerState: playerState,
            onDismiss: {},
            onPlayPause: {},
            onSeek: { _ in }
        )
        .onAppear {
            playerState.currentTrack = V1NowPlayingPreviewView.sampleTrack
            playerState.currentVersion = V1NowPlayingPreviewView.sampleVersion
            playerState.duration = 185
            playerState.currentTime = 42
            playerState.isPlaying = true
        }
    }

    private static let sampleTrack = Track(
        id: "track_preview",
        userId: "user_preview",
        title: "Song for Chioma",
        occasion: "celebration",
        recipientName: "Chioma",
        style: "soul",
        durationTarget: 180,
        voiceMode: "ai_voice",
        message: "Thank you for your strength",
        status: "ready",
        latestVersion: 1,
        shareTokenId: nil,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
        coverImageUrl: nil,
        coverImageSmallUrl: nil,
        coverImageLargeUrl: nil
    )

    private static let sampleVersion = TrackVersion(
        id: "version_preview",
        trackId: "track_preview",
        versionNum: 1,
        status: "ready",
        renderType: "preview",
        lyricsStatus: "approved",
        lyricsJson: nil,
        previewUrl: nil,
        fullUrl: nil,
        previewJobId: nil,
        fullJobId: nil,
        moderationStatus: nil,
        moderationReason: nil,
        lastErrorCode: nil,
        lastErrorMessage: nil,
        lastErrorTerms: nil,
        createdAt: "2026-01-01",
        completedAt: "2026-01-01",
        coverImageUrl: nil,
        coverImageSmallUrl: nil,
        coverImageLargeUrl: nil
    )
}
