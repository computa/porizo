//
//  InlineCreatingCard.swift
//  PorizoApp
//
//  Inline progress card for the creating/generating phase.
//  Shows a circular progress ring with a wand icon and status text.
//

import SwiftUI

struct InlineCreatingCard: View {
    let progress: Int          // 0-100
    let statusMessage: String

    private var normalizedProgress: Double {
        Double(min(max(progress, 0), 100)) / 100.0
    }

    var body: some View {
        VStack(spacing: 16) {
            // Progress ring
            ZStack {
                // Track
                Circle()
                    .stroke(DesignTokens.gold.opacity(0.15), lineWidth: 4)

                // Fill
                Circle()
                    .trim(from: 0, to: normalizedProgress)
                    .stroke(DesignTokens.gold, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(.easeInOut(duration: 0.3), value: progress)

                // Center icon
                Image(systemName: "wand.and.stars")
                    .font(.system(size: 36))
                    .foregroundStyle(DesignTokens.gold)
            }
            .frame(width: 120, height: 120)

            // Status message
            Text(statusMessage)
                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                .foregroundStyle(DesignTokens.textPrimary)
                .multilineTextAlignment(.center)
        }
        .padding(16)
        .frame(maxWidth: .infinity)
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
        .overlay(
            RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                .stroke(DesignTokens.gold.opacity(0.15), lineWidth: 0.5)
        )
    }
}

#Preview {
    ZStack {
        DesignTokens.background.ignoresSafeArea()

        VStack(spacing: 16) {
            InlineCreatingCard(
                progress: 42,
                statusMessage: "Writing Sarah's birthday lyrics..."
            )

            InlineCreatingCard(
                progress: 78,
                statusMessage: "Composing acoustic arrangement..."
            )
        }
        .padding(.horizontal, 16)
    }
}
