import SwiftUI

struct PromptBubble: View {
    let text: String

    var body: some View {
        HStack(spacing: 0) {
            RoundedRectangle(cornerRadius: 2)
                .fill(DesignTokens.gold)
                .frame(width: 3)

            Text(text)
                .font(DesignTokens.bodyFont(size: 15))
                .foregroundStyle(DesignTokens.textPrimary)
                .lineSpacing(3)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
        }
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
        .overlay(
            RoundedRectangle(cornerRadius: DesignTokens.radiusCTA)
                .stroke(DesignTokens.border.opacity(0.5), lineWidth: 0.5)
        )
    }
}
