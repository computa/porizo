import SwiftUI

struct MiniPlayerBar: View {
    var playerState: PlayerState
    let onTap: () -> Void
    let onPlayPause: () -> Void
    let onClose: () -> Void

    @State private var hapticTrigger = false

    var body: some View {
        VStack(spacing: 0) {
            // Gold accent line on top
            Rectangle()
                .fill(DesignTokens.gold)
                .frame(height: 1)

            HStack(spacing: 12) {
                // Album art: 44x44, 8px radius
                if let track = playerState.currentTrack {
                    SongCoverView(track: track, size: 44)
                } else {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(LinearGradient(
                            colors: [DesignTokens.gold, DesignTokens.goldDark],
                            startPoint: .topLeading, endPoint: .bottomTrailing))
                        .frame(width: 44, height: 44)
                        .overlay(
                            Image(systemName: "music.note")
                                .font(.system(size: 16))
                                .foregroundStyle(.white)
                        )
                }

                // Track info
                VStack(alignment: .leading, spacing: 2) {
                    Text(playerState.currentTrack?.title ?? "Now Playing")
                        .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                        .foregroundStyle(DesignTokens.textPrimary)
                        .lineLimit(1)

                    Text(subtitleText)
                        .font(DesignTokens.bodyFont(size: 13))
                        .foregroundStyle(DesignTokens.textSecondary)
                        .lineLimit(1)
                }

                Spacer()

                // Play/Pause + Close
                HStack(spacing: 16) {
                    Button {
                        hapticTrigger.toggle()
                        onPlayPause()
                    } label: {
                        if playerState.isLoading {
                            ProgressView()
                                .tint(DesignTokens.gold)
                                .scaleEffect(0.8)
                        } else {
                            Image(systemName: playerState.isPlaying ? "pause.fill" : "play.fill")
                                .font(.system(size: 22))
                                .foregroundStyle(DesignTokens.gold)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(playerState.isPlaying ? "Pause" : "Play")

                    Button {
                        hapticTrigger.toggle()
                        onClose()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(DesignTokens.textTertiary)
                            .frame(minWidth: 44, minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Close player")
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(DesignTokens.surface)
        }
        .sensoryFeedback(.impact(weight: .light), trigger: hapticTrigger)
        .contentShape(Rectangle())
        .onTapGesture {
            onTap()
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel("\(playerState.currentTrack?.title ?? "Song"), \(playerState.isPlaying ? "playing" : "paused")")
        .accessibilityHint("Double tap to expand player")
    }

    private var subtitleText: String {
        guard let track = playerState.currentTrack else { return "" }
        var parts: [String] = []

        if let recipient = track.recipientName, !recipient.isEmpty {
            parts.append("For \(recipient)")
        }

        if let occasion = track.occasion, let occ = Occasion(rawValue: occasion) {
            parts.append(occ.displayName)
        }

        return parts.joined(separator: " · ")
    }
}

#Preview("Mini Player") {
    let state = PlayerState()
    state.currentTrack = Track(
        id: "1",
        userId: "user",
        title: "Happy Birthday Mom",
        occasion: "birthday",
        recipientName: "Mom",
        style: "soul",
        durationTarget: 60,
        voiceMode: "ai_voice",
        message: "A heartfelt birthday song",
        status: "preview_ready",
        latestVersion: 1,
        shareTokenId: nil,
        createdAt: "2025-01-01",
        updatedAt: "2025-01-01",
        coverImageUrl: nil,
        coverImageSmallUrl: nil,
        coverImageLargeUrl: nil
    )
    state.isPlaying = true
    state.currentTime = 15
    state.duration = 45

    return VStack {
        Spacer()
        MiniPlayerBar(
            playerState: state,
            onTap: { },
            onPlayPause: { },
            onClose: { }
        )
    }
    .background(DesignTokens.surface)
}
