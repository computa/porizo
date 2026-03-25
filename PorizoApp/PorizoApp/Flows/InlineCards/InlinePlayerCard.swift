//
//  InlinePlayerCard.swift
//  PorizoApp
//
//  Inline song player card for the All-in-Chat creation flow.
//  Sheet-style card with album art, scrubber, transport controls,
//  and action buttons. Uses standard Slider for ScrollView safety.
//

import SwiftUI

struct InlinePlayerCard: View {
    enum PlayerDisplayMode {
        case preview
        case fullRenderInProgress
        case fullSong
    }

    var playbackController: PlaybackController
    let trackTitle: String
    let recipientName: String
    var displayMode: PlayerDisplayMode = .preview
    let coverImageUrl: String?
    var isRerolling: Bool = false
    // Actions
    let onGetFullSong: () -> Void
    let onShare: () -> Void
    let onReroll: () -> Void
    let onDone: () -> Void

    @State private var isSeeking = false
    @State private var seekValue: Double = 0

    private var displayProgress: Double {
        isSeeking ? seekValue : playbackController.playbackProgress
    }

    var body: some View {
        VStack(spacing: 0) {
            // Sheet handle
            RoundedRectangle(cornerRadius: 2)
                .fill(DesignTokens.textTertiary)
                .frame(width: 36, height: 4)
                .padding(.top, 12)
                .padding(.bottom, 16)

            // Success badge
            HStack(spacing: 8) {
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 18))
                    .foregroundStyle(DesignTokens.success)
                Text("Song Created!")
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    .foregroundStyle(DesignTokens.textPrimary)
            }
            .padding(.bottom, 16)

            // Player content
            VStack(spacing: 14) {
                albumArt
                if let playbackError = playbackController.playbackError {
                    playbackErrorState(playbackError)
                } else {
                    scrubber
                    transportControls
                }
            }
            .padding(.horizontal, 16)

            // Get Full Song CTA / rendering indicator / hidden for full song
            switch displayMode {
            case .preview:
                fullSongButton
                    .padding(.horizontal, 16)
                    .padding(.top, 14)
            case .fullRenderInProgress:
                renderingInProgressIndicator
                    .padding(.horizontal, 16)
                    .padding(.top, 14)
            case .fullSong:
                EmptyView()
            }

