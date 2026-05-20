//
//  ReviewPrePromptSheet.swift
//  PorizoApp
//
//  In-app survey shown before the native SKStoreReviewController prompt.
//  Filters out unhappy users so the App Store rating reflects users who
//  experienced value — the pre-prompt itself never reaches Apple.
//

import SwiftUI

struct ReviewPrePromptSheet: View {
    let onYes: () -> Void
    let onNotReally: () -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            // Icon
            ZStack {
                Circle()
                    .fill(DesignTokens.gold.opacity(0.12))
                    .frame(width: 96, height: 96)
                Image(systemName: "music.note")
                    .font(.system(size: 40))
                    .foregroundStyle(DesignTokens.gold)
            }

            VStack(spacing: DesignTokens.spacing12) {
                Text("Enjoying Porizo?")
                    .font(DesignTokens.displayFont(size: 26))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .multilineTextAlignment(.center)

                Text("If you've sent a song someone loved, we'd love to hear it.")
                    .font(DesignTokens.bodyFont(size: 15))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 32)
            .padding(.top, 24)

            Spacer()

            VStack(spacing: DesignTokens.spacing12) {
                Button {
                    onYes()
                    dismiss()
                } label: {
                    Text("Yes, love it!")
                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(DesignTokens.gold)
                        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
                }
                .accessibilityHint("Opens the App Store rating prompt")

                Button {
                    onNotReally()
                    dismiss()
                } label: {
                    Text("Not really")
                        .font(DesignTokens.bodyFont(size: 15, weight: .medium))
                        .foregroundStyle(DesignTokens.textSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                }
                .accessibilityHint("We won't ask again for a while")
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 40)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DesignTokens.background)
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
    }
}

#if DEBUG
#Preview {
    ReviewPrePromptSheet(
        onYes: { print("yes") },
        onNotReally: { print("not really") }
    )
}
#endif
