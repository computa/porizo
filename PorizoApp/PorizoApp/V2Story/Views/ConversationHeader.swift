//
//  ConversationHeader.swift
//  PorizoApp
//
//  Header component for the Adaptive Conversation UI.
//  Shows recipient name, completion percentage, and progress dots.
//

import SwiftUI

// MARK: - Conversation Header

struct ConversationHeader: View {
    let recipientName: String
    let completionScore: Int
    let beats: [V2Beat]
    let turnCount: Int

    var body: some View {
        VStack(spacing: 12) {
            // Title row
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Story for \(recipientName)")
                        .font(.headline)
                        .foregroundColor(DesignTokens.textPrimary)

                    Text("\(completionScore)% complete")
                        .font(.caption)
                        .foregroundColor(DesignTokens.textSecondary)
                }

                Spacer()

                // Completion badge
                Text("\(completionScore)%")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundColor(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(
                        Capsule()
                            .fill(completionColor)
                    )
            }

            // Progress dots based on beats
            progressDots
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(DesignTokens.surface)
        .overlay(
            Rectangle()
                .fill(DesignTokens.borderSubtle)
                .frame(height: 1),
            alignment: .bottom
        )
    }

    // MARK: - Progress Dots

    private var progressDots: some View {
        HStack(spacing: 6) {
            ForEach(Array(beats.enumerated()), id: \.element.id) { index, beat in
                Circle()
                    .fill(beat.isFilled ? DesignTokens.success : (index < turnCount ? DesignTokens.gold : DesignTokens.borderSubtle))
                    .frame(width: 8, height: 8)
            }

            // Add extra dots if beats are fewer than typical journey length
            if beats.count < 5 {
                ForEach(beats.count..<5, id: \.self) { index in
                    Circle()
                        .fill(index < turnCount ? DesignTokens.gold : DesignTokens.borderSubtle)
                        .frame(width: 8, height: 8)
                }
            }
        }
    }

    // MARK: - Helpers

    private var completionColor: Color {
        if completionScore >= 80 {
            return DesignTokens.success
        } else if completionScore >= 50 {
            return DesignTokens.gold
        } else {
            return DesignTokens.textSecondary
        }
    }
}

// MARK: - Minimal Header

/// A minimal header variant showing just the title and percentage
struct ConversationHeaderMinimal: View {
    let recipientName: String
    let completionScore: Int

    var body: some View {
        HStack {
            Text("Story for \(recipientName)")
                .font(.subheadline)
                .fontWeight(.medium)
                .foregroundColor(DesignTokens.textPrimary)

            Spacer()

            HStack(spacing: 4) {
                Image(systemName: "sparkles")
                    .font(.system(size: 12))
                Text("\(completionScore)%")
                    .font(.subheadline)
                    .fontWeight(.semibold)
            }
            .foregroundColor(DesignTokens.gold)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(DesignTokens.surface.opacity(0.95))
    }
}

// MARK: - Preview

#Preview {
    VStack(spacing: 0) {
        ConversationHeader(
            recipientName: "Sarah",
            completionScore: 65,
            beats: V2Beat.defaultBeats(turnCount: 3, completionScore: 65),
            turnCount: 3
        )

        Spacer()
    }
    .background(DesignTokens.surface)
}
