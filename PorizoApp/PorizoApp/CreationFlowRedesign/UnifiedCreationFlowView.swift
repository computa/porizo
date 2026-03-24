//
//  UnifiedCreationFlowView.swift
//  PorizoApp
//
//  Unified Creation Flow: Option B (Story Builder) + Option 1 (All-in-Chat).
//
//  The entire song/poem creation journey in ONE continuous thread:
//  0.  Name entry: "Who is this for?" prompt
//  0a. Pre-session: Type selection chips (Song / Poem)
//  0b. Pre-session: Song options card (Continue / Own lyrics / Instrumental)
//  1.  Chat conversation with AI (Story Builder style)
//  2.  Story Elements card (tabbed: details + strength)
//  3.  Inline confirmation with narrative summary
//  4.  Lyrics generated as inline card
//  5.  User edits via chat (quick replies + revisions)
//  6.  Rendering progress (inline sheet-style card)
//  7.  Song player (inline sheet-style card)
//
//  Zero context switches. Zero separate screens.
//

import SwiftUI

#if DEBUG

// MARK: - Unified View

struct UnifiedCreationFlowView: View {
    @State private var inputText = ""
    @State private var isCardExpanded = true
    @State private var selectedCardTab: UnifiedCardTab = .elements
    @State private var selectedStyle: String? = "acoustic"
    @State private var preSessionPhase: PreSessionPhase = .nameEntry
    @State private var nameInput: String = ""

    enum UnifiedCardTab: String, CaseIterable {
        case elements = "Story Elements"
        case strength = "Story Strength"
    }

