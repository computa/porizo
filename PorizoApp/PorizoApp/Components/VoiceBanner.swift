import SwiftUI

struct VoiceBanner: View {
    let hasProfile: Bool
    let qualityScore: Double?
    let isLoading: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: DesignTokens.spacing16) {
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
                                .font(.headline)
                        }
                        .foregroundStyle(.white)

                        if let score = qualityScore {
                            Text("Quality: \(Int(score))%")
                                .font(.caption)
                                .foregroundStyle(.white.opacity(0.8))
                        }
                    } else {
                        Text("Your Voice")
                            .font(.headline)
                            .foregroundStyle(.white)

                        Text("Add your voice to songs")
                            .font(.subheadline)
                            .foregroundStyle(.white.opacity(0.8))
                    }
                }

                Spacer()

                if !hasProfile && !isLoading {
                    Text("Set Up")
                        .font(.subheadline.bold())
                        .foregroundStyle(DesignTokens.gold)
                        .padding(.horizontal, DesignTokens.spacing12)
                        .padding(.vertical, DesignTokens.spacing8)
                        .background(Color.white)
                        .clipShape(Capsule())
                } else if hasProfile {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.6))
                }
            }
            .padding(DesignTokens.spacing16)
            .background(
                LinearGradient(
                    colors: [DesignTokens.gold, DesignTokens.gold],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusLarge))
            .elevation(.level2)
        }
        .buttonStyle(.plain)
    }
}
