import SwiftUI

struct CompactSettingsRow<Accessory: View>: View {
    let icon: String
    let label: String
    var iconColor: Color = DesignTokens.textSecondary
    let accessory: Accessory
    var onTap: (() -> Void)?

    init(
        icon: String,
        label: String,
        iconColor: Color = DesignTokens.textSecondary,
        @ViewBuilder accessory: () -> Accessory = { EmptyView() },
        onTap: (() -> Void)? = nil
    ) {
        self.icon = icon
        self.label = label
        self.iconColor = iconColor
        self.accessory = accessory()
        self.onTap = onTap
    }

    var body: some View {
        Button {
            onTap?()
        } label: {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 18))
                    .foregroundStyle(iconColor)
                    .frame(width: 24)

                Text(label)
                    .font(DesignTokens.bodyFont(size: 15))
                    .foregroundStyle(DesignTokens.textPrimary)

                Spacer()

                accessory
            }
            .frame(height: CompactSpacing.settingsRowHeight)
            .padding(.horizontal, 16)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
