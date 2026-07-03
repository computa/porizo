import SwiftUI

/// Persistent mini-player shown above the tab bar whenever a track is loaded
/// (U3). Mirrors iOS `MiniPlayerBar` — tap opens NowPlaying, play/pause inline.
struct MiniPlayerBar: View {
    let player: AndroidPlayerModel
    let onTap: () -> Void

    var body: some View {
        if let track = player.currentTrack {
            Button(action: onTap) {
                VStack(spacing: 0) {
                    ProgressView(value: player.progressFraction)
                        .tint(PorizoAndroidTheme.gold)
                        .frame(height: 2)

                    HStack(spacing: 12) {
                        Circle()
                            .fill(PorizoAndroidTheme.gold.opacity(0.18))
                            .frame(width: 40, height: 40)
                            .overlay(
                                Image(systemName: "music.note")
                                    .font(.system(size: 18, weight: .semibold))
                                    .foregroundStyle(PorizoAndroidTheme.goldDark)
                            )

                        VStack(alignment: .leading, spacing: 2) {
                            Text(track.title)
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(PorizoAndroidTheme.textPrimary)
                                .lineLimit(1)
                            if let recipient = track.recipientName, !recipient.isEmpty {
                                Text("For \(recipient)")
                                    .font(.system(size: 12))
                                    .foregroundStyle(PorizoAndroidTheme.textSecondary)
                                    .lineLimit(1)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)

                        Button {
                            player.toggle()
                        } label: {
                            Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                                .font(.system(size: 20, weight: .bold))
                                .foregroundStyle(PorizoAndroidTheme.goldDark)
                                .frame(width: 44, height: 44)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(player.isPlaying ? "Pause" : "Play")
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                }
                .background(PorizoAndroidTheme.surface)
            }
            .buttonStyle(.plain)
        }
    }
}
