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
    var onEditSection: ((Int) -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header

            if controller?.isModerationBlocked == true {
                moderationBlockedState
            } else if controller?.isAIUnavailable == true {
                aiUnavailableState
            } else if lyrics.sections.isEmpty && controller?.isLoading == false {
                errorState
            } else {
                ZStack {
                    lyricsBody
                        .opacity(controller?.isGenerating == true ? 0.3 : 1.0)
                    if controller?.isGenerating == true {
                        VStack(spacing: 10) {
                            ProgressView()
                                .tint(DesignTokens.gold)
                            Text("Regenerating lyrics…")
                                .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                                .foregroundStyle(DesignTokens.textSecondary)
                        }
                    }
                }
                .animation(.easeInOut(duration: 0.2), value: controller?.isGenerating)
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

    /// Whether edit/save/approve actions are blocked by in-progress operations.
    private var isOperationInProgress: Bool {
        controller?.isSaving == true || controller?.isApproving == true || controller?.isGenerating == true
    }

    private var lyricsBody: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Highlight banner when policy terms present
            if !highlightTerms.isEmpty && isInteractive {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.circle")
                        .font(.system(size: 11))
                    Text("Tap a section to edit highlighted words")
                        .font(DesignTokens.bodyFont(size: 11))
                }
                .foregroundStyle(DesignTokens.warning)
            }

            ForEach(Array(lyrics.sections.enumerated()), id: \.element.id) { index, section in
                VStack(alignment: .leading, spacing: 4) {
                    // Section header with optional pencil button
                    HStack {
                        Text(formatSectionName(section.name).uppercased())
                            .font(DesignTokens.bodyFont(size: 10, weight: .bold))
                            .foregroundStyle(DesignTokens.textTertiary)
                            .tracking(1)

                        Spacer()

                        if isInteractive, controller != nil, !isOperationInProgress {
                            Button { onEditSection?(index) } label: {
                                Image(systemName: "pencil.circle")
                                    .font(.system(size: 16))
                                    .foregroundStyle(DesignTokens.gold.opacity(0.6))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Edit \(formatSectionName(section.name))")
                        }
                    }

                    ForEach(section.lines) { line in
                        if !highlightTerms.isEmpty, let ctrl = controller {
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

    // MARK: - Interactive Chips (state-aware)

    private var hasUnsavedChanges: Bool {
        controller?.hasUnsavedChanges == true
    }

    private var quickReplyChips: some View {
        let approveBlocked = hasUnsavedChanges || isOperationInProgress

        return VStack(alignment: .leading, spacing: 8) {
            if hasUnsavedChanges {
                HStack(spacing: 4) {
                    Image(systemName: "exclamationmark.circle")
                        .font(.system(size: 10))
                    Text("Unsaved changes — save before approving")
                        .font(DesignTokens.bodyFont(size: 11))
                }
                .foregroundStyle(DesignTokens.warning)
            }

            HStack(spacing: 8) {
                if hasUnsavedChanges {
                    if controller?.isSaving == true {
                        ProgressView()
                            .tint(DesignTokens.gold)
                            .scaleEffect(0.8)
                    } else {
                        chipButton("Save Changes", isPrimary: true) {
                            controller?.saveLyrics()
                        }
                    }
                }

                primaryCTAButton("Create my song ✦", enabled: !approveBlocked) {
                    onApproved()
                }
                .disabled(approveBlocked)
                .opacity(approveBlocked ? 0.4 : 1.0)
                .accessibilityHint(approveBlocked ? "Save your changes before creating the song" : "")

                if controller?.isGenerating == true {
                    HStack(spacing: 6) {
                        ProgressView()
                            .tint(DesignTokens.gold)
                            .scaleEffect(0.8)
                        Text("Regenerating…")
                            .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                            .foregroundStyle(DesignTokens.textSecondary)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                } else {
                    chipButton("Regenerate") {
                        onRegenerateLyrics()
                    }
                    .disabled(isOperationInProgress)
                    .opacity(isOperationInProgress ? 0.4 : 1.0)
                }
            }
        }
    }

    // MARK: - Moderation Blocked

    private var moderationBlockedState: some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.shield")
                .font(.system(size: 24))
                .foregroundStyle(DesignTokens.warning)
            Text("Content flagged by moderation")
                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                .foregroundStyle(DesignTokens.textPrimary)
            if let reason = controller?.moderationReason {
                Text(reason)
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button {
                controller?.clearModerationAndRetry()
            } label: {
                Text("Try Again")
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

    // MARK: - AI Unavailable

    private var aiUnavailableState: some View {
        VStack(spacing: 12) {
            Image(systemName: "cloud.bolt")
                .font(.system(size: 24))
                .foregroundStyle(DesignTokens.textTertiary)
            Text("AI service temporarily unavailable")
                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                .foregroundStyle(DesignTokens.textPrimary)
            if let message = controller?.aiUnavailableMessage, !message.isEmpty {
                Text(message)
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button {
                controller?.clearAIUnavailableAndRetry()
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

    /// Prominent conversion CTA — solid coral fill, bold white text, softly glowing
    /// shadow. Used for "Create my song" so it visually dominates over secondary
    /// chips (Save / Regenerate) instead of blending in.
    private func primaryCTAButton(
        _ text: String,
        enabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(text)
                .font(DesignTokens.bodyFont(size: 15, weight: .bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
                .background(DesignTokens.gold)
                .clipShape(Capsule())
                .shadow(
                    color: DesignTokens.gold.opacity(enabled ? 0.35 : 0),
                    radius: 10,
                    y: 3
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
