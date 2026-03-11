//
//  StoryInputComponents.swift
//  PorizoApp
//
//  Shared components for Perplexity-style input bars.
//  Used by InputBarView and ElementGuidanceSheet.
//

import SwiftUI

// MARK: - Floating Input Container

/// Two-tone floating container: lighter text zone on top, darker action row below,
/// clipped with 24pt corners and a subtle gold border. Floats above the background.
struct FloatingInputContainer<TextZone: View, ActionRow: View>: View {
    @ViewBuilder var textZone: TextZone
    @ViewBuilder var actionRow: ActionRow

    var body: some View {
        VStack(spacing: 0) {
            textZone
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
                .background(DesignTokens.surfaceElevated)

            actionRow
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(DesignTokens.surface)
        }
        .clipShape(.rect(cornerRadius: DesignTokens.radiusPremium))
        .overlay {
            RoundedRectangle(cornerRadius: DesignTokens.radiusPremium)
                .strokeBorder(DesignTokens.gold.opacity(0.15), lineWidth: 1)
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
    }
}

// MARK: - Buttons

struct MicButtonView: View {
    let action: () -> Void

    var body: some View {
        Button("Voice input", systemImage: "mic.fill", action: action)
            .labelStyle(.iconOnly)
            .font(.system(size: 16))
            .foregroundStyle(DesignTokens.gold)
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Circle())
            .buttonStyle(.plain)
    }
}

struct SendButtonView: View {
    let canSend: Bool
    let action: () -> Void

    var body: some View {
        Button("Send", systemImage: "arrow.up.circle.fill", action: action)
            .labelStyle(.iconOnly)
            .font(.system(size: 28))
            .foregroundStyle(canSend ? DesignTokens.gold : DesignTokens.border)
            .disabled(!canSend)
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Circle())
            .buttonStyle(.plain)
    }
}
