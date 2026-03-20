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
    private let collapsedLineLimit = 9
    private let collapsibleLengthThreshold = 420

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
        .foregroundStyle(actionForegroundColor(for: action))
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
                .foregroundStyle(DesignTokens.textPrimary)
            } else if shouldCollapseLongUserBubble {
                CollapsibleBubbleText(
                    text: message.content,
                    textColor: UIColor(message.role == .user ? DesignTokens.background : DesignTokens.textPrimary),
                    collapsedLineLimit: collapsedLineLimit
                )
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

    private var shouldCollapseLongUserBubble: Bool {
        message.role == .user && message.content.count > collapsibleLengthThreshold
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
        let hasEnrichedGuidance = guidance.storyAnchor != nil || guidance.diagnosis != nil

        return VStack(alignment: .leading, spacing: 8) {
            Text("How to strengthen this")
                .font(DesignTokens.bodyFont(size: 13, weight: .semibold))
                .foregroundStyle(DesignTokens.gold)

            // Story anchor quote — the exact text being improved
            if let anchor = guidance.storyAnchor, !anchor.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("FROM YOUR STORY")
                        .font(DesignTokens.bodyFont(size: 10, weight: .semibold))
                        .foregroundStyle(DesignTokens.gold.opacity(0.7))
                        .tracking(0.5)

                    HStack(spacing: 0) {
                        RoundedRectangle(cornerRadius: 1)
                            .fill(DesignTokens.gold.opacity(0.5))
                            .frame(width: 2)

                        Text("\"\(anchor)\"")
                            .font(DesignTokens.displayFont(size: 13, relativeTo: .caption))
                            .foregroundStyle(DesignTokens.textPrimary.opacity(0.85))
                            .padding(.leading, 8)
                    }
                }
                .padding(8)
                .background(Color(hex: "#121212"))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }

            // Diagnosis or instruction
            Text(hasEnrichedGuidance ? (guidance.diagnosis ?? guidance.instruction) : guidance.instruction)
                .font(DesignTokens.bodyFont(size: 13))
                .foregroundStyle(DesignTokens.textPrimary)
                .textSelection(.enabled)

            // Lightbulb suggestion
            if let suggestion = guidance.suggestion, !suggestion.isEmpty {
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "lightbulb.fill")
                        .font(.system(size: 12))
                        .foregroundStyle(DesignTokens.gold)
                        .padding(.top, 2)

                    Text(suggestion)
                        .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                        .foregroundStyle(DesignTokens.textPrimary)
                }
            } else if !hasEnrichedGuidance, let template = guidance.answerTemplate, !template.isEmpty {
                // Template fallback
                Text("Format: \(template)")
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .textSelection(.enabled)
            }

            // Examples
            if let examples = guidance.examples, !examples.isEmpty {
                let label = hasEnrichedGuidance ? "Try something like:" : "Example:"
                VStack(alignment: .leading, spacing: 4) {
                    Text(label)
                        .font(DesignTokens.bodyFont(size: 11))
                        .foregroundStyle(DesignTokens.textSecondary)

                    ForEach(examples.prefix(2), id: \.self) { example in
                        Text("\"\(example)\"")
                            .font(DesignTokens.bodyFont(size: 12))
                            .foregroundStyle(DesignTokens.textSecondary)
                            .padding(8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color(hex: "#121212"))
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                }
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
                try? await Task.sleep(for: .nanoseconds(intervalNanos))
            }
        }
    }
}

private struct CollapsibleBubbleText: View {
    let text: String
    let textColor: UIColor
    let collapsedLineLimit: Int

    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SelectableText(
                text: text,
                font: .systemFont(ofSize: 16),
                textColor: textColor
            )
            .frame(maxHeight: isExpanded ? .infinity : CGFloat(collapsedLineLimit) * 20, alignment: .top)
            .clipped()

            Button(isExpanded ? "Show less" : "Show more") {
                withAnimation(.easeInOut(duration: 0.2)) {
                    isExpanded.toggle()
                }
            }
            .buttonStyle(.plain)
            .font(DesignTokens.bodyFont(size: 13, weight: .semibold))
            .foregroundStyle(Color(textColor).opacity(0.72))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
