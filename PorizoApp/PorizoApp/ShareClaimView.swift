//
//  ShareClaimView.swift
//  PorizoApp
//
//  Claim a shared song link and play it on the bound device.
//

import SwiftUI

enum ShareClaimInitialMode: Equatable {
    case devicePlayback
    case previewClaimable
    case previewReadOnly
    case requiresPin
    case blocked(String)
    case unavailable(String)

    static func resolve(for info: ShareInfoResponse) -> ShareClaimInitialMode {
        switch info.status {
        case "claimed":
            if info.canAccess == true {
                return .devicePlayback
            }
            if let streamUrl = info.webStreamUrl, !streamUrl.isEmpty {
                return .previewReadOnly
            }
            return .blocked("This song is already claimed on another device.")
        case "unbound":
            if let streamUrl = info.webStreamUrl, !streamUrl.isEmpty {
                return .previewClaimable
            }
            return .requiresPin
        default:
            return .unavailable("This share link is not available.")
        }
    }
}

struct ShareClaimView: View {
    let apiClient: APIClient
    let shareId: String
    let deviceId: String

    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    let audioPlayer = AudioPlayerService.shared

    @State private var state: ShareClaimState = .loading
    @State private var pin = ""
    @State private var pinError: String?
    @State private var trackInfo: ShareTrackInfo?
    @State private var appDownloadUrl: String?
    @State private var webStreamUrl: String?

    // Task cancellation (separate tasks to avoid race conditions)
    @State private var loadTask: Task<Void, Never>?
    @State private var claimTask: Task<Void, Never>?
    @State private var isClaiming = false
    @FocusState private var pinFocused: Bool

    enum ShareClaimState: Equatable {
        case loading
        case previewClaimable
        case previewReadOnly
        case requiresPin    // Fallback when no web stream available
        case playing        // Fully claimed — device-bound stream
        case blocked(String)
        case error(String)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                DesignTokens.background.ignoresSafeArea()

