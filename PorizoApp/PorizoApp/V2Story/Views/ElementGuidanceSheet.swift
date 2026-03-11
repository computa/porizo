//
//  ElementGuidanceSheet.swift
//  PorizoApp
//
//  Popup sheet for improving a single story element.
//  Shows the exact text being improved, LLM-generated guidance,
//  tappable example chips, and a focused text input.
//

import SwiftUI

struct ElementGuidanceSheet: View {
    var engine: V2StoryEngine
    let beat: V2Beat

    @Environment(\.dismiss) private var dismiss
    @State private var guidance: ElementGuidance?
    @State private var isLoading = true
    @State private var refinementText = ""
    @State private var isSubmitting = false

    private var elementNoun: String {
        let name = beat.displayName
        if name.lowercased().hasPrefix("the ") {
            return String(name.dropFirst(4)).lowercased()
        }
        if name.lowercased().hasPrefix("your ") {
            return String(name.dropFirst(5)).lowercased()
        }
        return name.lowercased()
    }

    var body: some View {
        VStack(spacing: 0) {
            // Scrollable guidance content
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    sheetHeader
                    strengthBar

                    if isLoading {
                        loadingState
                    } else if let guidance {
                        guidanceContent(guidance)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .padding(.bottom, 20)
            }

            // Pinned input at bottom
            inputBar
        }
        .background(DesignTokens.background)
        .presentationDetents([.fraction(0.65), .large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(24)
        .presentationBackground(DesignTokens.background)
        .task {
            await loadGuidance()
        }
    }

    // MARK: - Header

    private var sheetHeader: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Improve")
                .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                .foregroundStyle(DesignTokens.textTertiary)
                .textCase(.uppercase)

            Text(beat.displayName)
                .font(DesignTokens.displayFont(size: 24))
                .foregroundStyle(DesignTokens.textPrimary)
        }
    }

    // MARK: - Strength Bar

