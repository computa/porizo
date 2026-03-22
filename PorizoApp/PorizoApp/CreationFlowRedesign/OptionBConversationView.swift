//
//  OptionBConversationView.swift
//  PorizoApp
//
//  Option B: "Story Builder" — Chat with a live story card that builds as you talk.
//
//  Key idea: The conversation happens on the left/full width, but a collapsible
//  "story card" floats at the top showing what the AI has extracted so far.
//  Each piece of info the user shares lights up a new element on the card.
//  It feels like watching a gift being wrapped in real-time.
//
//  Differences from current:
//  - Story card is ALWAYS visible (collapsed or expanded), not on a separate tab.
//  - The card shows extracted elements: name, occasion, theme, key phrases, mood.
//  - Elements appear with subtle animation as the AI picks them up.
//  - Chat bubbles are minimal — no heavy surface backgrounds.
//  - AI messages use a left-aligned "typewriter" style, no bubble.
//  - User messages are right-aligned gold pills.
//  - Progress is shown as elements filling the story card, not a percentage.
//  - Inline "did I get this right?" confirmation when story is complete.
//

import SwiftUI

#if DEBUG

// MARK: - Story Element

private struct StoryElement: Identifiable {
    let id = UUID()
    let icon: String
    let label: String
    let value: String
    let appearsAfterMessage: Int // which message index triggers this
}

private let storyElements: [StoryElement] = [
    .init(icon: "person.fill", label: "For", value: "Sarah", appearsAfterMessage: 1),
    .init(icon: "gift.fill", label: "Occasion", value: "30th Birthday", appearsAfterMessage: 1),
    .init(icon: "mountain.2.fill", label: "Memory", value: "Hiking Mt. Tamalpais", appearsAfterMessage: 3),
    .init(icon: "cloud.fog.fill", label: "Image", value: "Fog over Golden Gate at sunset", appearsAfterMessage: 3),
    .init(icon: "face.smiling.fill", label: "Personality", value: "Terrible puns, everyone laughs", appearsAfterMessage: 5),
    .init(icon: "heart.fill", label: "Bond", value: "Best friend, 10 years, 3 AM calls", appearsAfterMessage: 5),
    .init(icon: "quote.opening", label: "Key Line", value: "I don't know what I'd do without her", appearsAfterMessage: 7),
    .init(icon: "arrow.up.right", label: "Arc", value: "Gratitude → adventure → forever", appearsAfterMessage: 7),
]

// MARK: - Chat Messages

private struct BMsg: Identifiable {
    let id = UUID()
    let isUser: Bool
    let text: String
    let time: String
}

private let mockChat: [BMsg] = [
    BMsg(isUser: false, text: "Who are we making magic for today? Tell me their name and what we're celebrating.", time: "2:30"),
    BMsg(isUser: true, text: "My best friend Sarah — she's turning 30!", time: "2:31"),
    BMsg(isUser: false, text: "Sarah's 30th! Love it. Paint me a picture — what's a moment with Sarah that you'll never forget?", time: "2:31"),
    BMsg(isUser: true, text: "We hiked Mount Tam last summer. She complained about bugs the whole way up, but at the top, she saw the fog rolling over the Golden Gate and just... stopped talking. First time ever.", time: "2:32"),
    BMsg(isUser: false, text: "The girl who never stops talking went silent at the summit. That's a powerful image. So she's usually the loud one — what's her energy like day to day?", time: "2:32"),
    BMsg(isUser: true, text: "She makes the WORST puns. Like groan-worthy. But everyone still laughs. She's also the one who answers at 3 AM, no questions asked. We've been inseparable since freshman year.", time: "2:33"),
    BMsg(isUser: false, text: "Bad puns and unconditional 3 AM friendship — Sarah sounds irreplaceable. Last one: what would you want her to hear in this song? The thing you maybe don't say enough.", time: "2:33"),
    BMsg(isUser: true, text: "That I genuinely don't know what I'd do without her. And here's to 30 more years of being dragged up mountains I didn't want to climb.", time: "2:34"),
]

// MARK: - Option B View

struct OptionBConversationView: View {
    @State private var isCardExpanded = true
    @State private var selectedCardTab: StoryCardTab = .elements
    @State private var inputText = ""

    enum StoryCardTab: String, CaseIterable {
        case elements = "Story Elements"
        case strength = "Story Strength"
    }
    @State private var selectedStyle: String? = "Soul"

