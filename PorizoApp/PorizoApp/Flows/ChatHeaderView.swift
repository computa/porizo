//
//  ChatHeaderView.swift
//  PorizoApp
//
//  Extracted from UnifiedCreateFlowView — chat header bar with
//  recipient name, completion badge, and cancel button.
//  Conforms to Equatable so SwiftUI can skip re-renders when
//  the 6 value-type params haven't changed.
//

import SwiftUI

struct ChatHeaderView: View, Equatable {
    let recipientName: String
    let selectedType: CreateFlowKind?
    let storyId: String?
    let completionScore: Int
    let occasion: Occasion?
    let isComplete: Bool
    let onCancel: () -> Void

    static func == (lhs: ChatHeaderView, rhs: ChatHeaderView) -> Bool {
        lhs.recipientName == rhs.recipientName &&
        lhs.selectedType == rhs.selectedType &&
        lhs.storyId == rhs.storyId &&
        lhs.completionScore == rhs.completionScore &&
        lhs.occasion == rhs.occasion &&
        lhs.isComplete == rhs.isComplete
    }

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 1) {
                Text(headerTitle)
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    .foregroundStyle(DesignTokens.textPrimary)
                if storyId != nil {
                    Text("\((occasion ?? .custom).displayName)  ·  \(isComplete ? "Ready" : "\(completionScore)%")")
                        .font(DesignTokens.bodyFont(size: 12))
                        .foregroundStyle(DesignTokens.gold)
                }
            }

            Spacer()

            // Completion badge (only when session active)
            if storyId != nil {
                HStack(spacing: 4) {
                    Image(systemName: "sparkle")
                        .font(.system(size: 9))
                    Text("\(completionScore)%")
                        .font(DesignTokens.bodyFont(size: 12, weight: .semibold))
                }
                .foregroundStyle(DesignTokens.gold)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(DesignTokens.gold.opacity(0.12))
                .clipShape(Capsule())
            }

            Button { onCancel() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .frame(width: 30, height: 30)
                    .background(DesignTokens.surface)
                    .clipShape(Circle())
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    // MARK: - Private

    private var headerTitle: String {
        switch selectedType {
        case .song: return "Song for \(recipientName)"
        case .poem: return "Poem for \(recipientName)"
        case nil: return "Create for \(recipientName)"
        }
    }
}
