import SwiftUI

struct VelvetHeader: View {
    let title: String?
    let showBackButton: Bool
    let onBack: (() -> Void)?
    let trailingContent: AnyView?

    init(
        title: String? = nil,
        showBackButton: Bool = true,
        onBack: (() -> Void)? = nil,
        @ViewBuilder trailing: () -> some View = { EmptyView() }
    ) {
        self.title = title
        self.showBackButton = showBackButton
        self.onBack = onBack
        self.trailingContent = AnyView(trailing())
    }

    var body: some View {
        HStack {
            if showBackButton {
                VelvetIconButton(icon: "arrow.left") {
                    onBack?()
                }
            }

            if let title = title {
                Spacer()
                Text(title)
                    .font(DesignTokens.bodyFont(size: 17, weight: .semibold))
                    .foregroundStyle(DesignTokens.textPrimary)
                Spacer()
            } else {
                Spacer()
            }

            if let trailing = trailingContent {
                trailing
            } else if showBackButton {
                Color.clear.frame(width: 44, height: 44)
            }
        }
        .padding(.horizontal, DesignTokens.spacing20)
        .padding(.vertical, DesignTokens.spacing8)
    }
}
