import SwiftUI

struct GoldLinkButton: View {
    let text: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(text)
                .font(DesignTokens.bodyFont(size: 14, weight: .semibold))
                .foregroundStyle(DesignTokens.gold)
        }
    }
}