    enum PreSessionPhase {
        case nameEntry         // "Who is this for?" name prompt
        case typeSelection     // Showing type chips
        case songOptions       // Song selected, showing options
        case activeSession     // Real session started
    }

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                if preSessionPhase == .nameEntry {
                    // === NAME ENTRY: "Who is this for?" ===
                    nameEntryScreen
                } else {
                    // Header adapts to pre-session vs active session
                    if preSessionPhase == .activeSession {
                        headerBar
                    } else {
                        preSessionHeader
                    }

                    // Tabbed story card (only in active session)
                    if preSessionPhase == .activeSession {
                        storyCard
                            .padding(.horizontal, 16)
                            .padding(.top, 4)
                            .padding(.bottom, 8)
                    }

                    // Full flow in one scroll
                    ScrollView {
                        VStack(spacing: 12) {
                            // === PRE-SESSION: Type selection ===
                            if preSessionPhase == .typeSelection {
                                preSessionTypeSelection
                            }

                        // === PRE-SESSION: Song options ===
                        if preSessionPhase == .songOptions {
                            preSessionSongOptions
                        }

                        // === PHASE 1: Chat ===
                        if preSessionPhase == .activeSession {
                            ForEach(chatMessages) { msg in
                                chatRow(msg)
                            }
                        }

                        // === PHASE 2: Confirmation ===
                        if preSessionPhase == .activeSession {
                            confirmationSection

                            // === PHASE 3: Lyrics ===
                            lyricsCard

                            // Quick replies
                            quickReplies

                            // User revision
                            chatBubble("Can you make the chorus more emotional? Mention the fog on the Golden Gate", isUser: true)

                            // AI revised chorus
                            chatBubble("Here's the updated chorus with the Golden Gate imagery:", isUser: false)
                            revisedChorusCard

                            // User approves
                            chatBubble("Love it! Let's go with this", isUser: true)

                            // === PHASE 4: Rendering ===
                            renderingCard

                            // === PHASE 5: Player ===
                            playerCard
                        }

                        Spacer().frame(height: 16)
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                }

                // Collapsible style picker + input (only in active session)
                if preSessionPhase == .activeSession {
                    VStack(spacing: 8) {
                        CollapsibleStylePicker(selectedStyle: $selectedStyle, styleStore: StyleStore())
                            .padding(.horizontal, 16)
                        storyInputBar(text: $inputText)
                    }
                    .background(DesignTokens.background)
                }
                } // end else (non-nameEntry phases)
            }
        }
        .goldBorderOverlay()
        .navigationBarHidden(true)
    }

    // MARK: - Name Entry Screen

    private var nameEntryScreen: some View {
        VStack(spacing: 20) {
            Spacer()

            Image(systemName: "sparkles")
                .font(.system(size: 40))
                .foregroundStyle(DesignTokens.gold)

            Text("Who is this for?")
                .font(DesignTokens.displayFont(size: 24))
                .foregroundStyle(DesignTokens.textPrimary)
                .multilineTextAlignment(.center)

            Text("Enter their name to get started")
                .font(DesignTokens.bodyFont(size: 14))
                .foregroundStyle(DesignTokens.textSecondary)

            TextField("Their name...", text: $nameInput)
                .font(DesignTokens.bodyFont(size: 16))
                .foregroundStyle(DesignTokens.textPrimary)
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .background(DesignTokens.surface)
                .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
                .overlay(
                    RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                        .stroke(DesignTokens.border, lineWidth: 0.5)
                )
                .padding(.horizontal, 32)

            Button {
                withAnimation(.easeInOut(duration: 0.25)) {
                    preSessionPhase = .typeSelection
                }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "arrow.right")
                    Text("Start")
                }
                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                .foregroundStyle(.black)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(DesignTokens.gold)
                .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
            }
            .disabled(nameInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .opacity(nameInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.5 : 1.0)
            .padding(.horizontal, 32)

            Spacer()
        }
    }

    // MARK: - Pre-Session Header

    private var preSessionHeader: some View {
        HStack {
            Text(preSessionPhase == .songOptions ? "Song for Sarah" : "Create for Sarah")
                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                .foregroundStyle(DesignTokens.textPrimary)

            Spacer()

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

    // MARK: - Pre-Session: Type Selection

    private var preSessionTypeSelection: some View {
        VStack(alignment: .leading, spacing: 10) {
            // AI prompt bubble
            HStack(alignment: .top, spacing: 10) {
                Rectangle()
                    .fill(DesignTokens.gold.opacity(0.3))
                    .frame(width: 2)
                    .clipShape(Capsule())
                Text("What is the story about Sarah that you want to turn into a song or poem?")
                    .font(DesignTokens.bodyFont(size: 15))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .lineSpacing(3)
            }

            // Type selection chips
            HStack(spacing: 8) {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        preSessionPhase = .songOptions
                    }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "music.note")
                            .font(.system(size: 12))
                        Text("A Song")
                            .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(DesignTokens.surface)
                    .foregroundStyle(DesignTokens.textSecondary)
                    .clipShape(Capsule())
                    .overlay(Capsule().stroke(DesignTokens.border, lineWidth: 0.5))
                }

                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        preSessionPhase = .activeSession
                    }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "text.quote")
                            .font(.system(size: 12))
                        Text("A Poem")
                            .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(DesignTokens.surface)
                    .foregroundStyle(DesignTokens.textSecondary)
                    .clipShape(Capsule())
                    .overlay(Capsule().stroke(DesignTokens.border, lineWidth: 0.5))
                }
            }
        }
    }

    // MARK: - Pre-Session: Song Options

    private var preSessionSongOptions: some View {
        VStack(alignment: .leading, spacing: 10) {
            // System prompt
            HStack(spacing: 0) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(DesignTokens.gold)
                    .frame(width: 3)

                Text("How would you like to create your song?")
                    .font(DesignTokens.bodyFont(size: 15))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .lineSpacing(3)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
            }
            .background(DesignTokens.surface)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .stroke(DesignTokens.border.opacity(0.5), lineWidth: 0.5)
            )

            // Option buttons
            VStack(spacing: 6) {
                songOptionButton(icon: "sparkles", label: "Continue", subtitle: "AI writes the lyrics") {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        preSessionPhase = .activeSession
                    }
                }
                songOptionButton(icon: "text.quote", label: "I'll write my own lyrics", subtitle: nil) {}
                songOptionButton(icon: "waveform", label: "Instrumental", subtitle: "No vocals") {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        preSessionPhase = .activeSession
                    }
                }
            }
        }
    }

    private func songOptionButton(icon: String, label: String, subtitle: String?, action: @escaping () -> Void) -> some View {
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

    // MARK: - Header

    private var headerBar: some View {
        HStack {
            Text("Song for Sarah")
                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                .foregroundStyle(DesignTokens.textPrimary)

            Spacer()

            HStack(spacing: 4) {
                Image(systemName: "sparkle")
                    .font(.system(size: 9))
                Text("8/8")
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

    // MARK: - Tabbed Story Card

    private var storyCard: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                ForEach(UnifiedCardTab.allCases, id: \.self) { tab in
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

                Button {
                    withAnimation(.easeInOut(duration: 0.25)) { isCardExpanded.toggle() }
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
                    elementsContent
                } else {
                    strengthContent
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

    private struct ElementItem: Identifiable {
        let id = UUID()
        let icon: String
        let label: String
        let value: String
    }

    private var elementItems: [ElementItem] {
        [
            ElementItem(icon: "person.fill", label: "For", value: "Sarah"),
            ElementItem(icon: "gift.fill", label: "Occasion", value: "30th Birthday"),
            ElementItem(icon: "mountain.2.fill", label: "Memory", value: "Hiking Mt. Tamalpais"),
            ElementItem(icon: "cloud.fog.fill", label: "Image", value: "Fog over Golden Gate at sunset"),
            ElementItem(icon: "face.smiling.fill", label: "Personality", value: "Terrible puns, everyone laughs"),
            ElementItem(icon: "heart.fill", label: "Bond", value: "Best friend, 10 years, 3 AM calls"),
            ElementItem(icon: "quote.opening", label: "Key Line", value: "I don't know what I'd do without her"),
            ElementItem(icon: "arrow.up.right", label: "Arc", value: "Gratitude → adventure → forever"),
        ]
    }

    private var elementsContent: some View {
        VStack(spacing: 0) {
            ForEach(Array(elementItems.enumerated()), id: \.element.id) { index, element in
                if index > 0 {
                    Divider().background(DesignTokens.border.opacity(0.5)).padding(.leading, 38)
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
    }

    private var strengthContent: some View {
        VStack(spacing: 4) {
            ForEach(mockStoryBeats) { beat in
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
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
    }

    // MARK: - Chat Message Model

    private struct ChatMessage: Identifiable {
        let id = UUID()
        let isUser: Bool
        let text: String
        let time: String
    }

    private var chatMessages: [ChatMessage] {
        [
            ChatMessage(isUser: false, text: "Who are we making magic for today? Tell me their name and what we're celebrating.", time: "2:30"),
            ChatMessage(isUser: true, text: "My best friend Sarah — she's turning 30!", time: "2:31"),
            ChatMessage(isUser: false, text: "Sarah's 30th! Love it. Paint me a picture — what's a moment with Sarah that you'll never forget?", time: "2:31"),
            ChatMessage(isUser: true, text: "We hiked Mount Tam last summer. She complained about bugs the whole way up, but at the top, she saw the fog rolling over the Golden Gate and just... stopped talking. First time ever.", time: "2:32"),
            ChatMessage(isUser: false, text: "The girl who never stops talking went silent at the summit. That's a powerful image. So she's usually the loud one — what's her energy like day to day?", time: "2:32"),
            ChatMessage(isUser: true, text: "She makes the WORST puns. Like groan-worthy. But everyone still laughs. She's also the one who answers at 3 AM, no questions asked. We've been inseparable since freshman year.", time: "2:33"),
            ChatMessage(isUser: false, text: "Bad puns and unconditional 3 AM friendship — Sarah sounds irreplaceable. Last one: what would you want her to hear in this song? The thing you maybe don't say enough.", time: "2:33"),
            ChatMessage(isUser: true, text: "That I genuinely don't know what I'd do without her. And here's to 30 more years of being dragged up mountains I didn't want to climb.", time: "2:34"),
        ]
    }

    private func chatRow(_ msg: ChatMessage) -> some View {
        VStack(alignment: msg.isUser ? .trailing : .leading, spacing: 4) {
            chatBubble(msg.text, isUser: msg.isUser)
            Text(msg.time)
                .font(DesignTokens.bodyFont(size: 10))
                .foregroundStyle(DesignTokens.textTertiary)
                .padding(.horizontal, 4)
        }
        .frame(maxWidth: .infinity, alignment: msg.isUser ? .trailing : .leading)
    }

    private func chatBubble(_ text: String, isUser: Bool) -> some View {
        HStack {
            if isUser { Spacer(minLength: 60) }

            if isUser {
                Text(text).userBubbleStyle()
            } else {
                Text(text).aiBubbleStyle()
            }

            if !isUser { Spacer(minLength: 50) }
        }
    }

    // MARK: - Confirmation

    private var confirmationSection: some View {
        VStack(spacing: 14) {
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

            VStack(alignment: .leading, spacing: 12) {
                Text("Sarah's Story")
                    .font(DesignTokens.bodyFont(size: 14, weight: .semibold))
                    .foregroundStyle(DesignTokens.gold)

                Text("A song about a 10-year friendship forged in college — hiking mountains, terrible puns at 3 AM, and the moment Sarah went quiet watching fog roll over the Golden Gate. A birthday tribute to the friend who shows up no matter what.")
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .lineSpacing(4)

                HStack(spacing: 12) {
                    moodPill(icon: "heart.fill", text: "Warm")
                    moodPill(icon: "face.smiling.fill", text: "Playful")
                    moodPill(icon: "mountain.2.fill", text: "Adventurous")
                }
            }
            .padding(16)
            .background(DesignTokens.surface)
            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
            .overlay(
                RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                    .stroke(DesignTokens.gold.opacity(0.15), lineWidth: 0.5)
            )
        }
        .padding(.top, 8)
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

    // MARK: - Lyrics Card

    private var lyricsCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Image(systemName: "music.note.list")
                    .font(.system(size: 14))
                    .foregroundStyle(DesignTokens.gold)
                Text("Generated Lyrics")
                    .font(DesignTokens.bodyFont(size: 14, weight: .semibold))
                    .foregroundStyle(DesignTokens.gold)
                Spacer()
                Text("Acoustic")
                    .font(DesignTokens.bodyFont(size: 11))
                    .foregroundStyle(DesignTokens.textTertiary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(DesignTokens.border.opacity(0.5))
                    .clipShape(Capsule())
            }

            ForEach(mockLyrics) { section in
                VStack(alignment: .leading, spacing: 4) {
                    Text(section.type.rawValue.uppercased())
                        .font(DesignTokens.bodyFont(size: 10, weight: .bold))
                        .foregroundStyle(DesignTokens.textTertiary)
                        .tracking(1)
                    ForEach(section.lines, id: \.self) { line in
                        Text(line)
                            .font(DesignTokens.bodyFont(size: 14))
                            .foregroundStyle(DesignTokens.textPrimary)
                            .lineSpacing(2)
                    }
                }
            }
        }
        .padding(16)
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
        .overlay(
            RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                .stroke(DesignTokens.gold.opacity(0.15), lineWidth: 0.5)
        )
        .padding(.top, 8)
    }

    // MARK: - Quick Replies

    private var quickReplies: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                quickChip("Love it ✓", primary: true)
                quickChip("Change the chorus")
                quickChip("Make it funnier")
                quickChip("Edit a line")
            }
        }
    }

    private func quickChip(_ text: String, primary: Bool = false) -> some View {
        Text(text)
            .font(DesignTokens.bodyFont(size: 13, weight: .medium))
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(primary ? DesignTokens.gold.opacity(0.15) : DesignTokens.surface)
            .foregroundStyle(primary ? DesignTokens.gold : DesignTokens.textSecondary)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(primary ? DesignTokens.gold.opacity(0.3) : DesignTokens.border, lineWidth: 0.5))
    }

    // MARK: - Revised Chorus

    private var revisedChorusCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "arrow.triangle.2.circlepath")
                    .font(.system(size: 11))
                    .foregroundStyle(DesignTokens.gold)
                Text("CHORUS — REVISED")
                    .font(DesignTokens.bodyFont(size: 10, weight: .bold))
                    .foregroundStyle(DesignTokens.gold)
                    .tracking(1)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text("Here's to you, here's to thirty more")
                Text("Of fog on the Golden Gate we'll explore")
                Text("You're the one who picks up at 3 AM")
                Text("Sarah, I'd climb every mountain again")
            }
            .font(DesignTokens.bodyFont(size: 14))
            .foregroundStyle(DesignTokens.textPrimary)
        }
        .padding(14)
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(DesignTokens.gold.opacity(0.2), lineWidth: 0.5))
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.trailing, 50)
    }

    // MARK: - Rendering

    private var renderingCard: some View {
        VStack(spacing: 0) {
            RoundedRectangle(cornerRadius: 2)
                .fill(DesignTokens.textTertiary)
                .frame(width: 36, height: 4)
                .padding(.top, 12)
                .padding(.bottom, 20)

            HStack(spacing: 3) {
                let heights: [CGFloat] = [12, 24, 8, 30, 16, 28, 10, 32, 14, 26, 18, 22, 8, 30, 12, 28, 20, 14, 24, 10]
                ForEach(0..<20, id: \.self) { i in
                    RoundedRectangle(cornerRadius: 2)
                        .fill(DesignTokens.gold.opacity(i % 3 == 0 ? 0.8 : 0.3))
                        .frame(width: 4, height: heights[i])
                }
            }
            .frame(height: 36)
            .padding(.bottom, 20)

            RenderingProgressCard(progress: 0.62, statusText: "Composing acoustic arrangement...")
                .padding(.horizontal, 16)
                .padding(.bottom, 20)

            VStack(alignment: .leading, spacing: 14) {
                renderStep("Lyrics finalized", done: true)
                renderStep("Melody composed", done: true)
                renderStep("Acoustic arrangement", done: false, active: true)
                renderStep("Vocal synthesis", done: false)
                renderStep("Final mix & master", done: false)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 24)
        }
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).stroke(DesignTokens.border, lineWidth: 0.5))
        .padding(.top, 8)
    }

    private func renderStep(_ text: String, done: Bool, active: Bool = false) -> some View {
        HStack(spacing: 10) {
            Image(systemName: done ? "checkmark.circle.fill" : (active ? "circle.dotted" : "circle"))
                .font(.system(size: 18))
                .foregroundStyle(done ? DesignTokens.success : (active ? DesignTokens.gold : DesignTokens.textTertiary))
            Text(text)
                .font(DesignTokens.bodyFont(size: 15, weight: active ? .bold : .regular))
                .foregroundStyle(done ? DesignTokens.textSecondary : (active ? DesignTokens.textPrimary : DesignTokens.textTertiary))
        }
    }

    // MARK: - Player

    private var playerCard: some View {
        VStack(spacing: 0) {
            RoundedRectangle(cornerRadius: 2)
                .fill(DesignTokens.textTertiary)
                .frame(width: 36, height: 4)
                .padding(.top, 12)
                .padding(.bottom, 16)

            HStack(spacing: 8) {
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 18))
                    .foregroundStyle(DesignTokens.success)
                Text("Song Created!")
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    .foregroundStyle(DesignTokens.textPrimary)
            }
            .padding(.bottom, 16)

            SongPlayerCard()
                .padding(.horizontal, 16)

            Button {} label: {
                HStack(spacing: 6) {
                    Image(systemName: "music.note.list")
                        .font(.system(size: 12))
                    Text("View Lyrics")
                }
                .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                .foregroundStyle(DesignTokens.textSecondary)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(DesignTokens.surface)
                .clipShape(Capsule())
                .overlay(Capsule().stroke(DesignTokens.border, lineWidth: 0.5))
            }
            .padding(.top, 12)
            .padding(.bottom, 16)
        }
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).stroke(DesignTokens.border, lineWidth: 0.5))
        .padding(.top, 8)
    }
}

#endif
