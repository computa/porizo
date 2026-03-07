//
//  ChatMessageBubble.swift
//  PorizoApp
//
//  Chat-style message bubble matching v1.pen Velvet & Gold design.
//  AI messages appear left-aligned with gold accent badges.
//  User messages appear right-aligned with surface background.
//

import SwiftUI

// MARK: - Chat Message Bubble

struct ChatMessageBubble: View {
    let message: V2Message
    let isLatest: Bool
    let showTypewriterEffect: Bool

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

                if shouldShowSlotGuidance, let guidance = message.slotGuidance {
                    slotGuidanceCard(guidance: guidance)
                }
            }

            if message.role == .ai {
                Spacer(minLength: 48)
            }
        }
        .padding(.horizontal, 16)
    }

    private var shouldShowSlotGuidance: Bool {
        guard message.role == .ai, message.action == .ask || message.action == .clarify else {
            return false
        }
        return message.slotGuidance != nil
    }

    // MARK: - Action Badge (v1.pen: gold accent)

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
            if showTypewriterEffect && isLatest && message.role == .ai && message.content.count <= 350 {
                TypewriterText(
                    text: message.content,
                    speed: 0.02
                )
                .font(DesignTokens.bodyFont(size: 16))
                .foregroundColor(DesignTokens.textPrimary)
            } else {
                SelectableText(
                    text: message.content,
                    font: .systemFont(ofSize: 16),
                    textColor: UIColor(message.role == .user ? DesignTokens.background : DesignTokens.textPrimary)
                )
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(bubbleBackground.clipShape(bubbleShape))
        .contentShape(bubbleShape)
    }

    private var bubbleBackground: Color {
        if message.role == .user {
            // User messages: gold bubble
            return DesignTokens.gold
        } else {
            // AI messages: surface with action tint
            return bubbleColorForAction(message.action)
        }
    }

    private var bubbleShape: some Shape {
        BubbleShape(isFromUser: message.role == .user)
    }

    private func slotGuidanceCard(guidance: StorySlotGuidance) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("How to strengthen this")
                .font(DesignTokens.bodyFont(size: 13, weight: .semibold))
                .foregroundColor(DesignTokens.gold)

            Text(guidance.instruction)
                .font(DesignTokens.bodyFont(size: 13))
                .foregroundColor(DesignTokens.textPrimary)
                .textSelection(.enabled)

            if let template = guidance.answerTemplate, !template.isEmpty {
                Text("Format: \(template)")
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundColor(DesignTokens.textSecondary)
                    .textSelection(.enabled)
            }

            if let firstExample = guidance.examples?.first, !firstExample.isEmpty {
                Text("Example: \"\(firstExample)\"")
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundColor(DesignTokens.textSecondary)
                    .textSelection(.enabled)
            }
        }
        .padding(10)
        .background(DesignTokens.surface.opacity(0.9))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(DesignTokens.gold.opacity(0.35), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Color Helpers (v1.pen: gold-based palette)

    private func actionForegroundColor(for action: V2Action) -> Color {
        switch action {
        case .ask:
            return DesignTokens.gold
        case .clarify:
            return DesignTokens.warning
        case .confirm:
            return DesignTokens.success
        case .stop:
            return Color(hex: "#A855F7") // Purple
        }
    }

    private func actionBackgroundColor(for action: V2Action) -> Color {
        switch action {
        case .ask:
            return DesignTokens.gold.opacity(0.15)
        case .clarify:
            return Color.orange.opacity(0.12)
        case .confirm:
            return Color.green.opacity(0.12)
        case .stop:
            return Color(hex: "#A855F7").opacity(0.12)
        }
    }

    private func bubbleColorForAction(_ action: V2Action?) -> Color {
        // AI bubble: surface color (v1.pen: #161616)
        return DesignTokens.surface
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
    @State private var typingTask: Task<Void, Never>?

    var body: some View {
        Text(displayedText)
            .textSelection(.enabled)
            .onAppear {
                startTyping()
            }
            .onChange(of: text) { _, _ in
                startTyping()
            }
            .onDisappear {
                typingTask?.cancel()
                typingTask = nil
            }
    }

    private func startTyping() {
        typingTask?.cancel()
        displayedText = ""
        guard !text.isEmpty else { return }

        let intervalNanos = UInt64(max(speed, 0.001) * 1_000_000_000)
        typingTask = Task { @MainActor in
            for character in text {
                if Task.isCancelled { return }
                displayedText.append(character)
                try? await Task.sleep(nanoseconds: intervalNanos)
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
    .background(DesignTokens.background)
}
