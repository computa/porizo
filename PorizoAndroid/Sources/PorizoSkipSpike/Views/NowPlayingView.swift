import SwiftUI

/// Full-screen now-playing surface (U3). Presented as a sheet from the
/// mini-player tap. Mirrors iOS `NowPlayingView`: artwork, title/recipient,
/// scrubber, transport. Synced-lyrics highlight is deferred (P2).
struct NowPlayingView: View {
    let player: AndroidPlayerModel
    let onClose: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            header

            Spacer(minLength: 24)

            artwork
                .padding(.horizontal, 32)

            VStack(spacing: 6) {
                FrauncesTitle(
                    text: player.currentTrack?.title ?? "Nothing playing",
                    size: 26,
                    weight: .bold
                )
                if let recipient = player.currentTrack?.recipientName, !recipient.isEmpty {
                    Text("For \(recipient)")
                        .font(.system(size: 15))
                        .foregroundStyle(PorizoAndroidTheme.textSecondary)
                }
            }
            .padding(.top, 28)
            .padding(.horizontal, 24)

            scrubber
                .padding(.horizontal, 28)
                .padding(.top, 24)

            transport
                .padding(.top, 20)

            Spacer(minLength: 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(PorizoAndroidTheme.background)
    }

    private var header: some View {
        HStack {
            Button(action: onClose) {
                Image(systemName: "chevron.down")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(PorizoAndroidTheme.textPrimary)
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close")
            Spacer()
            Text("Now Playing")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(PorizoAndroidTheme.textSecondary)
            Spacer()
            Color.clear.frame(width: 44, height: 44)
        }
        .padding(.horizontal, 12)
        .padding(.top, 8)
    }

    private var artwork: some View {
        RoundedRectangle(cornerRadius: PorizoAndroidTheme.radiusLarge)
            .fill(PorizoAndroidTheme.gold.opacity(0.16))
            .aspectRatio(1, contentMode: .fit)
            .overlay(
                Image(systemName: "music.note")
                    .font(.system(size: 72, weight: .semibold))
                    .foregroundStyle(PorizoAndroidTheme.goldDark)
            )
    }

    private var scrubber: some View {
        VStack(spacing: 6) {
            ProgressView(value: player.progressFraction)
                .tint(PorizoAndroidTheme.gold)
            HStack {
                Text(Self.timeLabel(player.positionSeconds))
                Spacer()
                Text(Self.timeLabel(player.durationSeconds))
            }
            .font(.system(size: 12))
            .foregroundStyle(PorizoAndroidTheme.textSecondary)
        }
    }

    private var transport: some View {
        Button {
            player.toggle()
        } label: {
            Image(systemName: player.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                .font(.system(size: 64))
                .foregroundStyle(PorizoAndroidTheme.gold)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(player.isPlaying ? "Pause" : "Play")
    }

    static func timeLabel(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 0 else { return "0:00" }
        let total = Int(seconds)
        return "\(total / 60):\(String(format: "%02d", total % 60))"
    }
}
