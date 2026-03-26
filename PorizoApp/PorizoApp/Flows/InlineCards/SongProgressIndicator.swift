//
//  SongProgressIndicator.swift
//  PorizoApp
//
//  Sticky progress indicator showing current step in the song creation flow.
//  Always visible at the top of the chat scroll view.
//

import SwiftUI

struct SongProgressIndicator: View {
    let currentProgress: UnifiedCreateFlowView.SongProgress

    private struct Step {
        let icon: String
        let label: String
        let progress: UnifiedCreateFlowView.SongProgress
    }

    private let steps: [Step] = [
        Step(icon: "bubble.left.fill", label: "Chat", progress: .conversing),
        Step(icon: "mic.fill", label: "Voice", progress: .confirmed),
        Step(icon: "music.note.list", label: "Lyrics", progress: .trackCreated),
        Step(icon: "waveform", label: "Render", progress: .lyricsApproved),
        Step(icon: "play.circle.fill", label: "Done", progress: .previewReady),
    ]

    private func stepIndex(for progress: UnifiedCreateFlowView.SongProgress) -> Int {
        switch progress {
        case .conversing: return 0
        case .confirmed: return 1
        case .voiceSelected: return 1
        case .trackCreated: return 2
        case .lyricsApproved: return 3
        case .previewReady, .fullRenderActive, .fullRenderReady: return 4
        }
    }

    var body: some View {
        let activeIndex = stepIndex(for: currentProgress)

        HStack(spacing: 0) {
            ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                let isActive = index == activeIndex
                let isComplete = index < activeIndex

                HStack(spacing: 4) {
                    if isComplete {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 10))
                            .foregroundStyle(DesignTokens.gold.opacity(0.6))
                    } else {
                        Image(systemName: step.icon)
                            .font(.system(size: 10))
                            .foregroundStyle(isActive ? DesignTokens.gold : DesignTokens.textTertiary)
                    }

                    Text(step.label)
                        .font(DesignTokens.bodyFont(size: 10, weight: isActive ? .semibold : .regular))
                        .foregroundStyle(isActive ? DesignTokens.gold : (isComplete ? DesignTokens.textSecondary : DesignTokens.textTertiary))
                }
                .padding(.horizontal, 6)

                if index < steps.count - 1 {
                    Rectangle()
                        .fill(index < activeIndex ? DesignTokens.gold.opacity(0.4) : DesignTokens.border)
                        .frame(height: 0.5)
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(DesignTokens.background.opacity(0.95))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Song progress: \(steps[min(activeIndex, steps.count - 1)].label)")
    }
}
