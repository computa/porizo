import SwiftUI

struct CompactSectionHeader: View {
    let title: String
    var action: (() -> Void)?
    var actionLabel: String?

    var body: some View {
        HStack {
            Text(title.uppercased())
                .font(DesignTokens.bodyFont(size: 11, weight: .semibold))
                .foregroundStyle(DesignTokens.textTertiary)
                .tracking(0.5)

            Spacer()

            if let action = action, let label = actionLabel {
                Button(action: action) {
                    Text(label)
                        .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                        .foregroundStyle(DesignTokens.gold)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }
}
