//
//  ChatHeaderView.swift
//  PorizoApp
//
//  Chat header bar — "For {name}" with occasion/genre chips and close button.
//  Warm Canvas design: display font title, chip badges, no completion score.
//

import SwiftUI

struct ChatHeaderView: View, Equatable {
    let recipientName: String
    let selectedType: CreateFlowKind?
    let storyId: String?
    let completionScore: Int
    let occasion: Occasion?
    let isComplete: Bool
    var styleName: String?
    let onCancel: () -> Void

    static func == (lhs: ChatHeaderView, rhs: ChatHeaderView) -> Bool {
        lhs.recipientName == rhs.recipientName &&
        lhs.selectedType == rhs.selectedType &&
        lhs.storyId == rhs.storyId &&
        lhs.completionScore == rhs.completionScore &&
        lhs.occasion == rhs.occasion &&
        lhs.isComplete == rhs.isComplete &&
        lhs.styleName == rhs.styleName
    }

    var body: some View {
        HStack {
            Text("For \(recipientName)")
                .font(DesignTokens.displayFont(size: 20))
                .foregroundStyle(DesignTokens.textPrimary)
                .accessibilityIdentifier("create-flow-recipient-display")

            Spacer()

            // Occasion + genre chips
            HStack(spacing: 6) {
                if let occasion {
                    chipBadge(occasion.displayName, style: .coral)
                }
                if let styleName {
                    chipBadge(styleName, style: .sage)
                }
            }

            Button { onCancel() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .frame(width: 30, height: 30)
                    .background(Color.black.opacity(0.05))
                    .clipShape(Circle())
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 16)
        .padding(.bottom, 8)
    }

    // MARK: - Chip Badge

    private enum ChipStyle { case coral, sage }

    private func chipBadge(_ text: String, style: ChipStyle) -> some View {
        Text(text)
            .font(DesignTokens.bodyFont(size: 12, weight: .medium))
            .foregroundStyle(style == .coral ? DesignTokens.gold : DesignTokens.sage)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(style == .coral ? DesignTokens.gold.opacity(0.1) : DesignTokens.sage.opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(style == .coral ? DesignTokens.gold.opacity(0.2) : DesignTokens.sage.opacity(0.2), lineWidth: 1)
            )
    }
}
