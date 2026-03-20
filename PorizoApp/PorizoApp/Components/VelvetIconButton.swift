import SwiftUI

struct VelvetIconButton: View {
    let icon: String
    let action: () -> Void
    var size: CGFloat = 44
    var style: VelvetIconButtonStyle = .filled
    var accessibilityLabel: String? = nil

    enum VelvetIconButtonStyle {
        case filled
        case ghost
    }

    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 20, weight: .medium))
                .foregroundStyle(DesignTokens.textPrimary)
                .frame(width: size, height: size)
                .background(style == .filled ? DesignTokens.surface : .clear)
                .clipShape(Circle())
        }
        .accessibilityLabel(accessibilityLabel ?? icon)
    }
}
