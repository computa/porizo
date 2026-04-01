//
//  EmptyStateView.swift
//  PorizoApp
//
//  Reusable empty state component with engaging illustrations
//  and clear calls to action.
//

import SwiftUI

// MARK: - Empty State Types

enum EmptyStateType {
    case noSongs
    case noVoiceProfile
    case noSearchResults
    case offline
    case generic(icon: String, title: String, message: String)

    var icon: String {
        switch self {
        case .noSongs: return "music.note.list"
        case .noVoiceProfile: return "waveform.and.mic"
        case .noSearchResults: return "magnifyingglass"
        case .offline: return "wifi.slash"
        case .generic(let icon, _, _): return icon
        }
    }

    var title: String {
        switch self {
        case .noSongs: return "No Songs Yet"
        case .noVoiceProfile: return "Set Up Your Voice"
        case .noSearchResults: return "No Results"
        case .offline: return "You're Offline"
        case .generic(_, let title, _): return title
        }
    }

    var message: String {
        switch self {
        case .noSongs:
            return "Create your first personalized song\nand share it with someone special"
        case .noVoiceProfile:
            return "Record your voice to create songs\nthat sound just like you"
        case .noSearchResults:
            return "Try a different search term\nor browse our occasions"
        case .offline:
            return "Check your connection\nand try again"
        case .generic(_, _, let message):
            return message
        }
    }

    var accentColors: [Color] {
        switch self {
        case .noSongs:
            return [DesignTokens.gold, DesignTokens.gold]
        case .noVoiceProfile:
            return [DesignTokens.sage, DesignTokens.sage.opacity(0.7)]
        case .noSearchResults:
            return [Color(hex: "#3b82f6"), Color(hex: "#60a5fa")]
        case .offline:
            return [Color(hex: "#f59e0b"), Color(hex: "#fbbf24")]
        case .generic:
            return [DesignTokens.gold, DesignTokens.gold]
        }
    }
}

// MARK: - Empty State View

struct EmptyStateView: View {
    let type: EmptyStateType
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil
    var secondaryActionTitle: String? = nil
    var secondaryAction: (() -> Void)? = nil

    @State private var hapticTrigger = false

    var body: some View {
        VStack(spacing: 28) {
            Spacer()

            // Illustrated icon with decorative elements
            illustrationView

            // Title and message
            VStack(spacing: 10) {
                Text(type.title)
                    .font(.title2.bold())
                    .foregroundStyle(DesignTokens.textPrimary)

                Text(type.message)
                    .font(.body)
                    .foregroundStyle(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(4)
            }

            // Actions
            if let actionTitle = actionTitle, let action = action {
                VStack(spacing: 12) {
                    Button {
                        hapticTrigger.toggle()
                        action()
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: actionIcon)
                            Text(actionTitle)
                        }
                        .font(.headline)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 28)
                        .padding(.vertical, 14)
                        .background(DesignTokens.gold)
                        .clipShape(.rect(cornerRadius: 25))
                    }

                    if let secondaryTitle = secondaryActionTitle,
                       let secondaryAction = secondaryAction {
                        Button {
                            secondaryAction()
                        } label: {
                            Text(secondaryTitle)
                                .font(.subheadline)
                                .foregroundStyle(DesignTokens.textSecondary)
                        }
                    }
                }
                .padding(.top, 8)
            }

            Spacer()
        }
        .padding()
        .sensoryFeedback(.impact(weight: .medium), trigger: hapticTrigger)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(type.title). \(type.message)")
    }

    private var actionIcon: String {
        switch type {
        case .noSongs: return "wand.and.stars"
        case .noVoiceProfile: return "mic.fill"
        case .noSearchResults: return "arrow.clockwise"
        case .offline: return "arrow.clockwise"
        case .generic: return "plus.circle.fill"
        }
    }

    private var illustrationView: some View {
        ZStack {
            // Outer decorative ring
            outerRing

            // Middle decorative ring
            middleRing

            // Main icon circle with icon
            iconBackground
            iconImage
        }
        .accessibilityHidden(true)
    }

    private var outerRing: some View {
        Circle()
            .stroke(type.accentColors[0].opacity(0.2), lineWidth: 2)
            .frame(width: 160, height: 160)
    }

    private var middleRing: some View {
        Circle()
            .stroke(type.accentColors[0].opacity(0.3), lineWidth: 3)
            .frame(width: 130, height: 130)
    }

    private var iconBackground: some View {
        Circle()
            .fill(type.accentColors[0].opacity(0.15))
            .frame(width: 100, height: 100)
    }

    private var iconImage: some View {
        Image(systemName: type.icon)
            .font(.system(size: 44))
            .foregroundStyle(type.accentColors[0])
    }
}

// MARK: - Previews

#Preview("No Songs") {
    ZStack {
        DesignTokens.surface.ignoresSafeArea()

        EmptyStateView(
            type: .noSongs,
            actionTitle: "Create Your First Song",
            action: { }
        )
    }
}

#Preview("No Voice Profile") {
    ZStack {
        DesignTokens.surface.ignoresSafeArea()

        EmptyStateView(
            type: .noVoiceProfile,
            actionTitle: "Set Up Voice",
            action: { },
            secondaryActionTitle: "Learn more",
            secondaryAction: { }
        )
    }
}

#Preview("Offline") {
    ZStack {
        DesignTokens.surface.ignoresSafeArea()

        EmptyStateView(
            type: .offline,
            actionTitle: "Try Again",
            action: { }
        )
    }
}
