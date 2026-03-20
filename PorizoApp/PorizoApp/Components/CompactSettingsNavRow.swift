import SwiftUI

struct CompactSettingsNavRow: View {
    let icon: String
    let label: String
    var iconColor: Color = DesignTokens.textSecondary
    let onTap: () -> Void

    var body: some View {
        CompactSettingsRow(
            icon: icon,
            label: label,
            iconColor: iconColor,
            accessory: {
                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(DesignTokens.textTertiary)
            },
            onTap: onTap
        )
    }
}
