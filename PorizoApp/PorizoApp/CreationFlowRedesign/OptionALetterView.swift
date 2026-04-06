//
//  OptionALetterView.swift
//  PorizoApp
//
//  Option A: "Warm Chat" — The chat feels like texting a creative friend.
//
//  Key differences from current:
//  - No form step at all. Name/occasion emerge from conversation.
//  - AI has personality — warm, curious, uses the recipient's name.
//  - User bubbles are gold, AI bubbles are subtle surface.
//  - Typing indicator with sparkle animation.
//  - Quick-reply chips below AI messages for faster responses.
//  - Compact header with just the recipient name + progress ring.
//  - "I'm ready" button appears when enough story is gathered.
//  - No separate "Story" tab — the story builds inline.
//

import SwiftUI

#if DEBUG

// MARK: - Chat Message Model

private struct ChatMsg: Identifiable {
    let id = UUID()
    let isUser: Bool
    let text: String
    let quickReplies: [String]
    let timestamp: String

    init(_ text: String, isUser: Bool, quickReplies: [String] = [], time: String = "") {
        self.text = text
        self.isUser = isUser
        self.quickReplies = quickReplies
        self.timestamp = time
    }
}

// MARK: - Mock Conversation

private let mockConversation: [ChatMsg] = [
    ChatMsg("Hey! Who's the lucky person getting a song? Just tell me their name and what the occasion is.", isUser: false, quickReplies: ["It's a birthday!", "Anniversary coming up", "Just want to say thanks"], time: "2:30 PM"),
    ChatMsg("It's my best friend Sarah's 30th birthday!", isUser: true, time: "2:31 PM"),
    ChatMsg("Sarah's turning 30 — that's a big one! I'd love to make this song really personal. What's your favorite memory with Sarah? Something that makes you smile every time you think about it.", isUser: false, quickReplies: ["A trip we took", "Something funny she did", "A moment she was there for me"], time: "2:31 PM"),
    ChatMsg("We hiked Mount Tamalpais last summer. She complained about mosquitoes the whole way up but when we got to the top and saw the fog over the Golden Gate, she went completely quiet. It was beautiful.", isUser: true, time: "2:32 PM"),
    ChatMsg("That image of Sarah going quiet at the summit — that's gold. The contrast between her usual energy and that stillness is so vivid. What's she usually like? Like, how would you describe her personality to someone who's never met her?", isUser: false, quickReplies: ["She's hilarious", "She's the caring one", "She's adventurous"], time: "2:32 PM"),
    ChatMsg("She makes the worst puns you've ever heard but somehow everyone laughs anyway. She's the friend who shows up at 3 AM when you need her. Been my person for 10 years since college.", isUser: true, time: "2:33 PM"),
    ChatMsg("10 years of terrible puns and 3 AM calls — Sarah sounds like a keeper. I've got a really clear picture now. One last thing: if Sarah was standing right in front of you, what would you want to say to her on her birthday?", isUser: false, quickReplies: ["Thank you for everything", "Here's to 30 more years", "I couldn't do life without you"], time: "2:33 PM"),
    ChatMsg("I'd tell her she's the best thing that came out of college, and I genuinely don't know what I'd do without her. Here's to 30 more years of her dragging me up mountains.", isUser: true, time: "2:34 PM"),
    ChatMsg("That's beautiful. I have everything I need to write Sarah an incredible birthday song. The mountain metaphor, the puns, the 3 AM friendship — it's all going in.\n\nReady to pick a style and create it?", isUser: false, time: "2:34 PM"),
]

// MARK: - Option A View

struct OptionALetterView: View {
    @State private var inputText = ""
    @State private var showReady = true

    private let styles = ["Acoustic", "Soul", "Pop", "R&B", "Folk", "Ballad"]
    @State private var selectedStyle: String? = "Acoustic"

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Minimal header
                headerBar