            // Action buttons row
            actionButtons
                .padding(.horizontal, 16)
                .padding(.top, 14)
                .padding(.bottom, 16)
        }
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .overlay(
            RoundedRectangle(cornerRadius: 20)
                .stroke(DesignTokens.border, lineWidth: 0.5)
        )
    }

    private var badgeText: String {
        switch displayMode {
        case .preview: "Preview"
        case .fullRenderInProgress: "Rendering..."
        case .fullSong: "Full Song"
        }
    }

    // MARK: - Album Art

    private var albumArt: some View {
        ZStack {
            if let urlString = coverImageUrl, let url = URL(string: urlString) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                            .frame(height: 160)
                            .clipShape(RoundedRectangle(cornerRadius: 14))
                    default:
                        goldGradientArt
                    }
                }
            } else {
                goldGradientArt
            }

            // Preview / Full Song badge
            VStack {
                HStack {
                    Spacer()
                    Text(badgeText)
                        .font(DesignTokens.bodyFont(size: 10, weight: .semibold))
                        .foregroundStyle(displayMode == .fullSong ? .black : DesignTokens.textPrimary)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(displayMode == .fullSong ? DesignTokens.gold : DesignTokens.surface.opacity(0.85))
                        .clipShape(Capsule())
                }
                .padding(10)
                Spacer()
            }
        }
        .frame(height: 160)
    }

    private var goldGradientArt: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 14)
                .fill(
                    LinearGradient(
                        colors: [DesignTokens.gold.opacity(0.4), DesignTokens.goldDark.opacity(0.2)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .frame(height: 160)

            VStack(spacing: 8) {
                Image(systemName: "music.note")
                    .font(.system(size: 36))
                    .foregroundStyle(DesignTokens.gold)
                Text(trackTitle)
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .lineLimit(1)
                Text("For \(recipientName)")
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundStyle(DesignTokens.textSecondary)
            }
        }
    }

    // MARK: - Scrubber (Slider-based for ScrollView safety)

    private var scrubber: some View {
        VStack(spacing: 4) {
            Slider(
                value: Binding(
                    get: { displayProgress },
                    set: { seekValue = $0 }
                ),
                in: 0...1,
                onEditingChanged: { editing in
                    isSeeking = editing
                    if !editing {
                        let targetTime = seekValue * playbackController.duration
                        playbackController.seek(to: targetTime)
                    }
                }
            )
            .tint(DesignTokens.gold)

            HStack {
                Text(formatTime(displayProgress * playbackController.duration))
                Spacer()
                Text(formatTime(playbackController.duration))
            }
            .font(DesignTokens.bodyFont(size: 10))
            .foregroundStyle(DesignTokens.textTertiary)
        }
    }

    // MARK: - Transport Controls

    private var transportControls: some View {
        HStack(spacing: 24) {
            Spacer()
            Button {
                let newTime = max(0, playbackController.currentTime - 10)
                playbackController.seek(to: newTime)
            } label: {
                Image(systemName: "backward.fill")
                    .font(.system(size: 20))
                    .foregroundStyle(DesignTokens.textSecondary)
            }
            .accessibilityLabel("Skip back 10 seconds")

            Button {
                playbackController.togglePlayPause()
            } label: {
                Image(systemName: playbackController.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(DesignTokens.gold)
            }
            .accessibilityLabel(playbackController.isPlaying ? "Pause" : "Play")

            Button {
                let newTime = min(playbackController.duration, playbackController.currentTime + 10)
                playbackController.seek(to: newTime)
            } label: {
                Image(systemName: "forward.fill")
                    .font(.system(size: 20))
                    .foregroundStyle(DesignTokens.textSecondary)
            }
            .accessibilityLabel("Skip forward 10 seconds")
            Spacer()
        }
    }

    private func playbackErrorState(_ error: String) -> some View {
        VStack(spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(DesignTokens.warning)
                Text("Playback Error")
                    .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                    .foregroundStyle(DesignTokens.textPrimary)
            }

            Text(error)
                .font(DesignTokens.bodyFont(size: 13))
                .foregroundStyle(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)

            Button {
                playbackController.retryPlayback()
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 13, weight: .medium))
                    Text("Retry")
                        .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                }
                .foregroundStyle(DesignTokens.gold)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(DesignTokens.gold.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 20)
        .padding(.horizontal, 16)
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
        .overlay(
            RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                .stroke(DesignTokens.border, lineWidth: 0.5)
        )
    }

    // MARK: - Get Full Song Button

    private var fullSongButton: some View {
        Button(action: onGetFullSong) {
            HStack(spacing: 6) {
                Image(systemName: "sparkles")
                    .font(.system(size: 14))
                Text("Get Full Song")
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
            }
            .foregroundStyle(.black)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(DesignTokens.gold)
            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
        }
    }

    // MARK: - Rendering In Progress

    private var renderingInProgressIndicator: some View {
        HStack(spacing: 8) {
            ProgressView()
                .tint(DesignTokens.gold)
            Text("Rendering full song...")
                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                .foregroundStyle(DesignTokens.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(DesignTokens.gold.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
    }

    // MARK: - Action Buttons

    private var actionButtons: some View {
        HStack(spacing: 12) {
            actionButton(icon: "square.and.arrow.up", label: "Share", action: onShare)
            actionButton(
                icon: "arrow.triangle.2.circlepath",
                label: isRerolling ? "Creating..." : "Reroll",
                action: onReroll
            )
            .disabled(isRerolling)
            .opacity(isRerolling ? 0.5 : 1.0)
            actionButton(icon: "checkmark", label: "Done", action: onDone)
        }
    }

    private func actionButton(icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 16))
                Text(label)
                    .font(DesignTokens.bodyFont(size: 11))
            }
            .foregroundStyle(DesignTokens.textSecondary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(DesignTokens.surface)
            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
            .overlay(
                RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                    .stroke(DesignTokens.border, lineWidth: 0.5)
            )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Preview

#Preview {
    ZStack {
        DesignTokens.background.ignoresSafeArea()

        ScrollView {
            VStack(spacing: 16) {
                InlinePlayerCard(
                    playbackController: PlaybackController(),
                    trackTitle: "Birthday Song for Sarah",
                    recipientName: "Sarah",
                    displayMode: .preview,
                    coverImageUrl: nil,
                    onGetFullSong: { print("Get full song") },
                    onShare: { print("Share") },
                    onReroll: { print("Reroll") },
                    onDone: { print("Done") }
                )

                InlinePlayerCard(
                    playbackController: PlaybackController(),
                    trackTitle: "Anniversary Song",
                    recipientName: "Mom",
                    displayMode: .fullSong,
                    coverImageUrl: nil,
                    onGetFullSong: {},
                    onShare: { print("Share") },
                    onReroll: { print("Reroll") },
                    onDone: { print("Done") }
                )
            }
            .padding(.horizontal, 16)
        }
    }
}
