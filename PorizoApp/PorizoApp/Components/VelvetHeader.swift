import SwiftUI

struct VelvetHeader<Trailing: View>: View {
    let title: String?
    let showBackButton: Bool
    let onBack: (() -> Void)?
    @ViewBuilder let trailingContent: Trailing

    init(
        title: String? = nil,
        showBackButton: Bool = true,
        onBack: (() -> Void)? = nil,
        @ViewBuilder trailing: () -> Trailing
    ) {
        self.title = title
        self.showBackButton = showBackButton
        self.onBack = onBack
        self.trailingContent = trailing()
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

            if Trailing.self == EmptyView.self {
                if showBackButton {
                    Color.clear.frame(width: 44, height: 44)
                }
            } else {
                trailingContent
            }
        }
        .padding(.horizontal, DesignTokens.spacing20)
        .padding(.vertical, DesignTokens.spacing8)
    }
}

extension VelvetHeader where Trailing == EmptyView {
    init(
        title: String? = nil,
        showBackButton: Bool = true,
        onBack: (() -> Void)? = nil
    ) {
        self.init(
            title: title,
            showBackButton: showBackButton,
            onBack: onBack
        ) {
            EmptyView()
        }
    }
}
