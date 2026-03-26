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
            HStack(spacing: DesignTokens.spacing12) {
                artwork
                    .frame(width: DesignTokens.artworkSize, height: DesignTokens.artworkSize)
                    .clipShape(.rect(cornerRadius: DesignTokens.radiusXSmall))

                content

                accessory
            }
            .padding(DesignTokens.spacing12)
            .background(DesignTokens.surface)
            .clipShape(.rect(cornerRadius: DesignTokens.radiusMedium))
            .overlay(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium).stroke(DesignTokens.border, lineWidth: 0.5))
        }
        .buttonStyle(.plain)
    }
}