                // Everything scrolls together
                ScrollView {
                    VStack(spacing: 4) {
                        ForEach(Array(mockConversation.enumerated()), id: \.element.id) { index, msg in
                            chatBubble(msg)
                                .frame(maxWidth: .infinity, alignment: msg.isUser ? .trailing : .leading)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 4)
                        }

                        // Story Elements progress
                        StoryElementsCard()
                            .padding(.horizontal, 16)
                            .padding(.top, 16)

                        // Confirmation card
                        confirmationCard
                            .padding(.horizontal, 16)
                            .padding(.top, 12)

                        // Style picker inline
                        if showReady {
                            inlineStylePicker
                                .padding(.horizontal, 16)
                                .padding(.top, 16)
                        }

                        Spacer().frame(height: 16)
                    }
                    .padding(.top, 8)
                }

                // Input bar (always fixed at bottom)
                inputBar
            }
        }
        .toolbar(.hidden, for: .navigationBar)
    }

    // MARK: - Header

    private var headerBar: some View {
        HStack(spacing: 12) {
            // Progress ring
            ZStack {
                Circle()
                    .stroke(DesignTokens.border, lineWidth: 2)
                    .frame(width: 32, height: 32)
                Circle()
                    .trim(from: 0, to: 0.85)
                    .stroke(DesignTokens.gold, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                    .frame(width: 32, height: 32)
                    .rotationEffect(.degrees(-90))
                Image(systemName: "sparkle")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(DesignTokens.gold)
            }

            VStack(alignment: .leading, spacing: 1) {
                Text("Song for Sarah")
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    .foregroundStyle(DesignTokens.textPrimary)
                Text("Birthday  ·  Almost ready")
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundStyle(DesignTokens.gold)
            }

            Spacer()

            Button {} label: {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .frame(width: 32, height: 32)
                    .background(DesignTokens.surface)
                    .clipShape(Circle())
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(DesignTokens.background)
    }

    // MARK: - Inline Style Picker

    private var inlineStylePicker: some View {
        VStack(spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "music.note")
                    .font(.system(size: 12))
                    .foregroundStyle(DesignTokens.gold)
                Text("Pick a style")
                    .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                    .foregroundStyle(DesignTokens.textSecondary)
                Spacer()
            }

            ScrollView(.horizontal) {
                HStack(spacing: 6) {
                    ForEach(styles, id: \.self) { style in
                        let isSelected = selectedStyle == style
                        Button {
                            withAnimation(.easeInOut(duration: 0.15)) {
                                selectedStyle = style
                            }
                        } label: {
                            Text(style)
                                .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                                .padding(.horizontal, 14)
                                .padding(.vertical, 8)
                                .background(isSelected ? DesignTokens.gold : DesignTokens.surface)
                                .foregroundStyle(isSelected ? .black : DesignTokens.textSecondary)
                                .clipShape(Capsule())
                                .overlay(
                                    Capsule().stroke(isSelected ? .clear : DesignTokens.border, lineWidth: 0.5)
                                )
                        }
                    }
                }
            }
            .scrollIndicators(.hidden)

            // Create button
            Button {} label: {
                HStack(spacing: 8) {
                    Image(systemName: "sparkles")
                    Text("Create Sarah's Song")
                }
                .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                .foregroundStyle(.black)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(DesignTokens.gold)
                .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
            }
        }
    }

    // MARK: - Chat Bubble

    private func chatBubble(_ msg: ChatMsg) -> some View {
        VStack(alignment: msg.isUser ? .trailing : .leading, spacing: 4) {
            HStack {
                if msg.isUser { Spacer(minLength: 60) }

                Text(msg.text)
                    .font(DesignTokens.bodyFont(size: 15))
                    .foregroundStyle(msg.isUser ? Color.black : DesignTokens.textPrimary)
                    .lineSpacing(3)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(msg.isUser ? DesignTokens.gold : DesignTokens.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 18))
                    .overlay(
                        RoundedRectangle(cornerRadius: 18)
                            .stroke(msg.isUser ? Color.clear : DesignTokens.border.opacity(0.5), lineWidth: 0.5)
                    )

                if !msg.isUser { Spacer(minLength: 60) }
            }

            if !msg.timestamp.isEmpty {
                Text(msg.timestamp)
                    .font(DesignTokens.bodyFont(size: 10))
                    .foregroundStyle(DesignTokens.textTertiary)
                    .padding(.horizontal, 4)
            }
        }
    }

    // MARK: - Inline Confirmation Card

    private var confirmationCard: some View {
        VStack(spacing: 0) {
            // Divider with label
            HStack(spacing: 10) {
                Rectangle().fill(DesignTokens.gold.opacity(0.25)).frame(height: 0.5)
                Text("STORY COMPLETE")
                    .font(DesignTokens.bodyFont(size: 10, weight: .bold))
                    .foregroundStyle(DesignTokens.gold.opacity(0.7))
                    .tracking(1.5)
                Rectangle().fill(DesignTokens.gold.opacity(0.25)).frame(height: 0.5)
            }
            .padding(.bottom, 16)

            // Story card
            VStack(alignment: .leading, spacing: 14) {
                // Header
                HStack(spacing: 10) {
                    Image(systemName: "checkmark.seal.fill")
                        .font(.system(size: 20))
                        .foregroundStyle(DesignTokens.gold)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Birthday Song for Sarah")
                            .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                            .foregroundStyle(DesignTokens.textPrimary)
                        Text("Ready to create")
                            .font(DesignTokens.bodyFont(size: 12))
                            .foregroundStyle(DesignTokens.success)
                    }
                    Spacer()
                }

                Divider().background(DesignTokens.border.opacity(0.5))

                // Story summary
                Text("A song about a 10-year friendship forged in college — hiking mountains, terrible puns at 3 AM, and the moment Sarah went quiet watching fog roll over the Golden Gate. A birthday tribute to the friend who shows up no matter what.")
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .lineSpacing(4)

                // Extracted elements
                VStack(spacing: 8) {
                    confirmElement(icon: "person.fill", label: "Sarah", detail: "Best friend, 10 years")
                    confirmElement(icon: "gift.fill", label: "30th Birthday", detail: "Milestone celebration")
                    confirmElement(icon: "mountain.2.fill", label: "Mt. Tamalpais", detail: "The summit moment")
                    confirmElement(icon: "quote.opening", label: "Key line", detail: "\"I don't know what I'd do without her\"")
                }

                Divider().background(DesignTokens.border.opacity(0.5))

                // Edit hint
                HStack(spacing: 6) {
                    Image(systemName: "pencil")
                        .font(.system(size: 11))
                    Text("Tap any detail to edit, or keep chatting to add more")
                        .font(DesignTokens.bodyFont(size: 12))
                }
                .foregroundStyle(DesignTokens.textTertiary)
            }
            .padding(16)
            .background(DesignTokens.surface)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .stroke(DesignTokens.gold.opacity(0.2), lineWidth: 0.5)
            )
        }
    }

    private func confirmElement(icon: String, label: String, detail: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 10))
                .foregroundStyle(DesignTokens.gold.opacity(0.7))
                .frame(width: 16)
            Text(label)
                .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                .foregroundStyle(DesignTokens.textPrimary)
            Spacer()
            Text(detail)
                .font(DesignTokens.bodyFont(size: 11))
                .foregroundStyle(DesignTokens.textTertiary)
                .lineLimit(1)
        }
    }



    // MARK: - Input Bar

    private var inputBar: some View {
        storyInputBar(text: $inputText)
    }
}

#endif
