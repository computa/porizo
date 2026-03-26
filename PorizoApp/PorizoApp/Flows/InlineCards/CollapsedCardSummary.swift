//
//  CollapsedCardSummary.swift
//  PorizoApp
//
//  One-line summary of a completed creation phase. Tap to expand back to full card.
//

import SwiftUI

struct CollapsedCardSummary: View {
    let icon: String
    let label: String
    let detail: String
    var isExpanded: Bool = false
    let onToggle: () -> Void

    var body: some View {
        Button(action: onToggle) {
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 13))
                    .foregroundStyle(DesignTokens.gold.opacity(0.7))
                    .frame(width: 20)

                Text(label)
                    .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                    .foregroundStyle(DesignTokens.textPrimary)

                Text(detail)
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .lineLimit(1)

                Spacer()

                Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(DesignTokens.textTertiary)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(DesignTokens.surface.opacity(0.6))
            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
            .overlay(
                RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                    .stroke(DesignTokens.border, lineWidth: 0.5)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(label): \(detail)")
        .accessibilityHint(isExpanded ? "Tap to collapse" : "Tap to expand")
    }
}
