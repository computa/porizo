import SwiftUI

struct VoiceBanner: View {
    let profile: VoiceProfileStatus?
    let isLoading: Bool
    let onTap: () -> Void

    private var state: VoiceBannerState {
        guard let profile else { return .notEnrolled }
        switch profile.myVoiceReadiness {
        case .ready: return .ready
        case .preparing: return .preparing
        case .failed: return .failed
        case .setupRequired: return .setupRequired
        case .none: return .notEnrolled
        }
    }

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
                        Image(systemName: state.iconName)
                            .font(.system(size: 24))
                            .foregroundStyle(.white)
                    }
                }

                VStack(alignment: .leading, spacing: DesignTokens.spacing4) {
                    if state.showsVoiceStatus {
                        HStack(spacing: DesignTokens.spacing4) {
                            Image(systemName: state.badgeIconName)
                                .font(.caption)
                            Text(state.title)
                                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        }
                        .foregroundStyle(.white)

                        Text(state.subtitle(qualityScore: profile?.qualityScore))
                            .font(DesignTokens.bodyFont(size: 13))
                            .foregroundStyle(.white.opacity(0.8))
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

                if state.showsSetupButton && !isLoading {
                    Text("Set Up")
                        .font(DesignTokens.bodyFont(size: 13, weight: .semibold))
                        .foregroundStyle(DesignTokens.gold)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                } else if state.showsVoiceStatus {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.6))
                }
            }
            .padding(16)
            .background(
                LinearGradient(
                    colors: [DesignTokens.gold, DesignTokens.goldGradientEnd],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
        .buttonStyle(.plain)
    }
}

private enum VoiceBannerState {
    case ready
    case preparing
    case failed
    case setupRequired
    case notEnrolled

    var title: String {
        switch self {
        case .ready:
            return "My Voice Ready"
        case .preparing:
            return "My Voice Preparing"
        case .failed:
            return "My Voice Setup Failed"
        case .setupRequired:
            return "Finish My Voice Setup"
        case .notEnrolled:
            return "Your Voice"
        }
    }

    var iconName: String {
        switch self {
        case .ready, .preparing, .failed, .setupRequired:
            return "waveform.circle.fill"
        case .notEnrolled:
            return "mic.fill"
        }
    }

    var badgeIconName: String {
        switch self {
        case .ready:
            return "checkmark.circle.fill"
        case .preparing:
            return "clock.fill"
        case .failed:
            return "exclamationmark.triangle.fill"
        case .setupRequired, .notEnrolled:
            return "mic.circle.fill"
        }
    }

    var showsVoiceStatus: Bool {
        self != .notEnrolled
    }

    var showsSetupButton: Bool {
        self == .notEnrolled
    }

    func subtitle(qualityScore: Double?) -> String {
        switch self {
        case .ready:
            if let qualityScore {
                return "Quality: \(Int(qualityScore))%"
            }
            return "Ready for songs"
        case .preparing:
            return "Preparing in the background"
        case .failed:
            return "Tap to re-record sung lines"
        case .setupRequired:
            return "Tap to complete setup"
        case .notEnrolled:
            return "Set up your voice"
        }
    }
}
