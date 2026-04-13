//
//  StoryElementsCard.swift
//  PorizoApp
//
//  Shared Story Elements progress card for creation flow redesign.
//  Shows each story beat as a progress bar with completion state.
//  Matches the existing production InteractiveStoryElementsView design.
//
//  Each beat has:
//  - Colored dot (gold = in-progress, success = complete)
//  - Label (bold when in-progress)
//  - Progress bar (gold = in-progress, success = complete)
//  - Checkmark when complete
//

import SwiftUI


// MARK: - Story Beat Model

struct StoryBeat: Identifiable {
    let id = UUID()
    let label: String
    let progress: Double  // 0.0 to 1.0
    let isComplete: Bool
    let isActive: Bool    // currently being worked on
}

let mockStoryBeats: [StoryBeat] = [
    StoryBeat(label: "The Setting", progress: 1.0, isComplete: true, isActive: false),
    StoryBeat(label: "The Feeling", progress: 0.45, isComplete: false, isActive: true),
    StoryBeat(label: "Your Bond", progress: 1.0, isComplete: true, isActive: false),
    StoryBeat(label: "The Moment", progress: 1.0, isComplete: true, isActive: false),
    StoryBeat(label: "The Details", progress: 1.0, isComplete: true, isActive: false),
]

// MARK: - Story Elements Card

struct StoryElementsCard: View {
    var beats: [StoryBeat] = mockStoryBeats
    var isCollapsed: Bool = false
    var onToggle: (() -> Void)? = nil

    private var completionPercent: Int {
        let total = beats.count
        guard total > 0 else { return 0 }
        let completed = beats.reduce(0.0) { $0 + $1.progress }
        return Int((completed / Double(total)) * 100)
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header (tappable)
            Button {
                onToggle?()
            } label: {
                HStack {
                    Text("Story Elements")
                        .font(DesignTokens.bodyFont(size: 16, weight: .bold))
                        .foregroundStyle(DesignTokens.textPrimary)
                    Spacer()
                    Text("\(completionPercent)%")
                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        .foregroundStyle(DesignTokens.gold)
                }
                .padding(.horizontal, 18)
                .padding(.top, 18)
                .padding(.bottom, isCollapsed ? 18 : 10)
            }
            .buttonStyle(.plain)

            if !isCollapsed {
                // Beat rows
                VStack(spacing: 4) {
                    ForEach(beats) { beat in
                        beatRow(beat)
                    }
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 18)
            }
        }
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(DesignTokens.border, lineWidth: 0.5)
        )
    }

    private func beatRow(_ beat: StoryBeat) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                // Status dot
                Circle()
                    .fill(beatColor(beat))
                    .frame(width: 8, height: 8)

                // Label
                Text(beat.label)
                    .font(DesignTokens.bodyFont(size: 15, weight: beat.isActive ? .bold : .regular))
                    .foregroundStyle(beat.isActive ? DesignTokens.textPrimary : DesignTokens.textSecondary)

                Spacer()

                // Checkmark
                if beat.isComplete {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 18))
                        .foregroundStyle(DesignTokens.success.opacity(0.7))
                }
            }

            // Progress bar
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    // Track
                    RoundedRectangle(cornerRadius: 3)
                        .fill(beatColor(beat).opacity(0.2))
                        .frame(height: 5)

                    // Fill
                    RoundedRectangle(cornerRadius: 3)
                        .fill(beatColor(beat))
                        .frame(width: geo.size.width * beat.progress, height: 5)
                }
            }
            .frame(height: 5)
        }
        .padding(.vertical, 10)
    }

    private func beatColor(_ beat: StoryBeat) -> Color {
        if beat.isActive {
            return DesignTokens.gold
        }
        return DesignTokens.success
    }
}

