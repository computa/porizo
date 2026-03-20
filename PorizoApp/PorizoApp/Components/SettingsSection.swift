import SwiftUI

struct SettingsSection<Content: View>: View {
    let header: String?
    @ViewBuilder let content: () -> Content

    init(header: String? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.header = header
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing8) {
            if let header = header {
                Text(header.uppercased())
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(DesignTokens.textTertiary)
                    .padding(.horizontal, DesignTokens.spacing4)
            }

            VStack(spacing: 0) {
                content()
            }
            .background(DesignTokens.surface)
            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusLarge))
            .elevation(.level1)
        }
    }
}
