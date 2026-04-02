import SwiftUI

struct VoiceBanner: View {
    let hasProfile: Bool
    let qualityScore: Double?
    let isLoading: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 14) {
                ZStack {
                    Circle()
                        .fill(Color.white.opacity(0.2))
                        .frame(width: 48, height: 48)

                    if isLoading {
                        ProgressView()
                            .tint(.white)
                    } else {
                        Image(systemName: hasProfile ? "waveform.circle.fill" : "mic.fill")
                            .font(.system(size: 24))
                            .foregroundStyle(.white)
                    }
                }

                VStack(alignment: .leading, spacing: DesignTokens.spacing4) {
                    if hasProfile {
                        HStack(spacing: DesignTokens.spacing4) {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.caption)
                            Text("Voice Profile Active")
                                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        }
                        .foregroundStyle(.white)

                        if let score = qualityScore {
                            Text("Quality: \(Int(score))%")
                                .font(DesignTokens.bodyFont(size: 13))
                                .foregroundStyle(.white.opacity(0.8))
                        }
                    } else {
                        Text("Your Voice")
                            .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                            .foregroundStyle(.white)

                        Text("Set up your voice")
                            .font(DesignTokens.bodyFont(size: 13))
                            .foregroundStyle(.white.opacity(0.8))
                    }
                }

                Spacer()

                if !hasProfile && !isLoading {
                    Text("Set Up")
                        .font(DesignTokens.bodyFont(size: 13, weight: .semibold))
                        .foregroundStyle(DesignTokens.gold)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                } else if hasProfile {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.6))
                }
            }
            .padding(16)
            .background(
                LinearGradient(
                    colors: [DesignTokens.gold, Color(hex: "#e8966e")],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
        .buttonStyle(.plain)
    }
}