                VStack(spacing: 24) {
                    contentView
                }
                .padding()
            }
            .navigationTitle("Shared Song")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
        .onTapGesture {
            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        }
        .accessibilityAddTraits(.isButton)
        .onAppear {
            loadShareInfo()
        }
        .onDisappear {
            loadTask?.cancel()
        }
    }

    @ViewBuilder
    private var contentView: some View {
        switch state {
        case .loading:
            ProgressView("Loading share...")
                .foregroundStyle(DesignTokens.textSecondary)

        case .previewClaimable, .previewReadOnly:
            previewView

        case .requiresPin:
            pinEntryView

        case .playing:
            playbackView

        case .blocked(let message):
            statusView(message: message)

        case .error(let message):
            statusView(message: message)
        }
    }

    private var pinEntryView: some View {
        VStack(spacing: 0) {
            Spacer()

            shareHeader

            Spacer()

            VStack(spacing: 12) {
                // No preview is available in this state, so pin entry is the first action.
                Button {
                    pinError = "Enter the 6-digit PIN from the sender."
                    pinFocused = true
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "key.fill")
                        Text("Enter PIN to Listen")
                    }
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(DesignTokens.gold)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                }
                .disabled(isClaiming)

                // Divider label
                Text("or enter the sender's PIN")
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundStyle(DesignTokens.textSecondary)

                // Secondary PIN section — reduced visual weight until focused
                VStack(spacing: 12) {
                    TextField("000000", text: $pin)
                        .keyboardType(.numberPad)
                        .textContentType(.oneTimeCode)
                        .multilineTextAlignment(.center)
                        .font(.system(size: 28, weight: .bold, design: .monospaced))
                        .padding()
                        .background(DesignTokens.surface)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .focused($pinFocused)
                        .onChange(of: pin) { _, newValue in
                            pin = String(newValue.filter { $0.isNumber }.prefix(6))
                            pinError = nil
                        }

                    if let pinError {
                        Text(pinError)
                            .font(.caption)
                            .foregroundStyle(DesignTokens.error)
                    }

                    Button {
                        claimShare()
                    } label: {
                        HStack(spacing: 8) {
                            if isClaiming && !pin.isEmpty {
                                ProgressView()
                                    .tint(.white)
                            }
                            Text(isClaiming && !pin.isEmpty ? "Claiming..." : "Claim & Play")
                        }
                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(pin.count == 6 && !isClaiming ? DesignTokens.gold : DesignTokens.gold.opacity(0.15))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                    .disabled(pin.count != 6 || isClaiming)
                }
                .opacity(pinFocused ? 1.0 : 0.6)
                .scaleEffect(pinFocused ? 1.0 : 0.9)
                .animation(.easeOut(duration: 0.2), value: pinFocused)

                // Bottom links
                Text("Don't have the app? Download Porizo")
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundStyle(DesignTokens.textSecondary)

                Text("Make one for someone you love \u{2192}")
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundStyle(DesignTokens.gold)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 40)
        }
    }

    private var playbackView: some View {
        VStack(spacing: 16) {
            shareHeader

            if audioPlayer.isLoading {
                ProgressView("Preparing playback...")
                    .foregroundStyle(DesignTokens.textSecondary)
            }

            Slider(
                value: Binding(
                    get: { audioPlayer.currentTime },
                    set: { audioPlayer.seek(to: $0) }
                ),
                in: 0...max(audioPlayer.duration, 1)
            )
            .tint(DesignTokens.gold)
            .disabled(audioPlayer.duration <= 0)

            HStack {
                Text(formatTime(audioPlayer.currentTime))
                Spacer()
                Text(formatTime(audioPlayer.duration))
            }
            .font(.caption)
            .foregroundStyle(DesignTokens.textSecondary)

            Button {
                audioPlayer.togglePlayback()
            } label: {
                Image(systemName: audioPlayer.isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(.white)
                    .frame(width: 72, height: 72)
                    .background(DesignTokens.gold)
                    .clipShape(Circle())
            }

            Button {
                reportAbuse()
            } label: {
                Label("Report Abuse", systemImage: "flag.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(DesignTokens.warning)
            }
            .padding(.top, 4)
        }
    }

    private var shareHeader: some View {
        VStack(spacing: 16) {
            // Brand mark
            BrandMarkView(size: 48)

            // Sender text
            Text(senderHeadline)
                .font(DesignTokens.displayFont(size: 22))
                .foregroundStyle(DesignTokens.textPrimary)
                .multilineTextAlignment(.center)

            Text(senderSubline)
                .font(DesignTokens.bodyFont(size: 15))
                .foregroundStyle(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)

            // Mini postcard card
            miniPostcard
        }
    }

    private var senderHeadline: String {
        if let sender = trackInfo?.senderName, !sender.isEmpty {
            return "\(sender) sent you a song"
        }
        return "Someone sent you a song"
    }

    private var senderSubline: String {
        if let recipient = trackInfo?.recipientName, !recipient.isEmpty {
            return "A song made just for \(recipient)"
        }
        return "A song, made just for you"
    }

    private var miniPostcard: some View {
        VStack(spacing: 8) {
            Text("For You")
                .font(DesignTokens.displayFont(size: 20))
                .foregroundStyle(.white)
            StaticWaveformBars(heights: [6, 10, 16, 20, 16, 10, 6], barWidth: 3, spacing: 4)
            Text(trackInfo?.title ?? "Your Song")
                .font(DesignTokens.bodyFont(size: 14))
                .foregroundStyle(.white.opacity(0.8))
        }
        .padding(24)
        .frame(maxWidth: 300)
        .background(
            LinearGradient(
                colors: [DesignTokens.gold, DesignTokens.goldGradientEnd],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private func statusView(message: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 40))
                .foregroundStyle(DesignTokens.warning)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)
            if let appDownloadUrl, let url = URL(string: appDownloadUrl) {
                Link("Get the app", destination: url)
                    .font(.headline)
                    .foregroundStyle(DesignTokens.gold)
            }
            Button {
                reportAbuse()
            } label: {
                Label("Report Abuse", systemImage: "flag.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(DesignTokens.warning)
            }
        }
    }

    private func loadShareInfo() {
        state = .loading
        pin = ""
        pinError = nil

        loadTask = Task {
            do {
                let info = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "loadShareInfo") {
                    try await apiClient.getShareInfo(shareId: shareId, deviceId: deviceId)
                }
                await MainActor.run {
                    trackInfo = info.track ?? info.trackPreview
                    appDownloadUrl = info.appDownloadUrl
                    webStreamUrl = info.webStreamUrl
                }

                switch ShareClaimInitialMode.resolve(for: info) {
                case .devicePlayback:
                    await startPlayback()
                case .previewClaimable:
                    guard let streamUrl = info.webStreamUrl, !streamUrl.isEmpty else {
                        await MainActor.run {
                            state = .error("Share preview is unavailable.")
                        }
                        return
                    }
                    await startWebPreview(streamUrl: streamUrl, claimAllowed: true)
                case .previewReadOnly:
                    guard let streamUrl = info.webStreamUrl, !streamUrl.isEmpty else {
                        await MainActor.run {
                            state = .error("Share preview is unavailable.")
                        }
                        return
                    }
                    await startWebPreview(streamUrl: streamUrl, claimAllowed: false)
                case .requiresPin:
                    await MainActor.run {
                        state = .requiresPin
                    }
                case .blocked(let message):
                    await MainActor.run {
                        state = .blocked(message)
                    }
                case .unavailable(let message):
                    await MainActor.run {
                        state = .error(message)
                    }
                }
            } catch let error as APIClientError {
                await MainActor.run {
                    state = .error(mapShareError(error))
                }
            } catch {
                await MainActor.run {
                    state = .error(error.localizedDescription)
                }
            }
        }
    }

    private func claimShare() {
        let trimmedPin = pin.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmedPin.count == 6 else {
            pinError = "Enter the 6-digit PIN from the sender."
            pinFocused = true
            state = .requiresPin
            return
        }

        pin = trimmedPin
        pinError = nil
        isClaiming = true
        claimTask?.cancel()
        claimTask = Task {
            do {
                _ = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "claimShare") {
                    try await apiClient.claimShare(
                        shareId: shareId,
                        pin: trimmedPin,
                        appVersion: appVersion
                    )
                }
                await MainActor.run { isClaiming = false }
                NotificationCenter.default.post(name: .songLibraryDidChange, object: nil)
                await startPlayback()
            } catch let error as APIClientError {
                await MainActor.run {
                    isClaiming = false
                    pinError = mapShareError(error)
                    state = .requiresPin
                }
            } catch {
                await MainActor.run {
                    isClaiming = false
                    pinError = error.localizedDescription
                    state = .requiresPin
                }
            }
        }
    }

    private func startPlayback() async {
        do {
            let stream = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "getShareStream") {
                try await apiClient.getShareStream(shareId: shareId, deviceId: deviceId)
            }
            guard !Task.isCancelled else { return }
            let deviceToken = await apiClient.currentDeviceToken()
            var headers = ["x-device-id": deviceId, "x-platform": "ios"]
            if let deviceToken {
                headers["x-device-token"] = deviceToken
            }
            await MainActor.run {
                guard !Task.isCancelled else { return }
                let metadata = NowPlayingMetadata(
                    title: trackInfo?.title ?? "Shared Song",
                    artist: trackInfo?.recipientName
                )
                audioPlayer.play(url: stream.streamUrl, headers: headers, metadata: metadata)
                state = .playing
            }
        } catch let error as APIClientError {
            await MainActor.run {
                state = .error(mapShareError(error))
            }
        } catch {
            await MainActor.run {
                state = .error(error.localizedDescription)
            }
        }
    }

    private func startWebPreview(streamUrl: String, claimAllowed: Bool) async {
        await MainActor.run {
            let metadata = NowPlayingMetadata(
                title: trackInfo?.title ?? "Shared Song",
                artist: trackInfo?.recipientName
            )
            audioPlayer.play(url: streamUrl, headers: nil, metadata: metadata)
            state = claimAllowed ? .previewClaimable : .previewReadOnly
        }
    }

    // MARK: - Preview View (Listen-first)

    private var previewView: some View {
        VStack(spacing: 0) {
            Spacer()

            shareHeader

            Spacer()

            // Playback controls
            VStack(spacing: 16) {
                if audioPlayer.isLoading {
                    ProgressView("Preparing playback...")
                        .foregroundStyle(DesignTokens.textSecondary)
                }

                Slider(
                    value: Binding(
                        get: { audioPlayer.currentTime },
                        set: { audioPlayer.seek(to: $0) }
                    ),
                    in: 0...max(audioPlayer.duration, 1)
                )
                .tint(DesignTokens.gold)
                .disabled(audioPlayer.duration <= 0)

                HStack {
                    Text(formatTime(audioPlayer.currentTime))
                    Spacer()
                    Text(formatTime(audioPlayer.duration))
                }
                .font(.caption)
                .foregroundStyle(DesignTokens.textSecondary)

                Button {
                    audioPlayer.togglePlayback()
                } label: {
                    Image(systemName: audioPlayer.isPlaying ? "pause.fill" : "play.fill")
                        .font(.system(size: 28))
                        .foregroundStyle(.white)
                        .frame(width: 72, height: 72)
                        .background(DesignTokens.gold)
                        .clipShape(Circle())
                }
            }
            .padding(.horizontal, 20)

            if state == .previewClaimable {
                VStack(spacing: 12) {
                    Text("Want to save this song?")
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundStyle(DesignTokens.textSecondary)
                        .padding(.top, 24)

                    Button {
                        state = .requiresPin
                    } label: {
                        Text("Save to Library")
                            .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                            .foregroundStyle(DesignTokens.gold)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(DesignTokens.surface)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(DesignTokens.gold.opacity(0.5), lineWidth: 1)
                            )
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 40)
            } else {
                VStack(spacing: 8) {
                    Text("This song is already claimed.")
                        .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                        .foregroundStyle(DesignTokens.textSecondary)
                        .padding(.top, 24)
                    Text("You can still listen here, but ownership stays with the recipient who claimed it.")
                        .font(DesignTokens.bodyFont(size: 13))
                        .foregroundStyle(DesignTokens.textTertiary)
                        .multilineTextAlignment(.center)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 40)
            }
        }
    }

    private func mapShareError(_ error: APIClientError) -> String {
        switch error {
        case .notAuthenticated:
            return "This share couldn't be verified on this device. Open the link again and try once more."
        case .serverError(let message, let code, _):
            switch code {
            case "INVALID_PIN":
                return "That PIN doesn't look right. Check it with the sender and try again."
            case "DEVICE_TOKEN_REQUIRED":
                return "Open this share from the app on the device that will play it."
            default:
                return message
            }
        case .httpError(let statusCode, _):
            switch statusCode {
            case 404:
                return "Share link not found."
            case 410:
                return "This share link has expired."
            case 401:
                return "That PIN doesn't look right. Check it with the sender and try again."
            case 403:
                return "Access denied for this share."
            case 429:
                return "Too many attempts. Please request a new link."
            default:
                return error.localizedDescription
            }
        default:
            return error.localizedDescription
        }
    }

    private var appVersion: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String
        if let version, let build {
            return "\(version) (\(build))"
        }
        return version ?? "unknown"
    }

    private func reportAbuse() {
        let subject = "Report abusive shared song"
        let body = """
        Share ID: \(shareId)
        Track title: \(trackInfo?.title ?? "unknown")
        Recipient: \(trackInfo?.recipientName ?? "unknown")

        Please review this shared content.
        """

        let subjectEncoded = subject.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        let bodyEncoded = body.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        guard let url = URL(string: "mailto:abuse@porizo.co?subject=\(subjectEncoded)&body=\(bodyEncoded)") else {
            return
        }
        openURL(url)
    }
}
