import SwiftUI
import AVFoundation

struct ReceiverClaimView: View {
    let apiClient: APIClient
    let claimToken: String
    let receiverSessionId: String?
    let onClaimed: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var pin = ""
    @State private var error: String?
    @State private var isClaiming = false
    @State private var isPreparingPlayback = false
    @State private var didClaim = false
    @State private var player: AVPlayer?
    @FocusState private var pinFocused: Bool

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Spacer()

                BrandMarkView(size: 56)

                Image(systemName: didClaim ? "checkmark.circle.fill" : "gift.fill")
                    .font(.system(size: 52))
                    .foregroundStyle(didClaim ? DesignTokens.success : DesignTokens.gold)

                Text(didClaim ? "Song saved" : "Save this song")
                    .font(DesignTokens.displayFont(size: 28))
                    .foregroundStyle(DesignTokens.textPrimary)

                Text(didClaim ? "This song is saved to this device." : "Enter the sender's PIN if this gift has one.")
                    .font(DesignTokens.bodyFont(size: 15))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)

                if didClaim {
                    Button {
                        if player == nil {
                            Task {
                                await preparePlayback()
                            }
                        } else {
                            playClaimedSong()
                        }
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: player == nil ? "arrow.clockwise" : "play.fill")
                            Text(playbackButtonTitle)
                        }
                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(isPreparingPlayback ? DesignTokens.gold.opacity(0.5) : DesignTokens.gold)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                    .disabled(isPreparingPlayback)

                    if isPreparingPlayback {
                        ProgressView()
                            .tint(DesignTokens.gold)
                    }
                }

                if let error {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(DesignTokens.error)
                        .multilineTextAlignment(.center)
                }

                if !didClaim {
                    TextField("PIN optional", text: $pin)
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
                            error = nil
                        }

                    Button {
                        claim()
                    } label: {
                        HStack(spacing: 8) {
                            if isClaiming {
                                ProgressView().tint(.white)
                            }
                            Text(isClaiming ? "Saving..." : "Claim & Save")
                        }
                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(isClaiming ? DesignTokens.gold.opacity(0.5) : DesignTokens.gold)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                    .disabled(isClaiming)
                }

                Spacer()
            }
            .padding()
            .background(DesignTokens.background.ignoresSafeArea())
            .onDisappear {
                player?.pause()
            }
            .navigationTitle("Shared Song")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func claim() {
        guard !isClaiming else { return }
        isClaiming = true
        error = nil

        Task {
            do {
                _ = try await apiClient.claimReceiverToken(
                    claimToken: claimToken,
                    pin: pin,
                    appVersion: appVersion
                )
                await MainActor.run {
                    isClaiming = false
                    didClaim = true
                    NotificationCenter.default.post(name: .songLibraryDidChange, object: nil)
                    onClaimed()
                }
                await preparePlayback()
            } catch let apiError as APIClientError {
                await MainActor.run {
                    isClaiming = false
                    error = mapError(apiError)
                    pinFocused = true
                }
            } catch {
                await MainActor.run {
                    isClaiming = false
                    self.error = error.localizedDescription
                }
            }
        }
    }

    private func preparePlayback() async {
        await MainActor.run {
            isPreparingPlayback = true
        }
        do {
            let stream = try await apiClient.getReceiverClaimStream(claimToken: claimToken)
            guard let url = URL(string: stream.streamUrl) else {
                throw APIClientError.invalidResponse
            }
            await MainActor.run {
                player = AVPlayer(url: url)
                isPreparingPlayback = false
            }
        } catch {
            await MainActor.run {
                isPreparingPlayback = false
                self.error = "Saved, but playback is not ready yet. Try again in a moment."
            }
        }
    }

    private func playClaimedSong() {
        player?.seek(to: .zero)
        player?.play()
    }

    private func mapError(_ error: APIClientError) -> String {
        switch error {
        case .serverError(let message, let code, _):
            if code == "INVALID_PIN" {
                return "That PIN doesn't look right. Check it with the sender and try again."
            }
            return message
        case .httpError(let statusCode, _):
            switch statusCode {
            case 401:
                return "That PIN doesn't look right. Check it with the sender and try again."
            case 404:
                return "This save link expired. Open the gift link again from the browser."
            case 409:
                return "This song has already been claimed on another device."
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

    private var playbackButtonTitle: String {
        if isPreparingPlayback {
            return "Preparing..."
        }
        return player == nil ? "Retry Playback" : "Play Song"
    }
}
