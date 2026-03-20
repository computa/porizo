import SwiftUI

struct VelvetTextField: View {
    let label: String
    let fieldPrompt: String
    @Binding var text: String
    var keyboardType: UIKeyboardType = .default
    var isSecure: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing8) {
            if !label.isEmpty {
                Text(label)
                    .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                    .foregroundStyle(DesignTokens.textSecondary)
            }

            Group {
                if isSecure {
                    SecureField(fieldPrompt, text: $text)
                } else {
                    TextField(fieldPrompt, text: $text)
                        .keyboardType(keyboardType)
                }
            }
            .font(DesignTokens.bodyFont(size: 16))
            .foregroundStyle(DesignTokens.textPrimary)
            .padding(.horizontal, DesignTokens.spacing16)
            .padding(.vertical, DesignTokens.spacing12)
            .background(DesignTokens.inputBackground)
            .clipShape(.rect(cornerRadius: DesignTokens.radiusMedium))
            .overlay(
                RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                    .stroke(DesignTokens.borderSubtle, lineWidth: 1)
            )
        }
    }
}
