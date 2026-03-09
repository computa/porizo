//
//  InlineStoryCard.swift
//  PorizoApp
//
//  Collapsible story preview card that appears inline in the chat.
//  Shows the evolving narrative with completion percentage.
//

import SwiftUI

// MARK: - Inline Story Card

struct InlineStoryCard: View {
    let narrative: String
    let completionScore: Int
    let isExpanded: Bool
    let onToggle: () -> Void

    private let collapsedLineLimit: Int = 2

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Header with toggle
            Button(action: onToggle) {
                HStack(spacing: 8) {
                    Image(systemName: "sparkles.rectangle.stack")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(DesignTokens.gold)

                    Text("Your Story")
                        .font(.subheadline)
                        .fontWeight(.semibold)
                        .foregroundStyle(DesignTokens.textPrimary)

                    Spacer()

                    Text("\(completionScore)%")
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundStyle(DesignTokens.gold)

                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(DesignTokens.textSecondary)
                }
            }
            .buttonStyle(.plain)

            // Narrative content
            if !narrative.isEmpty {
                Text(narrative)
                    .font(.subheadline)
                    .foregroundStyle(DesignTokens.textSecondary)
                    .lineLimit(isExpanded ? nil : collapsedLineLimit)
                    .lineSpacing(4)
                    .textSelection(.enabled)
            } else {
                Text("Your story is being crafted...")
                    .font(.subheadline)
                    .foregroundStyle(DesignTokens.textTertiary)
                    .italic()
            }
        }
        .padding(14)
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(DesignTokens.gold.opacity(0.15), lineWidth: 1.5)
        )
        .padding(.horizontal, 16)
        .animation(.spring(response: 0.3), value: isExpanded)
    }
}

// MARK: - Story Card with Beats

/// A fuller story card showing narrative and beat progress bars
struct InlineStoryCardWithBeats: View {
    let narrative: String
    let beats: [V2Beat]
    let completionScore: Int
    @State private var isExpanded: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header with toggle
            Button {
                withAnimation(.spring(response: 0.3)) {
                    isExpanded.toggle()
                }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "sparkles.rectangle.stack")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(DesignTokens.gold)

                    Text("Your Story")
                        .font(.subheadline)
                        .fontWeight(.semibold)
                        .foregroundStyle(DesignTokens.textPrimary)

                    Spacer()

                    Text("\(completionScore)%")
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundStyle(DesignTokens.gold)

                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(DesignTokens.textSecondary)
                }
            }
            .buttonStyle(.plain)

            if isExpanded {
                // Narrative
                if !narrative.isEmpty {
                    Text(narrative)
                        .font(.subheadline)
                        .foregroundStyle(DesignTokens.textPrimary)
                        .lineSpacing(4)
                        .textSelection(.enabled)
                }

                Divider()
                    .background(DesignTokens.borderSubtle)

                // Beat progress bars
                VStack(alignment: .leading, spacing: 8) {
                    Text("Story Elements")
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundStyle(DesignTokens.textSecondary)

                    ForEach(beats) { beat in
                        beatProgressRow(beat: beat)
                    }
                }
            } else {
                // Collapsed: show brief preview
                if !narrative.isEmpty {
                    Text(narrative)
                        .font(.subheadline)
                        .foregroundStyle(DesignTokens.textSecondary)
                        .lineLimit(2)
                        .lineSpacing(4)
                        .textSelection(.enabled)
                }
            }
        }
        .padding(14)
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(DesignTokens.gold.opacity(0.15), lineWidth: 1.5)
        )
        .padding(.horizontal, 16)
    }

    private func beatProgressRow(beat: V2Beat) -> some View {
        HStack(spacing: 12) {
            Circle()
                .fill(beat.isFilled ? DesignTokens.success : DesignTokens.gold)
                .frame(width: 6, height: 6)

            Text(beat.displayName)
                .font(.caption)
                .foregroundStyle(DesignTokens.textPrimary)
                .frame(width: 80, alignment: .leading)

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    // Track
                    RoundedRectangle(cornerRadius: 3)
                        .fill(DesignTokens.surface)
                        .frame(height: 6)

                    // Fill
                    RoundedRectangle(cornerRadius: 3)
                        .fill(beat.isFilled ? DesignTokens.success : DesignTokens.gold)
                        .frame(width: geo.size.width * beat.strength, height: 6)
                }
            }
            .frame(height: 6)
        }
    }
}

// MARK: - Preview

#Preview {
    VStack(spacing: 16) {
        InlineStoryCard(
            narrative: "You're creating a birthday song for Sarah, celebrating the road trip you took last summer when you got lost in the mountains together.",
            completionScore: 45,
            isExpanded: false,
            onToggle: {}
        )

        InlineStoryCardWithBeats(
            narrative: "You're creating a birthday song for Sarah.",
            beats: V2Beat.defaultBeats(turnCount: 3, completionScore: 60),
            completionScore: 60
        )
    }
    .padding()
    .background(DesignTokens.surface)
}
