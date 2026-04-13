//
//  SharedPostCreateCards.swift
//  PorizoApp
//
//  Shared rendering progress and song player cards for post-Create flows.
//

import SwiftUI


// MARK: - Rendering Progress Card

struct RenderingProgressCard: View {
    var progress: Double = 0.87
    var statusText: String = "Generating vocal melody and mixing..."

    var body: some View {
        VStack(spacing: 12) {
            HStack {
                Image(systemName: "waveform")
                    .font(.system(size: 14))
                    .foregroundStyle(DesignTokens.gold)
                Text("Rendering your song...")
                    .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                    .foregroundStyle(DesignTokens.textPrimary)
                Spacer()
                Text("\(Int(progress * 100))%")
                    .font(DesignTokens.bodyFont(size: 13, weight: .semibold))
                    .foregroundStyle(DesignTokens.gold)
            }

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 4)
                        .fill(DesignTokens.gold.opacity(0.15))
                        .frame(height: 6)
                    RoundedRectangle(cornerRadius: 4)
                        .fill(DesignTokens.gold)
                        .frame(width: geo.size.width * progress, height: 6)
                }
            }
            .frame(height: 6)

            Text(statusText)
                .font(DesignTokens.bodyFont(size: 12))
                .foregroundStyle(DesignTokens.textTertiary)
        }
        .padding(16)
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(DesignTokens.gold.opacity(0.15), lineWidth: 0.5)
        )
    }
}

// MARK: - Song Player Card

struct SongPlayerCard: View {
    var title: String = "Birthday Song for Sarah"
    var style: String = "Acoustic"
    var duration: String = "0:45"

    var body: some View {
        VStack(spacing: 14) {
            // Album art
            ZStack {
                RoundedRectangle(cornerRadius: 14)
                    .fill(
                        LinearGradient(
                            colors: [DesignTokens.gold.opacity(0.4), DesignTokens.goldDark.opacity(0.2)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(height: 160)

                VStack(spacing: 8) {
                    Image(systemName: "music.note")
                        .font(.system(size: 36))
                        .foregroundStyle(DesignTokens.gold)
                    Text(title)
                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        .foregroundStyle(DesignTokens.textPrimary)
                    Text("\(style)  ·  \(duration)")
                        .font(DesignTokens.bodyFont(size: 12))
                        .foregroundStyle(DesignTokens.textSecondary)
                }
            }

            // Playback bar
            VStack(spacing: 6) {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 2)
                            .fill(DesignTokens.border)
                            .frame(height: 3)
                        RoundedRectangle(cornerRadius: 2)
                            .fill(DesignTokens.gold)
                            .frame(width: geo.size.width * 0.35, height: 3)
                        Circle()
                            .fill(DesignTokens.gold)
                            .frame(width: 10, height: 10)
                            .offset(x: geo.size.width * 0.35 - 5)
                    }
                }
                .frame(height: 10)

                HStack {
                    Text("0:16")
                    Spacer()
                    Text(duration)
                }
                .font(DesignTokens.bodyFont(size: 10))
                .foregroundStyle(DesignTokens.textTertiary)
            }

            // Controls
            HStack(spacing: 24) {
                Spacer()
                Button {} label: {
                    Image(systemName: "backward.fill")
                        .font(.system(size: 20))
                        .foregroundStyle(DesignTokens.textSecondary)
                }
                Button {} label: {
                    Image(systemName: "pause.circle.fill")
                        .font(.system(size: 48))
                        .foregroundStyle(DesignTokens.gold)
                }
                Button {} label: {
                    Image(systemName: "forward.fill")
                        .font(.system(size: 20))
                        .foregroundStyle(DesignTokens.textSecondary)
                }
                Spacer()
            }

            // Action buttons
            HStack(spacing: 12) {
                playerAction(icon: "square.and.arrow.up", label: "Share")
                playerAction(icon: "arrow.triangle.2.circlepath", label: "Reroll")
                playerAction(icon: "heart", label: "Save")
            }
        }
        .padding(16)
        .background(DesignTokens.surfaceElevated)
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusLarge))
        .overlay(
            RoundedRectangle(cornerRadius: DesignTokens.radiusLarge)
                .stroke(DesignTokens.gold.opacity(0.15), lineWidth: 0.5)
        )
    }

    private func playerAction(icon: String, label: String) -> some View {
        Button {} label: {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 16))
                Text(label)
                    .font(DesignTokens.bodyFont(size: 11))
            }
            .foregroundStyle(DesignTokens.textSecondary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(DesignTokens.surface)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(DesignTokens.border, lineWidth: 0.5))
        }
    }
}

