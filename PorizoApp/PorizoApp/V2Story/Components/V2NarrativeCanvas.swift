//
//  NarrativeCanvas.swift
//  PorizoApp
//
//  Displays the evolving narrative with new content highlighted.
//

import SwiftUI

struct V2NarrativeCanvas: View {
    let narrative: String
    let previousNarrative: String?
    let showHighlight: Bool

    @State private var highlightOpacity: Double = 1.0

    init(
        narrative: String,
        previousNarrative: String? = nil,
        showHighlight: Bool = true
    ) {
        self.narrative = narrative
        self.previousNarrative = previousNarrative
        self.showHighlight = showHighlight
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Title
            HStack {
                Image(systemName: "sparkles.rectangle.stack")
                    .foregroundColor(DesignTokens.rose)

                Text("Your Story")
                    .font(.headline)
                    .foregroundColor(DesignTokens.textPrimary)
            }

            // Narrative content
            if showHighlight, let previous = previousNarrative, !previous.isEmpty {
                highlightedNarrative(previous: previous)
            } else {
                Text(narrative)
                    .font(.body)
                    .foregroundColor(DesignTokens.textPrimary)
                    .lineSpacing(6)
            }
        }
        .padding(16)
        .background(DesignTokens.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .elevation(.level2)
    }

    // MARK: - Highlighted Narrative

    @ViewBuilder
    private func highlightedNarrative(previous: String) -> some View {
        let newContent = findNewContent(previous: previous, current: narrative)

        VStack(alignment: .leading, spacing: 0) {
            // Previous content (normal)
            if !previous.isEmpty {
                Text(previous)
                    .font(.body)
                    .foregroundColor(DesignTokens.textPrimary)
            }

            // New content (highlighted)
            if !newContent.isEmpty {
                Text(newContent)
                    .font(.body)
                    .foregroundColor(DesignTokens.textPrimary)
                    .background(
                        DesignTokens.rose.opacity(0.15 * highlightOpacity)
                    )
                    .onAppear {
                        // Fade out highlight after 2 seconds
                        withAnimation(.easeOut(duration: 2.0).delay(1.0)) {
                            highlightOpacity = 0
                        }
                    }
            }
        }
        .lineSpacing(6)
    }

    // MARK: - Helpers

    private func findNewContent(previous: String, current: String) -> String {
        if current.hasPrefix(previous) {
            return String(current.dropFirst(previous.count))
        }
        // If narrative was restructured, just return the whole thing
        return current
    }
}

// MARK: - Narrative Canvas with Beats

struct V2NarrativeCanvasWithBeats: View {
    let narrative: String
    let previousNarrative: String?
    let beats: [V2Beat]
    let completionScore: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Header with completion
            HStack {
                Image(systemName: "sparkles.rectangle.stack")
                    .foregroundColor(DesignTokens.rose)

                Text("Your Story")
                    .font(.headline)
                    .foregroundColor(DesignTokens.textPrimary)

                Spacer()

                Text("\(completionScore)%")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundColor(DesignTokens.rose)
            }

            // Narrative
            Text(narrative)
                .font(.body)
                .foregroundColor(DesignTokens.textPrimary)
                .lineSpacing(6)

            Divider()

            // Beat progress
            VStack(alignment: .leading, spacing: 8) {
                Text("Story Elements")
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundColor(DesignTokens.textSecondary)

                V2BeatProgressSummary(beats: beats, style: .dots())
            }
        }
        .padding(16)
        .background(DesignTokens.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .elevation(.level2)
    }
}

// MARK: - Minimal Narrative Display

struct V2MinimalNarrativeView: View {
    let narrative: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "quote.opening")
                    .font(.caption)
                    .foregroundColor(DesignTokens.rose)

                Text("Story so far")
                    .font(.caption)
                    .foregroundColor(DesignTokens.textTertiary)
            }

            Text(narrative)
                .font(.subheadline)
                .foregroundColor(DesignTokens.textSecondary)
                .italic()
                .lineLimit(3)
        }
        .padding(12)
        .background(DesignTokens.roseMuted)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}
