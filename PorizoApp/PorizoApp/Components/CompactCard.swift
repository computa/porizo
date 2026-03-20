import SwiftUI

struct CompactCard<Artwork: View, Content: View, Accessory: View>: View {
    let artwork: Artwork
    let content: Content
    let accessory: Accessory
    var onTap: (() -> Void)?

    init(
        @ViewBuilder artwork: () -> Artwork,
        @ViewBuilder content: () -> Content,
        @ViewBuilder accessory: () -> Accessory = { EmptyView() },
        onTap: (() -> Void)? = nil
    ) {
        self.artwork = artwork()
        self.content = content()
        self.accessory = accessory()
        self.onTap = onTap
    }

    var body: some View {
        Button {
            onTap?()
        } label: {
            HStack(spacing: CompactSpacing.listSpacing) {
                artwork
                    .frame(width: CompactSpacing.artworkSize, height: CompactSpacing.artworkSize)
                    .clipShape(.rect(cornerRadius: CompactSpacing.artworkCornerRadius))

                content

                accessory
            }
            .padding(CompactSpacing.cardPadding)
            .background(DesignTokens.surface)
            .clipShape(.rect(cornerRadius: CompactSpacing.cardCornerRadius))
        }
        .buttonStyle(.plain)
    }
}
