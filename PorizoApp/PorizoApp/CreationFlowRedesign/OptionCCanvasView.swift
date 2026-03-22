//
//  OptionCCanvasView.swift
//  PorizoApp
//
//  Option C: "The Timeline" — Chat as a vertical journey with milestone markers.
//
//  Key idea: Instead of generic chat bubbles, the conversation is presented as
//  a vertical timeline. Each "beat" of the story (who, what, memory, personality,
//  message) is a milestone on the journey. AI questions are section headers.
//  User responses are cards under each section. It turns a chat into a visual
//  narrative structure.
//
//  Differences from current:
//  - No chat/story tab split — the chat IS the story.
//  - AI messages are section headers with icons, not bubbles.
//  - User responses are cards with subtle gold accents.
//  - A vertical gold line connects all sections (timeline metaphor).
//  - Each section has a completion dot (empty → filled as user responds).
//  - Bottom shows a "song recipe" summary that builds up.
//  - Much more visual structure than traditional chat.
//  - Feels like building something, not just answering questions.
//

import SwiftUI

#if DEBUG

// MARK: - Timeline Beat

private struct TimelineBeat: Identifiable {
    let id = UUID()
    let icon: String
    let sectionTitle: String
    let aiPrompt: String
    let userResponse: String?
    let extractedLabel: String?
}

private let timelineBeats: [TimelineBeat] = [
    TimelineBeat(
        icon: "person.fill",
        sectionTitle: "Who's it for?",
        aiPrompt: "Tell me their name and what we're celebrating.",
        userResponse: "My best friend Sarah — she's turning 30!",
        extractedLabel: "Sarah · 30th Birthday"
    ),
    TimelineBeat(
        icon: "photo.on.rectangle.angled",
        sectionTitle: "A moment you'll never forget",
        aiPrompt: "Paint me a picture. What's a memory with Sarah that still gives you chills?",
        userResponse: "We hiked Mount Tam last summer. She complained the whole way up about bugs, but at the summit she saw the fog over the Golden Gate and went completely silent. First time ever.",
        extractedLabel: "Mt. Tam summit · fog over Golden Gate"
    ),
    TimelineBeat(
        icon: "theatermasks.fill",
        sectionTitle: "Who is she, really?",
        aiPrompt: "What's Sarah's energy? The thing everyone notices about her.",
        userResponse: "She makes the WORST puns — like truly terrible — but somehow everyone laughs anyway. She's the friend who picks up at 3 AM, no questions. We've been ride or die since freshman year of college.",
        extractedLabel: "Terrible puns · 3 AM friend · 10 years"
    ),
    TimelineBeat(
        icon: "heart.text.square.fill",
        sectionTitle: "What would you say to her face?",
        aiPrompt: "If Sarah was right here, what would you tell her? The thing you maybe don't say often enough.",
        userResponse: "I'd tell her she's the best thing that came out of college. I genuinely don't know what I'd do without her. Here's to 30 more years of being dragged up mountains.",
        extractedLabel: "\"I don't know what I'd do without her\""
    ),
    TimelineBeat(
        icon: "wand.and.stars",
        sectionTitle: "The finishing touch",
        aiPrompt: "Pick the vibe for Sarah's song.",
        userResponse: nil,
        extractedLabel: nil
    ),
]

// MARK: - Option C View

struct OptionCCanvasView: View {
    @State private var inputText = ""
    @State private var selectedStyle: String? = "Acoustic"
    private let styles = ["Acoustic", "Soul", "Pop", "R&B", "Folk", "Ballad"]

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header
                headerBar

                // Timeline scroll
                timelineScroll

