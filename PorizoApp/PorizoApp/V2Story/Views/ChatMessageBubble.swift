//
//  ChatMessageBubble.swift
//  PorizoApp
//
//  Chat-style message bubble — Warm Canvas design.
//  AI messages appear left-aligned with sage accent badges.
//  User messages appear right-aligned with soft coral background.
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
                Spacer(minLength: 60)
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
                Spacer(minLength: 60)
            }
        }
        .padding(.horizontal, 20)
    }

    private var shouldShowSlotGuidance: Bool {
        guard message.role == .ai, message.action == .ask || message.action == .clarify else {
            return false
        }
        return message.slotGuidance != nil
    }

    // MARK: - Action Badge (sage accent for AI messages)

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
                .font(DesignTokens.bodyFont(size: 14))
                .foregroundStyle(DesignTokens.textPrimary)
            } else if shouldCollapseLongUserBubble {
                CollapsibleBubbleText(
                    text: message.content,
                    textColor: UIColor(DesignTokens.textPrimary),
                    collapsedLineLimit: collapsedLineLimit
                )
            } else {
                SelectableText(
                    text: message.content,
                    font: .systemFont(ofSize: 14),
                    textColor: UIColor(DesignTokens.textPrimary)
                )
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(bubbleBackground.clipShape(bubbleShape))
        .contentShape(bubbleShape)
    }

    private var shouldCollapseLongUserBubble: Bool {
        message.role == .user && message.content.count > collapsibleLengthThreshold
    }

    private var bubbleBackground: Color {
        if message.role == .user {
            // User messages: soft coral bubble
            return DesignTokens.coralBubble
        } else {
            // AI messages: soft sage bubble
            return DesignTokens.sageBubble
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
                .foregroundStyle(DesignTokens.sage)

            // Story anchor quote — the exact text being improved
            if let anchor = guidance.storyAnchor, !anchor.isEmpty, anchor != "null" {
                VStack(alignment: .leading, spacing: 4) {
                    Text("FROM YOUR STORY")
                        .font(DesignTokens.bodyFont(size: 10, weight: .semibold))
                        .foregroundStyle(DesignTokens.sage.opacity(0.7))
                        .tracking(0.5)

                    HStack(spacing: 0) {
                        RoundedRectangle(cornerRadius: 1)
                            .fill(DesignTokens.sage.opacity(0.5))
                            .frame(width: 2)

                        Text("\"\(anchor)\"")
                            .font(DesignTokens.displayFont(size: 13, relativeTo: .caption))
                            .foregroundStyle(DesignTokens.textPrimary.opacity(0.85))
                            .padding(.leading, 8)
                    }
                }
                .padding(8)
                .background(DesignTokens.surfaceMuted)
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
                        .foregroundStyle(DesignTokens.sage)
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
                            .background(DesignTokens.surfaceMuted)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                }
            }
        }
        .padding(10)
        .background(DesignTokens.sageBubble.opacity(0.6))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(DesignTokens.sage.opacity(0.25), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Color Helpers (Warm Canvas palette)

    private func actionForegroundColor(for action: V2Action) -> Color {
        switch action {
        case .ask:
            return DesignTokens.sage
        case .clarify:
            return DesignTokens.warning
        case .confirm:
            return DesignTokens.success
        case .stop:
            return DesignTokens.sage
        }
    }

    private func actionBackgroundColor(for action: V2Action) -> Color {
        switch action {
        case .ask:
            return DesignTokens.sage.opacity(0.15)
        case .clarify:
            return Color.orange.opacity(0.12)
        case .confirm:
            return Color.green.opacity(0.12)
        case .stop:
            return DesignTokens.sage.opacity(0.12)
        }
    }
}

// MARK: - Bubble Shape

struct BubbleShape: Shape {
    let isFromUser: Bool

    func path(in rect: CGRect) -> Path {
        // Asymmetric corners matching gallery prototype:
        // AI: large top-left, small bottom-left (tail), large others
        // User: large top-right, small bottom-right (tail), large others
        if isFromUser {
            return Path(
                UnsafeRoundedRect(
                    rect,
                    topLeading: 18, bottomLeading: 18,
                    bottomTrailing: 6, topTrailing: 18
                )
            )
        } else {
            return Path(
                UnsafeRoundedRect(
                    rect,
                    topLeading: 18, bottomLeading: 6,
                    bottomTrailing: 18, topTrailing: 18
                )
            )
        }
    }
}

/// Helper to build a path with per-corner radii (iOS 16+).
private func UnsafeRoundedRect(
    _ rect: CGRect,
    topLeading: CGFloat, bottomLeading: CGFloat,
    bottomTrailing: CGFloat, topTrailing: CGFloat
) -> CGPath {
    let path = UIBezierPath()
    // Start at top-left after the top-leading radius
    path.move(to: CGPoint(x: rect.minX + topLeading, y: rect.minY))
    // Top edge → top-right corner
    path.addLine(to: CGPoint(x: rect.maxX - topTrailing, y: rect.minY))
    path.addArc(withCenter: CGPoint(x: rect.maxX - topTrailing, y: rect.minY + topTrailing),
                radius: topTrailing, startAngle: -.pi / 2, endAngle: 0, clockwise: true)
    // Right edge → bottom-right corner
    path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - bottomTrailing))
    path.addArc(withCenter: CGPoint(x: rect.maxX - bottomTrailing, y: rect.maxY - bottomTrailing),
                radius: bottomTrailing, startAngle: 0, endAngle: .pi / 2, clockwise: true)
    // Bottom edge → bottom-left corner
    path.addLine(to: CGPoint(x: rect.minX + bottomLeading, y: rect.maxY))
    path.addArc(withCenter: CGPoint(x: rect.minX + bottomLeading, y: rect.maxY - bottomLeading),
                radius: bottomLeading, startAngle: .pi / 2, endAngle: .pi, clockwise: true)
    // Left edge → top-left corner
    path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + topLeading))
    path.addArc(withCenter: CGPoint(x: rect.minX + topLeading, y: rect.minY + topLeading),
                radius: topLeading, startAngle: .pi, endAngle: -.pi / 2, clockwise: true)
    path.close()
    return path.cgPath
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
                font: .systemFont(ofSize: 14),
                textColor: textColor
            )
            .frame(maxHeight: isExpanded ? .infinity : CGFloat(collapsedLineLimit) * 18, alignment: .top)
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
