//
//  InlineLyricsCard.swift
//  PorizoApp
//
//  Inline lyrics display card for the All-in-Chat creation flow.
//  Shows generated lyrics with section headers, optional interactive
//  quick-reply chips, and error/loading states.
//

import SwiftUI

struct InlineLyricsCard: View {
    let lyrics: Lyrics
    var controller: LyricsReviewController?
    let isInteractive: Bool
    let style: String
    let highlightTerms: [String]
    let onApproved: () -> Void
    let onRegenerateLyrics: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header

            if lyrics.sections.isEmpty && controller?.isLoading == false {
                errorState
            } else {
                lyricsBody
            }

            if isInteractive {
                quickReplyChips
            } else if controller != nil {
                Text("Finishing setup...")
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundStyle(DesignTokens.textTertiary)
            }
        }
        .padding(16)
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
        .overlay(
            RoundedRectangle(cornerRadius: DesignTokens.radiusCTA)
                .stroke(DesignTokens.gold.opacity(0.2), lineWidth: 0.5)
        )
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Image(systemName: "music.note.list")
                .font(.system(size: 14))
                .foregroundStyle(DesignTokens.gold)
            Text("Generated Lyrics")
                .font(DesignTokens.bodyFont(size: 14, weight: .semibold))
                .foregroundStyle(DesignTokens.gold)
            Spacer()
            Text(style)
                .font(DesignTokens.bodyFont(size: 11))
                .foregroundStyle(DesignTokens.textTertiary)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(DesignTokens.border.opacity(0.5))
                .clipShape(Capsule())
        }
    }

    // MARK: - Lyrics Body

    private var lyricsBody: some View {
        ForEach(Array(lyrics.sections.enumerated()), id: \.offset) { _, section in
            VStack(alignment: .leading, spacing: 4) {
                Text(formatSectionName(section.name).uppercased())
                    .font(DesignTokens.bodyFont(size: 10, weight: .bold))
                    .foregroundStyle(DesignTokens.textTertiary)
                    .tracking(1)

                ForEach(Array(section.lines.enumerated()), id: \.offset) { _, line in
                    if highlightTerms.isEmpty {
                        Text(line.text)
                            .font(DesignTokens.bodyFont(size: 14))
                            .foregroundStyle(DesignTokens.textPrimary)
                            .lineSpacing(2)
                    } else if let ctrl = controller {
                        Text(ctrl.highlightedLine(line.text, baseColor: DesignTokens.textPrimary))
                            .font(DesignTokens.bodyFont(size: 14))
                            .lineSpacing(2)
                    } else {
                        Text(line.text)
                            .font(DesignTokens.bodyFont(size: 14))
                            .foregroundStyle(DesignTokens.textPrimary)
                            .lineSpacing(2)
                    }
                }
            }
        }
    }

    // MARK: - Error State

    private var errorState: some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 24))
                .foregroundStyle(DesignTokens.warning)
            Text("Could not load lyrics")
                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                .foregroundStyle(DesignTokens.textPrimary)
            Button {
                onRegenerateLyrics()
            } label: {
                Text("Retry")
                    .font(DesignTokens.bodyFont(size: 13, weight: .semibold))
                    .foregroundStyle(.black)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 8)
                    .background(DesignTokens.gold)
                    .clipShape(Capsule())
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
    }

    // MARK: - Quick Reply Chips

    private var quickReplyChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chipButton("Love it \u{2713}", isPrimary: true) {
                    onApproved()
                }
                chipButton("Change the chorus") {
                    // Handled by parent via chat input
                }
                chipButton("Make it funnier") {
                    // Handled by parent via chat input
                }
                chipButton("Edit a line") {
                    // Handled by parent via chat input
                }
            }
        }
    }

    private func chipButton(_ text: String, isPrimary: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text)
                .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(isPrimary ? DesignTokens.gold.opacity(0.15) : DesignTokens.surface)
                .foregroundStyle(isPrimary ? DesignTokens.gold : DesignTokens.textSecondary)
                .clipShape(Capsule())
                .overlay(
                    Capsule()
                        .stroke(isPrimary ? DesignTokens.gold.opacity(0.3) : DesignTokens.border, lineWidth: 0.5)
                )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Preview

#Preview {
    let mockLyrics = Lyrics(
        title: "Birthday Song for Sarah",
        style: "acoustic",
        sections: [
            LyricsSection(name: "verse_1", lines: [
                "Remember when we climbed that mountain trail",
                "You said the view was worth the aching feet",
                "Thirty years of you and I won't bail",
                "Every single chapter's bittersweet"
            ]),
            LyricsSection(name: "chorus", lines: [
                "Here's to you, here's to thirty more",
                "Of late-night talks and mornings at the shore",
                "You're the one who picks up at 3 AM",
                "Sarah, I'd do it all again"
            ]),
            LyricsSection(name: "verse_2", lines: [
                "From college dorms to houses by the bay",
                "You taught me how to laugh at my mistakes",
                "Here's to every single yesterday",
                "And all the memories the future makes"
            ]),
        ],
        anchorLine: "Here's to you, here's to thirty more"
    )

    ZStack {
        DesignTokens.background.ignoresSafeArea()

        ScrollView {
            VStack(spacing: 16) {
                InlineLyricsCard(
                    lyrics: mockLyrics,
                    controller: nil,
                    isInteractive: true,
                    style: "Acoustic",
                    highlightTerms: [],
                    onApproved: { print("Approved") },
                    onRegenerateLyrics: { print("Regenerate") }
                )

                InlineLyricsCard(
                    lyrics: mockLyrics,
                    controller: nil,
                    isInteractive: false,
                    style: "R&B",
                    highlightTerms: [],
                    onApproved: {},
                    onRegenerateLyrics: {}
                )
            }
            .padding(.horizontal, 16)
        }
    }
}
