//
//  ShareClaimView.swift
//  PorizoApp
//
//  Claim a shared song link and play it on the bound device.
//

import SwiftUI

struct ShareClaimView: View {
    let apiClient: APIClient
    let shareId: String
    let deviceId: String

    @Environment(\.dismiss) private var dismiss
    @StateObject private var audioPlayer = AudioPlayerService.shared

    @State private var state: ShareClaimState = .loading
    @State private var pin = ""
    @State private var pinError: String?
    @State private var trackInfo: ShareTrackInfo?
    @State private var appDownloadUrl: String?

    enum ShareClaimState: Equatable {
        case loading
        case requiresPin
        case playing
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
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
        .onAppear {
            loadShareInfo()
        }
        .onDisappear {
            audioPlayer.stop()
        }
    }

    @ViewBuilder
    private var contentView: some View {
        switch state {
        case .loading:
            ProgressView("Loading share...")
                .foregroundColor(DesignTokens.textSecondary)

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
        VStack(spacing: 16) {
            shareHeader

            Text("Enter the 6-digit PIN from the sender to claim this song.")
                .font(.subheadline)
                .foregroundColor(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)

            TextField("000000", text: $pin)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .multilineTextAlignment(.center)
                .font(.system(size: 28, weight: .bold, design: .monospaced))
                .padding()
                .background(DesignTokens.cardBackground)
                .cornerRadius(12)
                .onChange(of: pin) { newValue in
                    pin = String(newValue.filter { $0.isNumber }.prefix(6))
                    pinError = nil
                }

            if let pinError {
                Text(pinError)
                    .font(.caption)
                    .foregroundColor(DesignTokens.error)
            }

            Button {
                claimShare()
            } label: {
                Text("Claim & Play")
                    .font(.headline)
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(pin.count == 6 ? DesignTokens.rose : DesignTokens.roseMuted)
                    .cornerRadius(12)
            }
            .disabled(pin.count != 6)
        }
    }

    private var playbackView: some View {
        VStack(spacing: 16) {
            shareHeader

            if audioPlayer.isLoading {
                ProgressView("Preparing playback...")
                    .foregroundColor(DesignTokens.textSecondary)
            }

            Slider(
                value: Binding(
                    get: { audioPlayer.currentTime },
                    set: { audioPlayer.seek(to: $0) }
                ),
                in: 0...max(audioPlayer.duration, 1)
            )
            .tint(DesignTokens.rose)
            .disabled(audioPlayer.duration <= 0)

            HStack {
                Text(formatTime(audioPlayer.currentTime))
                Spacer()
                Text(formatTime(audioPlayer.duration))
            }
            .font(.caption)
            .foregroundColor(DesignTokens.textSecondary)

            Button {
                audioPlayer.togglePlayback()
            } label: {
                Image(systemName: audioPlayer.isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 28))
                    .foregroundColor(.white)
                    .frame(width: 72, height: 72)
                    .background(DesignTokens.rose)
                    .clipShape(Circle())
            }
        }
    }

    private var shareHeader: some View {
        VStack(spacing: 8) {
            Text(trackInfo?.title ?? "Your Song")
                .font(.title2.bold())
                .foregroundColor(DesignTokens.textPrimary)
                .multilineTextAlignment(.center)

            if let recipient = trackInfo?.recipientName, !recipient.isEmpty {
                Text("Made for \(recipient)")
                    .font(.subheadline)
                    .foregroundColor(DesignTokens.textSecondary)
            }
        }
    }

    private func statusView(message: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 40))
                .foregroundColor(DesignTokens.warning)
            Text(message)
                .font(.subheadline)
                .foregroundColor(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)
            if let appDownloadUrl, let url = URL(string: appDownloadUrl) {
                Link("Get the app", destination: url)
                    .font(.headline)
                    .foregroundColor(DesignTokens.rose)
            }
        }
    }

    private func loadShareInfo() {
        state = .loading

        Task {
            do {
                let info = try await apiClient.getShareInfo(shareId: shareId, deviceId: deviceId)
                await MainActor.run {
                    trackInfo = info.track ?? info.trackPreview
                    appDownloadUrl = info.appDownloadUrl
                }

                switch info.status {
                case "claimed":
                    if info.canAccess == true {
                        await startPlayback()
                    } else {
                        await MainActor.run {
                            state = .blocked("This song is already claimed on another device.")
                        }
                    }
                case "unbound":
                    await MainActor.run {
                        state = .requiresPin
                    }
                default:
                    await MainActor.run {
                        state = .error("This share link is not available.")
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
        pinError = nil

        Task {
            do {
                _ = try await apiClient.claimShare(
                    shareId: shareId,
                    pin: pin,
                    deviceId: deviceId,
                    appVersion: appVersion
                )
                await startPlayback()
            } catch let error as APIClientError {
                await MainActor.run {
                    pinError = mapShareError(error)
                    state = .requiresPin
                }
            } catch {
                await MainActor.run {
                    pinError = error.localizedDescription
                    state = .requiresPin
                }
            }
        }
    }

    private func startPlayback() async {
        do {
            let stream = try await apiClient.getShareStream(shareId: shareId, deviceId: deviceId)
            let headers = ["x-device-id": deviceId, "x-platform": "ios"]
            await MainActor.run {
                audioPlayer.play(url: stream.streamUrl, headers: headers)
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

    private func mapShareError(_ error: APIClientError) -> String {
        switch error {
        case .httpError(let statusCode, _):
            switch statusCode {
            case 404:
                return "Share link not found."
            case 410:
                return "This share link has expired."
            case 401:
                return "Invalid PIN. Please try again."
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

    private func formatTime(_ time: Double) -> String {
        if time.isNaN || !time.isFinite {
            return "0:00"
        }
        let minutes = Int(time) / 60
        let seconds = Int(time) % 60
        return String(format: "%d:%02d", minutes, seconds)
    }
}