                // Bottom
                bottomSection
            }
        }
        .navigationBarHidden(true)
    }

    // MARK: - Header

    private var headerBar: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("Sarah's Song")
                    .font(DesignTokens.displayFont(size: 20))
                    .foregroundStyle(DesignTokens.textPrimary)
                Text("30th Birthday")
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundStyle(DesignTokens.gold)
            }

            Spacer()

            // Progress dots
            HStack(spacing: 6) {
                ForEach(0..<timelineBeats.count, id: \.self) { i in
                    Circle()
                        .fill(i < 4 ? DesignTokens.gold : DesignTokens.border)
                        .frame(width: 8, height: 8)
                }
            }

            Spacer().frame(width: 16)

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
        .padding(.vertical, 12)
    }

    // MARK: - Timeline

    private var timelineScroll: some View {
        ScrollView {
            VStack(spacing: 0) {
                ForEach(Array(timelineBeats.enumerated()), id: \.element.id) { index, beat in
                    timelineBeatView(beat: beat, index: index, isLast: index == timelineBeats.count - 1)
                }

                // Story Elements progress
                StoryElementsCard()
                    .padding(.horizontal, 26)
                    .padding(.top, 8)

                // Inline confirmation at the end of the timeline
                timelineConfirmation
                    .padding(.top, 4)

                Spacer().frame(height: 180)
            }
            .padding(.leading, 16)
            .padding(.trailing, 16)
            .padding(.top, 8)
        }
    }

    // MARK: - Timeline Confirmation

    private var timelineConfirmation: some View {
        HStack(alignment: .top, spacing: 14) {
            // Final dot on spine
            VStack(spacing: 0) {
                ZStack {
                    Circle()
                        .fill(DesignTokens.gold)
                        .frame(width: 28, height: 28)
                    Image(systemName: "checkmark.seal.fill")
                        .font(.system(size: 13))
                        .foregroundStyle(.black)
                }
            }
            .frame(width: 28)

            // Confirmation content
            VStack(alignment: .leading, spacing: 12) {
                Text("Your Song Recipe")
                    .font(DesignTokens.bodyFont(size: 14, weight: .bold))
                    .foregroundStyle(DesignTokens.gold)

                VStack(alignment: .leading, spacing: 10) {
                    Text("A song about a 10-year friendship forged in college — hiking mountains, terrible puns at 3 AM, and the moment Sarah went quiet watching fog roll over the Golden Gate.")
                        .font(DesignTokens.bodyFont(size: 13))
                        .foregroundStyle(DesignTokens.textPrimary)
                        .lineSpacing(3)

                    // Ingredient pills
                    FlowLayoutC(spacing: 6) {
                        ingredientPill("Sarah")
                        ingredientPill("30th Birthday")
                        ingredientPill("Mt. Tamalpais")
                        ingredientPill("Terrible puns")
                        ingredientPill("3 AM friendship")
                        ingredientPill("10 years")
                    }

                    Divider().background(DesignTokens.border.opacity(0.5))

                    // Tone
                    HStack(spacing: 4) {
                        Image(systemName: "waveform")
                            .font(.system(size: 10))
                            .foregroundStyle(DesignTokens.gold)
                        Text("Tone:")
                            .font(DesignTokens.bodyFont(size: 12))
                            .foregroundStyle(DesignTokens.textTertiary)
                        Text("Warm, playful, grateful")
                            .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                            .foregroundStyle(DesignTokens.textSecondary)
                    }

                    HStack(spacing: 6) {
                        Image(systemName: "pencil")
                            .font(.system(size: 10))
                        Text("Add more to the story or create now")
                            .font(DesignTokens.bodyFont(size: 11))
                    }
                    .foregroundStyle(DesignTokens.textTertiary)
                }
                .padding(14)
                .background(DesignTokens.surface)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(DesignTokens.gold.opacity(0.2), lineWidth: 0.5)
                )
            }
            .padding(.bottom, 24)
        }
    }

    private func ingredientPill(_ text: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: "sparkle")
                .font(.system(size: 7))
            Text(text)
                .font(DesignTokens.bodyFont(size: 11, weight: .medium))
        }
        .foregroundStyle(DesignTokens.gold)
        .padding(.horizontal, 9)
        .padding(.vertical, 4)
        .background(DesignTokens.gold.opacity(0.1))
        .clipShape(Capsule())
    }

    private func timelineBeatView(beat: TimelineBeat, index: Int, isLast: Bool) -> some View {
        HStack(alignment: .top, spacing: 14) {
            // Timeline spine
            VStack(spacing: 0) {
                // Dot
                ZStack {
                    Circle()
                        .fill(beat.userResponse != nil ? DesignTokens.gold : DesignTokens.surface)
                        .frame(width: 28, height: 28)
                    if beat.userResponse != nil {
                        Image(systemName: "checkmark")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(.black)
                    } else {
                        Image(systemName: beat.icon)
                            .font(.system(size: 11))
                            .foregroundStyle(DesignTokens.textTertiary)
                    }
                }

                // Line
                if !isLast {
                    Rectangle()
                        .fill(
                            beat.userResponse != nil
                                ? DesignTokens.gold.opacity(0.3)
                                : DesignTokens.border.opacity(0.3)
                        )
                        .frame(width: 2)
                        .frame(maxHeight: .infinity)
                }
            }
            .frame(width: 28)

            // Content
            VStack(alignment: .leading, spacing: 8) {
                // Section header
                Text(beat.sectionTitle)
                    .font(DesignTokens.bodyFont(size: 14, weight: .bold))
                    .foregroundStyle(beat.userResponse != nil ? DesignTokens.gold : DesignTokens.textSecondary)

                // AI prompt
                Text(beat.aiPrompt)
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .lineSpacing(2)

                // User response card
                if let response = beat.userResponse {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(response)
                            .font(DesignTokens.bodyFont(size: 14))
                            .foregroundStyle(DesignTokens.textPrimary)
                            .lineSpacing(3)

                        if let label = beat.extractedLabel {
                            HStack(spacing: 6) {
                                Image(systemName: "sparkle")
                                    .font(.system(size: 8))
                                Text(label)
                                    .font(DesignTokens.bodyFont(size: 11, weight: .medium))
                            }
                            .foregroundStyle(DesignTokens.gold)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(DesignTokens.gold.opacity(0.1))
                            .clipShape(Capsule())
                        }
                    }
                    .padding(14)
                    .background(DesignTokens.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(DesignTokens.gold.opacity(0.12), lineWidth: 0.5)
                    )
                } else if isLast {
                    // Style picker for the last beat
                    stylePicker
                }
            }
            .padding(.bottom, 24)
        }
    }

    // MARK: - Style Picker (inline)

    private var stylePicker: some View {
        VStack(alignment: .leading, spacing: 10) {
            LazyVGrid(columns: [
                GridItem(.flexible()),
                GridItem(.flexible()),
                GridItem(.flexible()),
            ], spacing: 8) {
                ForEach(styles, id: \.self) { style in
                    let sel = selectedStyle == style
                    Button {
                        withAnimation(.easeInOut(duration: 0.15)) { selectedStyle = style }
                    } label: {
                        VStack(spacing: 6) {
                            Image(systemName: styleIcon(style))
                                .font(.system(size: 18))
                                .foregroundStyle(sel ? .black : DesignTokens.gold)
                            Text(style)
                                .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                                .foregroundStyle(sel ? .black : DesignTokens.textPrimary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(sel ? DesignTokens.gold : DesignTokens.surface)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .overlay(
                            RoundedRectangle(cornerRadius: 10)
                                .stroke(sel ? .clear : DesignTokens.border, lineWidth: 0.5)
                        )
                    }
                }
            }
        }
        .padding(14)
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(DesignTokens.border.opacity(0.5), lineWidth: 0.5)
        )
    }

    private func styleIcon(_ style: String) -> String {
        switch style {
        case "Acoustic": return "guitars.fill"
        case "Soul": return "heart.fill"
        case "Pop": return "star.fill"
        case "R&B": return "waveform"
        case "Folk": return "leaf.fill"
        case "Ballad": return "moon.fill"
        default: return "music.note"
        }
    }

    // MARK: - Bottom

    private var bottomSection: some View {
        VStack(spacing: 8) {
            // Create button
            Button {} label: {
                HStack(spacing: 6) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 13))
                    Text("Create")
                        .font(DesignTokens.bodyFont(size: 14, weight: .semibold))
                }
                .foregroundStyle(.black)
                .padding(.horizontal, 20)
                .padding(.vertical, 10)
                .background(DesignTokens.gold)
                .clipShape(Capsule())
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
            .padding(.horizontal, 16)

            // Input
            storyInputBar(text: $inputText)
        }
        .background(DesignTokens.background)
    }
}

// MARK: - Flow Layout for ingredient pills

private struct FlowLayoutC: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = arrange(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(proposal: proposal, subviews: subviews)
        for (index, position) in result.positions.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y), proposal: .unspecified)
        }
    }

    private func arrange(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, positions: [CGPoint]) {
        let maxWidth = proposal.width ?? .infinity
        var positions: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth && x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            positions.append(CGPoint(x: x, y: y))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
        }

        return (CGSize(width: maxWidth, height: y + rowHeight), positions)
    }
}

#endif
