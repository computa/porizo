import SwiftUI

struct CompactSettingsToggleRow: View {
    let icon: String
    let label: String
    var iconColor: Color = DesignTokens.textSecondary
    @Binding var isOn: Bool

    var body: some View {
        CompactSettingsRow(
            icon: icon,
            label: label,
            iconColor: iconColor,
            accessory: {
                Toggle("", isOn: $isOn)
                    .labelsHidden()
                    .tint(DesignTokens.gold)
            }
        )
    }
}