    private let styles = ["Acoustic", "Soul", "Pop", "R&B", "Folk", "Ballad"]

    // How many elements to show (simulate progressive reveal)
    private var visibleElementCount: Int { storyElements.count }

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header
                headerBar

                // Story Elements detail card (icon + label + value)
                storyCard
                    .padding(.horizontal, 16)
                    .padding(.top, 4)
                    .padding(.bottom, 8)

                // Chat
                chatArea

                // Bottom
                bottomBar
            }
        }
        .navigationBarHidden(true)
    }

    // MARK: - Header

    private var headerBar: some View {
        HStack {
            Text("Song for Sarah")
                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                .foregroundStyle(DesignTokens.textPrimary)

            Spacer()

            // Element count badge
            HStack(spacing: 4) {
                Image(systemName: "sparkle")
                    .font(.system(size: 9))
                Text("\(visibleElementCount)/\(storyElements.count)")
                    .font(DesignTokens.bodyFont(size: 12, weight: .semibold))
            }
            .foregroundStyle(DesignTokens.gold)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(DesignTokens.gold.opacity(0.12))
            .clipShape(Capsule())

            Button {} label: {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .frame(width: 30, height: 30)
                    .background(DesignTokens.surface)
                    .clipShape(Circle())
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    // MARK: - Story Card (Tabbed: Elements + Strength)

    private var storyCard: some View {
        VStack(spacing: 0) {
            // Tabbed header
            HStack(spacing: 0) {
                ForEach(StoryCardTab.allCases, id: \.self) { tab in
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            selectedCardTab = tab
                            if !isCardExpanded { isCardExpanded = true }
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: tab == .elements ? "doc.text.fill" : "chart.bar.fill")
                                .font(.system(size: 11))
                            Text(tab.rawValue)
                                .font(DesignTokens.bodyFont(size: 12, weight: .semibold))
                        }
                        .foregroundStyle(selectedCardTab == tab ? DesignTokens.textPrimary : DesignTokens.textTertiary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(selectedCardTab == tab ? DesignTokens.gold.opacity(0.1) : .clear)
                    }
                }

                // Collapse/expand
                Button {
                    withAnimation(.easeInOut(duration: 0.25)) {
                        isCardExpanded.toggle()
                    }
                } label: {
                    Image(systemName: isCardExpanded ? "chevron.up" : "chevron.down")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(DesignTokens.textTertiary)
                        .frame(width: 40)
                        .padding(.vertical, 10)
                }
            }

            if isCardExpanded {
                Divider().background(DesignTokens.border.opacity(0.5))

                if selectedCardTab == .elements {
                    // Key-value element grid
                    VStack(spacing: 0) {
                        ForEach(Array(storyElements.prefix(visibleElementCount).enumerated()), id: \.element.id) { index, element in
                            if index > 0 {
                                Divider()
                                    .background(DesignTokens.border.opacity(0.5))
                                    .padding(.leading, 38)
                            }

                            HStack(spacing: 10) {
                                Image(systemName: element.icon)
                                    .font(.system(size: 11))
                                    .foregroundStyle(DesignTokens.gold)
                                    .frame(width: 20)
                                Text(element.label)
                                    .font(DesignTokens.bodyFont(size: 11))
                                    .foregroundStyle(DesignTokens.textTertiary)
                                    .frame(width: 65, alignment: .leading)
                                Text(element.value)
                                    .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                                    .foregroundStyle(DesignTokens.textPrimary)
                                    .lineLimit(1)
                                Spacer()
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 7)
                        }
                    }
                } else {
                    // Strength progress bars (inline, no extra card chrome)
                    VStack(spacing: 4) {
                        ForEach(mockStoryBeats) { beat in
                            strengthRow(beat)
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                }
            }
        }
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(DesignTokens.gold.opacity(0.15), lineWidth: 0.5)
        )
    }

    private func strengthRow(_ beat: StoryBeat) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Circle()
                    .fill(beat.isActive ? DesignTokens.gold : DesignTokens.success)
                    .frame(width: 7, height: 7)
                Text(beat.label)
                    .font(DesignTokens.bodyFont(size: 13, weight: beat.isActive ? .bold : .regular))
                    .foregroundStyle(beat.isActive ? DesignTokens.textPrimary : DesignTokens.textSecondary)
                Spacer()
                if beat.isComplete {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 16))
                        .foregroundStyle(DesignTokens.success.opacity(0.7))
                }
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 3)
                        .fill((beat.isActive ? DesignTokens.gold : DesignTokens.success).opacity(0.2))
                        .frame(height: 4)
                    RoundedRectangle(cornerRadius: 3)
                        .fill(beat.isActive ? DesignTokens.gold : DesignTokens.success)
                        .frame(width: geo.size.width * beat.progress, height: 4)
                }
            }
            .frame(height: 4)
        }
        .padding(.vertical, 6)
    }

    // MARK: - Chat Area

    private var chatArea: some View {
        ScrollView {
            VStack(spacing: 12) {
                ForEach(mockChat) { msg in
                    chatRow(msg)
                }

                // Inline confirmation
                confirmationSection
                    .padding(.top, 8)
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 180)
        }
    }

    // MARK: - Inline Confirmation

    private var confirmationSection: some View {
        VStack(spacing: 14) {
            // Divider
            HStack(spacing: 10) {
                Rectangle().fill(DesignTokens.gold.opacity(0.25)).frame(height: 0.5)
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(DesignTokens.gold)
                Text("READY")
                    .font(DesignTokens.bodyFont(size: 10, weight: .bold))
                    .foregroundStyle(DesignTokens.gold.opacity(0.7))
                    .tracking(1.5)
                Rectangle().fill(DesignTokens.gold.opacity(0.25)).frame(height: 0.5)
            }

            // Narrative summary
            VStack(alignment: .leading, spacing: 12) {
                Text("Sarah's Story")
                    .font(DesignTokens.bodyFont(size: 14, weight: .semibold))
                    .foregroundStyle(DesignTokens.gold)

                Text("A song about a 10-year friendship forged in college — hiking mountains, terrible puns at 3 AM, and the moment Sarah went quiet watching fog roll over the Golden Gate. A birthday tribute to the friend who shows up no matter what.")
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .lineSpacing(4)

                // Mood / tone
                HStack(spacing: 12) {
                    moodPill(icon: "heart.fill", text: "Warm")
                    moodPill(icon: "face.smiling.fill", text: "Playful")
                    moodPill(icon: "mountain.2.fill", text: "Adventurous")
                }

                Divider().background(DesignTokens.border.opacity(0.5))

                HStack(spacing: 6) {
                    Image(systemName: "pencil")
                        .font(.system(size: 11))
                    Text("Keep chatting to refine, or create now")
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

            // Story strength progress bars
            StoryElementsCard()
                .padding(.top, 4)
        }
    }

    private func moodPill(icon: String, text: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .font(.system(size: 9))
            Text(text)
                .font(DesignTokens.bodyFont(size: 11, weight: .medium))
        }
        .foregroundStyle(DesignTokens.gold)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(DesignTokens.gold.opacity(0.1))
        .clipShape(Capsule())
    }

    private func chatRow(_ msg: BMsg) -> some View {
        VStack(alignment: msg.isUser ? .trailing : .leading, spacing: 4) {
            if msg.isUser {
                // User: gold pill, right-aligned
                HStack {
                    Spacer(minLength: 70)
                    Text(msg.text)
                        .font(DesignTokens.bodyFont(size: 15))
                        .foregroundStyle(.black)
                        .lineSpacing(2)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(DesignTokens.gold)
                        .clipShape(RoundedRectangle(cornerRadius: 18))
                }
            } else {
                // AI: no bubble, just text with subtle left accent
                HStack(alignment: .top, spacing: 10) {
                    Rectangle()
                        .fill(DesignTokens.gold.opacity(0.3))
                        .frame(width: 2)
                        .clipShape(Capsule())

                    Text(msg.text)
                        .font(DesignTokens.bodyFont(size: 15))
                        .foregroundStyle(DesignTokens.textPrimary)
                        .lineSpacing(3)
                }
                .padding(.trailing, 50)
            }

            Text(msg.time)
                .font(DesignTokens.bodyFont(size: 10))
                .foregroundStyle(DesignTokens.textTertiary)
                .padding(.horizontal, 4)
        }
        .frame(maxWidth: .infinity, alignment: msg.isUser ? .trailing : .leading)
    }

    // MARK: - Bottom Bar

    private var bottomBar: some View {
        VStack(spacing: 8) {
            // Collapsible style picker
            CollapsibleStylePicker(selectedStyle: $selectedStyle)
                .padding(.horizontal, 16)

            // Input
            storyInputBar(text: $inputText)
        }
        .background(DesignTokens.background)
    }
}

#endif
