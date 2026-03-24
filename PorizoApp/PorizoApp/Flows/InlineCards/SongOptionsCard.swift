//
//  SongOptionsCard.swift
//  PorizoApp
//
//  Inline song options card for the pre-session chat shell.
//  Shows three options: Continue (AI writes lyrics), Own Lyrics, Instrumental.
//  Appears only for generic-launch Song selection before session starts.
//

import SwiftUI

struct SongOptionsCard: View {
    let onContinue: () -> Void
    let onOwnLyrics: () -> Void
    let onInstrumental: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            PromptBubble(text: "How would you like to create your song?")

            // Option buttons
            VStack(spacing: 6) {
                optionButton(
                    icon: "sparkles",
                    label: "Continue",
                    subtitle: "AI writes the lyrics",
                    action: onContinue
                )
                optionButton(
                    icon: "text.quote",
                    label: "I'll write my own lyrics",
                    subtitle: nil,
                    action: onOwnLyrics
                )
                optionButton(
                    icon: "waveform",
                    label: "Instrumental",
                    subtitle: "No vocals",
                    action: onInstrumental
                )
            }
        }
    }

    private func optionButton(icon: String, label: String, subtitle: String?, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 12))
                    .foregroundStyle(DesignTokens.gold)
                    .frame(width: 20)

                VStack(alignment: .leading, spacing: 2) {
                    Text(label)
                        .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                        .foregroundStyle(DesignTokens.textPrimary)

                    if let subtitle {
                        Text(subtitle)
                            .font(DesignTokens.bodyFont(size: 11))
                            .foregroundStyle(DesignTokens.textTertiary)
                    }
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(DesignTokens.textTertiary)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(DesignTokens.surface)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(DesignTokens.border, lineWidth: 0.5)
            )
        }
        .buttonStyle(.plain)
    }
}

#Preview {
    ZStack {
        DesignTokens.background.ignoresSafeArea()

        VStack(spacing: 16) {
            SongOptionsCard(
                onContinue: { print("Continue") },
                onOwnLyrics: { print("Own lyrics") },
                onInstrumental: { print("Instrumental") }
            )
        }
        .padding(.horizontal, 16)
    }
}
