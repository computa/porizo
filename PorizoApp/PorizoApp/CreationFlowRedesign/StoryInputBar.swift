//
//  StoryInputBar.swift
//  PorizoApp
//
//  Shared input bar for creation flow redesign options.
//  Matches the production InputBarView design: two separate areas.
//
//  Area 1: Text field in its own rounded surface container
//  Area 2: Separate row below with char count, mic button (gold, rounded square bg), send button
//

import SwiftUI

#if DEBUG

struct StoryInputBarView: View {
    @Binding var text: String
    var maxChars: Int = 6_000

    var body: some View {
        VStack(spacing: 8) {
            // Area 1: Text field container
            TextField("Share your thoughts...", text: $text, axis: .vertical)
                .font(DesignTokens.bodyFont(size: 15))
                .foregroundStyle(DesignTokens.textPrimary)
                .lineLimit(1...6)
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .background(DesignTokens.surface)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .overlay(
                    RoundedRectangle(cornerRadius: 14)
                        .stroke(DesignTokens.border, lineWidth: 0.5)
                )

            // Gold accent line between areas
            Rectangle()
                .fill(DesignTokens.gold.opacity(0.2))
                .frame(height: 0.5)
                .padding(.horizontal, 4)

            // Area 2: Char count + mic + send (separate row)
            HStack(spacing: 12) {
                Text("\(text.count)/\(formatNumber(maxChars))")
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundStyle(DesignTokens.textTertiary)

                Spacer()

                // Mic button with rounded square background
                Button {} label: {
                    Image(systemName: "mic.fill")
                        .font(.system(size: 16))
                        .foregroundStyle(DesignTokens.gold)
                        .frame(width: 36, height: 36)
                        .background(DesignTokens.surface)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .overlay(
                            RoundedRectangle(cornerRadius: 10)
                                .stroke(DesignTokens.border, lineWidth: 0.5)
                        )
                }

                // Send button
                Button {} label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 32))
                        .foregroundStyle(text.isEmpty ? DesignTokens.textTertiary : DesignTokens.gold)
                }
                .disabled(text.isEmpty)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(DesignTokens.background)
    }

    private func formatNumber(_ n: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        return formatter.string(from: NSNumber(value: n)) ?? "\(n)"
    }
}

/// Convenience function for use inside views
func storyInputBar(text: Binding<String>) -> some View {
    StoryInputBarView(text: text)
}

#endif
