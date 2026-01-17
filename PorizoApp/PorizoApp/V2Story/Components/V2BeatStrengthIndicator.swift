//
//  BeatStrengthIndicator.swift
//  PorizoApp
//
//  Displays story beat strength as dots, bars, or radial segments.
//

import SwiftUI

// MARK: - Display Styles

enum V2BeatDisplayStyle {
    case dots(count: Int = 5)       // Filled/empty dots
    case bar                         // Progress bar
    case compact                     // Single dot with fill
}

// MARK: - Beat Strength Indicator

struct V2BeatStrengthIndicator: View {
    let beat: V2Beat
    let style: V2BeatDisplayStyle

    var body: some View {
        switch style {
        case .dots(let count):
            dotsView(count: count)
        case .bar:
            barView
        case .compact:
            compactView
        }
    }

    // MARK: - Dot Style

    private func dotsView(count: Int) -> some View {
        HStack(spacing: 4) {
            ForEach(0..<count, id: \.self) { index in
                Circle()
                    .fill(index < beat.strengthDots ? DesignTokens.rose : DesignTokens.cardBorder)
                    .frame(width: 8, height: 8)
            }
        }
    }

    // MARK: - Bar Style

    private var barView: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                // Background
                RoundedRectangle(cornerRadius: 4)
                    .fill(DesignTokens.cardBorder)

                // Fill
                RoundedRectangle(cornerRadius: 4)
                    .fill(beat.isFilled ? DesignTokens.success : DesignTokens.rose)
                    .frame(width: geometry.size.width * beat.strength)
            }
        }
        .frame(height: 8)
    }

    // MARK: - Compact Style

    private var compactView: some View {
        Circle()
            .fill(beat.isFilled ? DesignTokens.success : DesignTokens.rose.opacity(beat.strength))
            .frame(width: 10, height: 10)
            .overlay(
                Circle()
                    .strokeBorder(beat.isFilled ? DesignTokens.success : DesignTokens.rose, lineWidth: 1)
            )
    }
}

// MARK: - Beat Row

/// A row showing beat name with strength indicator
struct V2BeatStrengthRow: View {
    let beat: V2Beat
    let style: V2BeatDisplayStyle

    var body: some View {
        HStack {
            // Beat indicator
            Circle()
                .fill(beat.isFilled ? DesignTokens.success : DesignTokens.rose.opacity(0.3))
                .frame(width: 8, height: 8)

            // Beat name
            Text(beat.displayName)
                .font(.caption)
                .foregroundColor(DesignTokens.textSecondary)

            Spacer()

            // Strength indicator
            V2BeatStrengthIndicator(beat: beat, style: style)
        }
    }
}

// MARK: - Beat Progress Summary

/// Shows all beats with their strengths
struct V2BeatProgressSummary: View {
    let beats: [V2Beat]
    let style: V2BeatDisplayStyle

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(beats) { beat in
                V2BeatStrengthRow(beat: beat, style: style)
            }
        }
    }
}

// MARK: - Compact Beat Dots

/// Horizontal row of compact beat dots for headers
struct V2CompactBeatDots: View {
    let beats: [V2Beat]

    var body: some View {
        HStack(spacing: 4) {
            ForEach(beats) { beat in
                Circle()
                    .fill(beat.isFilled ? DesignTokens.success : DesignTokens.cardBorder)
                    .frame(width: 8, height: 8)
            }
        }
    }
}
