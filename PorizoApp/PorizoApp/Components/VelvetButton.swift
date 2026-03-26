import SwiftUI

struct VelvetButton: View {
    let title: String
    let icon: String?
    let action: () -> Void
    let style: VelvetButtonStyle
    var isLoading: Bool = false
    var isDisabled: Bool = false
    var accessibilityLabelOverride: String? = nil

    enum VelvetButtonStyle {
        case primary
        case secondary
        case ghost
    }

    init(
        _ title: String,
        icon: String? = nil,
        style: VelvetButtonStyle = .primary,
        isLoading: Bool = false,
        isDisabled: Bool = false,
        accessibilityLabel: String? = nil,
        action: @escaping () -> Void
    ) {
        self.title = title
        self.icon = icon
        self.style = style
        self.isLoading = isLoading
        self.isDisabled = isDisabled
        self.accessibilityLabelOverride = accessibilityLabel
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: DesignTokens.spacing12) {
                if isLoading {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: textColor))
                        .scaleEffect(0.9)
                } else {
                    if let icon = icon {
                        Image(systemName: icon)
                            .font(.system(size: 20, weight: .medium))
                    }
                    Text(title)
                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                }
            }
            .foregroundStyle(textColor)
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .background(backgroundColor)
            .clipShape(Capsule())
            .overlay(
                Capsule()
                    .stroke(borderColor, lineWidth: style == .secondary ? 1 : 0)
            )
        }
        .disabled(isDisabled || isLoading)
        .opacity(isDisabled ? 0.5 : 1.0)
        .accessibilityLabel(accessibilityLabelOverride ?? title)
    }

    private var backgroundColor: Color {
        switch style {
        case .primary: return DesignTokens.gold
        case .secondary: return DesignTokens.surface
        case .ghost: return .clear
        }
    }

    private var textColor: Color {
        switch style {
        case .primary: return DesignTokens.background
        case .secondary: return DesignTokens.textPrimary
        case .ghost: return DesignTokens.gold
        }
    }

    private var borderColor: Color {
        switch style {
        case .secondary: return DesignTokens.borderSubtle
        default: return .clear
        }
    }
}
