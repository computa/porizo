//
//  ChatMessageBubble.swift
//  PorizoApp
//
//  Chat-style message bubble for the Adaptive Conversation UI.
//  AI messages appear left-aligned with action badges.
//  User messages appear right-aligned with filled background.
//

import SwiftUI

// MARK: - Chat Message Bubble

struct ChatMessageBubble: View {
    let message: V2Message
    let isLatest: Bool
    let showTypewriterEffect: Bool

    @State private var displayedText: String = ""
    @State private var isTyping: Bool = false

    init(message: V2Message, isLatest: Bool = false, showTypewriterEffect: Bool = false) {
        self.message = message
        self.isLatest = isLatest
        self.showTypewriterEffect = showTypewriterEffect
    }

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            if message.role == .user {
                Spacer(minLength: 48)
            }

            VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 6) {
                // Action badge for AI messages
                if message.role == .ai, let action = message.action {
                    actionBadge(action: action)
                }

                // Message bubble
                messageBubble
            }

            if message.role == .ai {
                Spacer(minLength: 48)
            }
        }
        .padding(.horizontal, 16)
    }

    // MARK: - Action Badge

    private func actionBadge(action: V2Action) -> some View {
        HStack(spacing: 4) {
            Image(systemName: action.iconName)
                .font(.system(size: 10, weight: .semibold))
            Text(action.displayName)
                .font(.caption2)
                .fontWeight(.medium)
        }
        .foregroundColor(actionForegroundColor(for: action))
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(
            Capsule()
                .fill(actionBackgroundColor(for: action))
        )
    }

    // MARK: - Message Bubble

    private var messageBubble: some View {
        Group {
            if showTypewriterEffect && isLatest && message.role == .ai {
                TypewriterText(
                    text: message.content,
                    speed: 0.02
                )
                .font(.body)
                .foregroundColor(DesignTokens.textPrimary)
            } else {
                Text(message.content)
                    .font(.body)
                    .foregroundColor(message.role == .user ? .white : DesignTokens.textPrimary)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(bubbleBackground)
        .clipShape(bubbleShape)
    }

    private var bubbleBackground: Color {
        if message.role == .user {
            return DesignTokens.rose
        } else {
            return bubbleColorForAction(message.action)
        }
    }

    private var bubbleShape: some Shape {
        BubbleShape(isFromUser: message.role == .user)
    }

    // MARK: - Color Helpers

    private func actionForegroundColor(for action: V2Action) -> Color {
        switch action {
        case .ask:
            return DesignTokens.rose
        case .clarify:
            return DesignTokens.warning
        case .confirm:
            return DesignTokens.success
        case .stop:
            return Color.purple
        }
    }

    private func actionBackgroundColor(for action: V2Action) -> Color {
        switch action {
        case .ask:
            return DesignTokens.roseMuted
        case .clarify:
            return Color.orange.opacity(0.12)
        case .confirm:
            return Color.green.opacity(0.12)
        case .stop:
            return Color.purple.opacity(0.12)
        }
    }

    private func bubbleColorForAction(_ action: V2Action?) -> Color {
        guard let action = action else {
            return DesignTokens.roseMuted
        }

        switch action {
        case .ask:
            return DesignTokens.roseMuted
        case .clarify:
            return Color.orange.opacity(0.12)
        case .confirm:
            return Color.green.opacity(0.12)
        case .stop:
            return Color.purple.opacity(0.12)
        }
    }
}

// MARK: - Bubble Shape

struct BubbleShape: Shape {
    let isFromUser: Bool

    func path(in rect: CGRect) -> Path {
        let cornerRadius: CGFloat = 16
        let tailSize: CGFloat = 6

        var path = Path()

        if isFromUser {
            // User bubble: rounded corners, slight tail on right
            path.addRoundedRect(
                in: CGRect(x: 0, y: 0, width: rect.width - tailSize, height: rect.height),
                cornerSize: CGSize(width: cornerRadius, height: cornerRadius)
            )
        } else {
            // AI bubble: rounded corners, slight tail on left
            path.addRoundedRect(
                in: CGRect(x: tailSize, y: 0, width: rect.width - tailSize, height: rect.height),
                cornerSize: CGSize(width: cornerRadius, height: cornerRadius)
            )
        }

        return path
    }
}

// MARK: - Typewriter Text

struct TypewriterText: View {
    let text: String
    let speed: Double

    @State private var displayedText: String = ""
    @State private var currentIndex: Int = 0

    var body: some View {
        Text(displayedText)
            .onAppear {
                startTyping()
            }
    }

    private func startTyping() {
        displayedText = ""
        currentIndex = 0

        Timer.scheduledTimer(withTimeInterval: speed, repeats: true) { timer in
            if currentIndex < text.count {
                let index = text.index(text.startIndex, offsetBy: currentIndex)
                displayedText += String(text[index])
                currentIndex += 1
            } else {
                timer.invalidate()
            }
        }
    }
}

// MARK: - Preview

#Preview {
    VStack(spacing: 16) {
        ChatMessageBubble(
            message: V2Message(
                role: .ai,
                content: "What's a special memory you have with them?",
                action: .ask
            )
        )

        ChatMessageBubble(
            message: V2Message(
                role: .user,
                content: "We went on a road trip together last summer and got lost in the mountains."
            )
        )

        ChatMessageBubble(
            message: V2Message(
                role: .ai,
                content: "That sounds amazing! Can you tell me more about what made that moment special?",
                action: .clarify
            )
        )
    }
    .padding()
    .background(DesignTokens.backgroundSubtle)
}
