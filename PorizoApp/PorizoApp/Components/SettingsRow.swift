import SwiftUI

struct SettingsRow: View {
    let icon: String
    var iconBackground: Color = DesignTokens.gold.opacity(0.15)
    var iconColor: Color = DesignTokens.gold
    let title: String
    var subtitle: String? = nil
    var value: String? = nil
    var isDestructive: Bool = false
    var showChevron: Bool = true
    var showDivider: Bool = true
    var action: (() -> Void)? = nil

    var body: some View {
        Button(action: { action?() }) {
            HStack(spacing: DesignTokens.spacing12) {
                ZStack {
                    RoundedRectangle(cornerRadius: DesignTokens.spacing8)
                        .fill(isDestructive ? DesignTokens.error.opacity(0.1) : iconBackground)
                        .frame(width: 32, height: 32)

                    Image(systemName: icon)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(isDestructive ? DesignTokens.error : iconColor)
                }

                VStack(alignment: .leading, spacing: DesignTokens.spacing2) {
                    Text(title)
                        .font(.body)
                        .foregroundStyle(isDestructive ? DesignTokens.error : DesignTokens.textPrimary)

                    if let subtitle = subtitle {
                        Text(subtitle)
                            .font(.caption)
                            .foregroundStyle(DesignTokens.textSecondary)
                    }
                }

                Spacer()

                if let value = value {
                    Text(value)
                        .font(.subheadline)
                        .foregroundStyle(DesignTokens.textSecondary)
                }

                if showChevron && !isDestructive {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(DesignTokens.textTertiary)
                }
            }
            .frame(height: 56)
            .padding(.horizontal, DesignTokens.spacing16)
            .contentShape(Rectangle())
        }
        .buttonStyle(SettingsRowButtonStyle())
        .overlay(alignment: .bottom) {
            if showDivider {
                Divider()
                    .padding(.leading, 60)
            }
        }
    }
}

struct SettingsRowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? DesignTokens.surface : Color.clear)
    }
}