    private var strengthBar: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color(hex: "#1A1A1A"))
                    .frame(height: 6)

                RoundedRectangle(cornerRadius: 4)
                    .fill(DesignTokens.gold)
                    .frame(width: max(geo.size.width * beat.strength, 0), height: 6)
            }
        }
        .frame(height: 6)
    }

    // MARK: - Loading State

    private var loadingState: some View {
        VStack(spacing: 12) {
            ProgressView()
                .tint(DesignTokens.gold)

            Text("Analyzing your story...")
                .font(DesignTokens.bodyFont(size: 13))
                .foregroundStyle(DesignTokens.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
    }

    // MARK: - Guidance Content

    @ViewBuilder
    private func guidanceContent(_ guidance: ElementGuidance) -> some View {
        // 1. Story anchor — the sentence being improved
        if let anchor = guidance.storyAnchor, !anchor.isEmpty {
            storyAnchorCard(anchor)
        }

        // 2. Diagnosis — what's weak and why
        if let diagnosis = guidance.diagnosis, !diagnosis.isEmpty {
            Text(diagnosis)
                .font(DesignTokens.bodyFont(size: 14))
                .foregroundStyle(DesignTokens.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }

        // 3. Suggestion — the specific guiding question
        if let suggestion = guidance.suggestion, !suggestion.isEmpty {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "lightbulb.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(DesignTokens.gold)
                    .padding(.top, 2)

                Text(suggestion)
                    .font(DesignTokens.bodyFont(size: 15, weight: .medium))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }

        // 4. Tappable examples
        if !guidance.examples.isEmpty {
            exampleChips(guidance.examples)
        }
    }

    // MARK: - Story Anchor Card

    private func storyAnchorCard(_ anchor: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("FROM YOUR STORY")
                .font(DesignTokens.bodyFont(size: 11, weight: .semibold))
                .foregroundStyle(DesignTokens.gold.opacity(0.7))
                .tracking(0.5)

            HStack(alignment: .top, spacing: 10) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(DesignTokens.gold.opacity(0.6))
                    .frame(width: 3)

                Text("\"\(anchor)\"")
                    .font(DesignTokens.bodyFont(size: 15).italic())
                    .foregroundStyle(DesignTokens.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DesignTokens.gold.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Example Chips (tappable to pre-fill)

    private func exampleChips(_ examples: [String]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Try something like:")
                .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                .foregroundStyle(DesignTokens.textTertiary)

            ForEach(examples, id: \.self) { example in
                Button {
                    refinementText = example
                } label: {
                    Text("\"\(example)\"")
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundStyle(DesignTokens.textSecondary)
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(Color(hex: "#1A1A1A"))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .overlay(
                            RoundedRectangle(cornerRadius: 10)
                                .strokeBorder(DesignTokens.gold.opacity(0.15), lineWidth: 1)
                        )
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: - Input Bar

    private var inputBar: some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(DesignTokens.borderSubtle)
                .frame(height: 0.5)

            HStack(spacing: 10) {
                TextField("Share more about the \(elementNoun)...", text: $refinementText, axis: .vertical)
                    .font(DesignTokens.bodyFont(size: 15))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .lineLimit(1...5)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(Color(hex: "#1A1A1A"))
                    .clipShape(RoundedRectangle(cornerRadius: 12))

                Button {
                    submitRefinement()
                } label: {
                    Group {
                        if isSubmitting {
                            ProgressView()
                                .tint(.black)
                                .scaleEffect(0.7)
                        } else {
                            Image(systemName: "arrow.up")
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(.black)
                        }
                    }
                    .frame(width: 36, height: 36)
                    .background(canSubmit ? DesignTokens.gold : DesignTokens.gold.opacity(0.4))
                    .clipShape(Circle())
                }
                .disabled(!canSubmit)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .background(DesignTokens.surface)
        }
    }

    private var canSubmit: Bool {
        !refinementText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isSubmitting
    }

    // MARK: - Actions

    private func loadGuidance() async {
        do {
            let remote = try await engine.fetchElementGuidance(elementId: beat.id)
            // Use remote guidance only if it's actually enriched (has story anchor or non-generic diagnosis)
            if remote.storyAnchor != nil || (remote.diagnosis != nil && remote.examples.count > 0) {
                guidance = remote
                isLoading = false
                return
            }
        } catch {
            // Fall through to local guidance
        }
        // Generate narrative-aware guidance locally
        guidance = generateLocalGuidance()
        isLoading = false
    }

    // MARK: - Local Guidance Generator

    private func generateLocalGuidance() -> ElementGuidance {
        let narrative = engine.draft.displayNarrative
        let anchor = extractRelevantExcerpt(from: narrative)
        let template = beatGuidanceTemplate(anchor: anchor)

        return ElementGuidance(
            elementId: beat.id,
            elementName: beat.displayName,
            strength: beat.strength,
            state: beat.strength > 0 ? "weak" : "missing",
            diagnosis: template.diagnosis,
            storyAnchor: anchor,
            suggestion: template.suggestion,
            examples: template.examples
        )
    }

    private func extractRelevantExcerpt(from narrative: String) -> String? {
        guard !narrative.isEmpty else { return nil }

        let sentences = narrative
            .replacingOccurrences(of: "\n", with: ". ")
            .components(separatedBy: ". ")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { $0.count > 15 }

        guard !sentences.isEmpty else { return nil }

        let keywords = keywordsForBeat()
        var bestSentence: String?
        var bestScore = 0

        for sentence in sentences {
            let lower = sentence.lowercased()
            var score = 0
            for keyword in keywords {
                if lower.contains(keyword) { score += 1 }
            }
            if score > bestScore {
                bestScore = score
                bestSentence = sentence
            }
        }

        guard let match = bestSentence else {
            return sentences.first
        }

        var result = match.trimmingCharacters(in: .whitespacesAndNewlines)
        if !result.hasSuffix(".") && !result.hasSuffix("?") && !result.hasSuffix("!") {
            result += "."
        }
        return result
    }

    private func keywordsForBeat() -> [String] {
        let name = beat.displayName.lowercased()
        if name.contains("setting") {
            return ["morning", "night", "home", "house", "kitchen", "room", "hospital", "school",
                    "office", "car", "summer", "winter", "rain", "sunday", "place", "street",
                    "door", "window", "table", "bed", "outside"]
        }
        if name.contains("feeling") {
            return ["feel", "felt", "fear", "proud", "love", "heart", "worry", "happy", "sad",
                    "grateful", "anger", "joy", "pain", "hope", "miss", "strong", "emotion",
                    "tears", "smile", "cry", "nervous", "relief", "anxiety"]
        }
        if name.contains("bond") {
            return ["together", "our", "we", "us", "share", "between", "family", "care",
                    "support", "always", "never", "connection", "understand", "trust",
                    "partner", "friend", "close", "special"]
        }
        if name.contains("moment") {
            return ["remember", "when", "that time", "moment", "happened", "changed", "suddenly",
                    "realized", "first", "never forget", "one day", "turning point", "surprise"]
        }
        if name.contains("detail") {
            return ["see", "hear", "smell", "taste", "voice", "eyes", "hands", "laugh",
                    "sound", "color", "bright", "warm", "cold", "look", "wear", "tiny"]
        }
        // Generic fallback
        return ["you", "remember", "when", "always", "never", "love", "heart"]
    }

    private struct GuidanceTemplate {
        let diagnosis: String
        let suggestion: String
        let examples: [String]
    }

    private func beatGuidanceTemplate(anchor: String?) -> GuidanceTemplate {
        let name = beat.displayName.lowercased()
        let anchorRef = anchor.map { "\"\($0.prefix(60))...\"" } ?? "your story"

        if name.contains("setting") {
            return GuidanceTemplate(
                diagnosis: "Your story tells us what happens but we can't picture where. From \(anchorRef) — where exactly is this? A vivid setting grounds the listener in the moment.",
                suggestion: "Close your eyes and go back to that scene. What do you see around you? What does the space look like?",
                examples: [
                    "In our tiny kitchen, with dinner bubbling on the stove and kids' drawings covering the fridge",
                    "At 6am before anyone else is up, sitting at the dining table in the quiet",
                    "In the hospital waiting room, under those harsh fluorescent lights"
                ]
            )
        }
        if name.contains("feeling") {
            return GuidanceTemplate(
                diagnosis: "From \(anchorRef) — we know what happened, but not how it felt. The emotional core is what makes a song resonate. What did YOU feel in that moment?",
                suggestion: "When you think about this, what's the first emotion that hits you? Not what you should feel — what you actually felt.",
                examples: [
                    "A knot in my stomach that wouldn't go away for weeks",
                    "Pride so deep it made my chest tight",
                    "Relief mixed with guilt — grateful but feeling like I should've done more"
                ]
            )
        }
        if name.contains("bond") {
            return GuidanceTemplate(
                diagnosis: "From \(anchorRef) — your story describes what they do, but not what makes your connection unique. What's the invisible thread between you two that nobody else can see?",
                suggestion: "What's a small moment that only the two of you would understand? Something that would make them smile if they heard it?",
                examples: [
                    "The way she always saves me a plate no matter how late I come home",
                    "How we can have a whole conversation just by looking at each other across the room",
                    "Our late-night talks after the kids are finally asleep"
                ]
            )
        }
        if name.contains("moment") {
            return GuidanceTemplate(
                diagnosis: "From \(anchorRef) — your story has a narrative arc but what's THE moment? The one scene that captures everything?",
                suggestion: "If you could freeze one moment from this story in time, which one would it be? The one that changed everything.",
                examples: [
                    "The moment she looked at me and said 'we'll figure it out' — and I believed her",
                    "When I came home and found she'd handled everything while I was gone",
                    "That phone call where everything suddenly became real"
                ]
            )
        }
        if name.contains("detail") {
            return GuidanceTemplate(
                diagnosis: "From \(anchorRef) — the story makes sense but doesn't come alive yet. One specific sensory detail can transform a good story into a great one.",
                suggestion: "Pick one scene and zoom in. What do you see, hear, or smell? The smallest details are often the most powerful.",
                examples: [
                    "Her laugh — the one that fills up the whole room and makes everyone turn",
                    "The smell of her cooking hitting me the moment I open the front door",
                    "The way the morning light catches her face when she's reading"
                ]
            )
        }

        // Generic fallback for unknown beat types
        return GuidanceTemplate(
            diagnosis: "This part of your story could be richer. From \(anchorRef) — there's a deeper layer here waiting to be told.",
            suggestion: "What's the one detail about this that you haven't shared yet? The thing that makes this story truly yours?",
            examples: [
                "Something only you would remember about this moment",
                "The feeling you had that you've never quite been able to explain"
            ]
        )
    }

    private func submitRefinement() {
        let text = refinementText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        isSubmitting = true

        Task {
            do {
                try await engine.reviseFromConfirmation(text)
                dismiss()
            } catch {
                // Keep text so user can retry
            }
            isSubmitting = false
        }
    }
}
