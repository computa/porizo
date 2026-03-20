import SwiftUI

struct SettingsLinkRow: View {
    let icon: String
    var iconBackground: Color = DesignTokens.gold.opacity(0.15)
    var iconColor: Color = DesignTokens.gold
    let title: String
    let url: URL
    var showDivider: Bool = true

    var body: some View {
        Link(destination: url) {
            HStack(spacing: DesignTokens.spacing12) {
                ZStack {
                    RoundedRectangle(cornerRadius: DesignTokens.spacing8)
                        .fill(iconBackground)
                        .frame(width: 32, height: 32)

                    Image(systemName: icon)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(iconColor)
                }

                Text(title)
                    .font(.body)
                    .foregroundStyle(DesignTokens.textPrimary)

                Spacer()

                Image(systemName: "arrow.up.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(DesignTokens.textTertiary)
            }
            .frame(height: 56)
            .padding(.horizontal, DesignTokens.spacing16)
            .contentShape(Rectangle())
        }
        .overlay(alignment: .bottom) {
            if showDivider {
                Divider()
                    .padding(.leading, 60)
            }
        }
    }
}
