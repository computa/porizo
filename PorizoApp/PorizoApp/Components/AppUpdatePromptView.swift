import SwiftUI

struct AppUpdatePromptView: View {
    let prompt: AppUpdatePrompt
    let onUpdate: () -> Void
    let onLater: (() -> Void)?

    var body: some View {
        ZStack {
            Color.black.opacity(0.5)
                .ignoresSafeArea()

            VStack(spacing: 20) {
                Image(systemName: "arrow.down.app.fill")
                    .font(.system(size: 40, weight: .semibold))
                    .foregroundStyle(DesignTokens.gold)

                VStack(spacing: 8) {
                    Text(prompt.title)
                        .font(.title2)
                        .fontWeight(.semibold)
                        .foregroundStyle(.white)

                    Text(prompt.message)
                        .font(.body)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(Color.white.opacity(0.78))
                }

                VStack(spacing: 12) {
                    Button(action: onUpdate) {
                        Text("Update")
                            .foregroundStyle(.black)
                            .padding(.vertical, 16)
                            .frame(maxWidth: .infinity)
                    }
                    .background(DesignTokens.gold)
                    .clipShape(Capsule())

                    if let onLater {
                        Button("Later", action: onLater)
                            .foregroundStyle(Color.white.opacity(0.75))
                    }
                }
            }
            .padding(28)
            .frame(maxWidth: 420)
            .background(
                RoundedRectangle(cornerRadius: 24)
                    .fill(DesignTokens.surface)
                    .overlay(
                        RoundedRectangle(cornerRadius: 24)
                            .stroke(DesignTokens.gold.opacity(0.25), lineWidth: 1)
                    )
            )
            .padding(24)
        }
    }
}
