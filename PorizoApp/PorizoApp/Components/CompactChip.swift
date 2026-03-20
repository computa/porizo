import SwiftUI

struct CompactChip: View {
    let label: String
    var emoji: String?
    var icon: String?
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: CompactSpacing.inlineSpacing) {
                if let emoji = emoji {
                    Text(emoji)
                        .font(.system(size: 14))
                }

                if let icon = icon {
                    Image(systemName: icon)
                        .font(.system(size: 14))
                }

                Text(label)
                    .font(DesignTokens.bodyFont(size: 14, weight: .medium))
            }
            .foregroundStyle(isSelected ? .black : DesignTokens.textPrimary)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(isSelected ? DesignTokens.gold : DesignTokens.surface)
            .clipShape(.rect(cornerRadius: CompactSpacing.chipCornerRadius))
            .overlay(
                RoundedRectangle(cornerRadius: CompactSpacing.chipCornerRadius)
                    .stroke(isSelected ? Color.clear : DesignTokens.borderSubtle, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }
}
