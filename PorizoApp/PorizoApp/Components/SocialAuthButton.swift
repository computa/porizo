import SwiftUI

struct SocialAuthButton: View {
    let provider: SocialProvider
    let action: () -> Void

    enum SocialProvider {
        case apple
        case google
        case twitter
        case facebook

        var icon: String {
            switch self {
            case .apple: return "apple.logo"
            case .google: return "g.circle.fill"
            case .twitter: return "at"
            case .facebook: return "f.circle.fill"
            }
        }

        var label: String {
            switch self {
            case .apple: return "Apple"
            case .google: return "Google"
            case .twitter: return "X"
            case .facebook: return "Facebook"
            }
        }
    }

    var body: some View {
        Button(action: action) {
            Image(systemName: provider.icon)
                .font(.system(size: 24))
                .foregroundStyle(DesignTokens.textPrimary)
                .frame(width: 56, height: 56)
                .background(DesignTokens.surface)
                .clipShape(.rect(cornerRadius: DesignTokens.radiusMedium))
                .overlay(
                    RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                        .stroke(DesignTokens.borderSubtle, lineWidth: 1)
                )
        }
    }
}
