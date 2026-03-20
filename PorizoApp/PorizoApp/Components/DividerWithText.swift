import SwiftUI

struct DividerWithText: View {
    let text: String

    init(_ text: String = "or") {
        self.text = text
    }

    var body: some View {
        HStack(spacing: DesignTokens.spacing16) {
            Rectangle()
                .fill(DesignTokens.borderSubtle)
                .frame(height: 1)

            Text(text)
                .font(DesignTokens.bodyFont(size: 14))
                .foregroundStyle(DesignTokens.textTertiary)

            Rectangle()
                .fill(DesignTokens.borderSubtle)
                .frame(height: 1)
        }
    }
}
