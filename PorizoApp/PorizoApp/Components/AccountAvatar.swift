import SwiftUI

struct AccountAvatar: View {
    let initials: String
    var size: CGFloat = 44

    var body: some View {
        ZStack {
            Circle()
                .fill(DesignTokens.gold.opacity(0.15))
                .frame(width: size, height: size)

            Text(initials)
                .font(.system(size: size * 0.4, weight: .semibold))
                .foregroundStyle(DesignTokens.gold)
        }
    }
}
