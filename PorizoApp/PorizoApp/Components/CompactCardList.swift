import SwiftUI

struct CompactCardList<Data: RandomAccessCollection, Content: View>: View where Data.Element: Identifiable {
    let data: Data
    let content: (Data.Element) -> Content

    init(_ data: Data, @ViewBuilder content: @escaping (Data.Element) -> Content) {
        self.data = data
        self.content = content
    }

    var body: some View {
        LazyVStack(spacing: DesignTokens.spacing12) {
            ForEach(data) { item in
                content(item)
            }
        }
        .padding(.horizontal, DesignTokens.spacing16)
    }
}
