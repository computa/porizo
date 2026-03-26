import SwiftUI

struct VelvetCard<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .background(DesignTokens.surface)
            .clipShape(.rect(cornerRadius: DesignTokens.radiusMedium))
            .overlay(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium).stroke(DesignTokens.border, lineWidth: 0.5))
            .elevation(.level2)
    }
}
