import SwiftUI

struct CompactChipScroll<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: CompactSpacing.chipSpacing) {
                content
            }
            .padding(.horizontal, 16)
        }
        .scrollIndicators(.hidden)
    }
}
