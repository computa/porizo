import SwiftUI

struct CompactChipScroll<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: DesignTokens.spacing8) {
                content
            }
            .padding(.horizontal, DesignTokens.spacing16)
        }
        .scrollIndicators(.hidden)
    }
}
