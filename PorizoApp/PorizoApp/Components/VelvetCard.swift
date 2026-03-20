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
            .elevation(.level2)
    }
}
