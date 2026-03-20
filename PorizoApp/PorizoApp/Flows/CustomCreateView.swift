//
//  CustomCreateView.swift
//  PorizoApp
//
//  Unified Create screen matching v1.pen "08 - Unified Create".
//  Both Simple and Custom modes live in the same view with a tab toggle.
//  Velvet & Gold design system.
//

import SwiftUI

enum CreateContentKind {
    case song
    case poem
}

// MARK: - Create Mode Tab

enum CreateModeTab: String, CaseIterable {
    case simple = "Simple"
    case custom = "Custom"
}

// MARK: - Unified Create View

struct CustomCreateView: View {
    let apiClient: APIClient
    let onCreateSong: (CustomSongRequest) -> Void
    let onCancel: () -> Void
    var contentKind: CreateContentKind = .song
    var primaryCtaTitle: String = "Create Song"
    var primaryCtaIcon: String = "music.note"

    // Optional: start on a specific tab
    var initialTab: CreateModeTab = .simple

    @State private var selectedTab: CreateModeTab = .simple

    // Simple mode state
    @State private var songDescription: String = ""
    @State private var additionalLyrics: String = ""
    @State private var showAddLyrics: Bool = false

    // Custom mode state
    @State private var lyrics: String = ""
    @State private var isInstrumental: Bool = false
    @State private var isGeneratingLyrics: Bool = false

    // Shared state
    @State private var stylesInput: String = ""
    @State private var selectedStyles: Set<String> = ["pop"]
    @State private var title: String = ""
    @State private var showAdvancedOptions: Bool = false
    @State private var speechInputContext: SpeechInputContext?

    // Advanced options
    @State private var tempo: String = ""
    @State private var mood: String = ""
    @State private var duration: String = ""

    private var descriptionTitle: String {
        contentKind == .poem ? "Describe your poem" : "Describe your song"
    }

    private var descriptionPlaceholder: String {
        contentKind == .poem ? "Tell me what kind of poem you want..." : "Tell me what kind of song you want..."
    }

    private var descriptionExample: String {
        contentKind == .poem
            ? "Example: \"A short birthday poem with warm, heartfelt lines\""
            : "Example: \"A happy birthday song for my daughter turning 5, with a playful melody\""
    }

    private var addLyricsTitle: String {
        contentKind == .poem ? "+ Add Lines" : "+ Add Lyrics"
    }

    private var instrumentalLabel: String {
        contentKind == .poem ? "No Lines" : "Instrumental"
    }

    private var addLyricsPlaceholder: String {
        contentKind == .poem ? "Add specific lines you want included..." : "Add specific lyrics you want included..."
    }

    private var lyricsSectionTitle: String {
        contentKind == .poem ? "Lines" : "Lyrics"
    }

    private var lyricsPlaceholder: String {
        contentKind == .poem
            ? "Add your own lines, or type a subject to generate"
            : "Add your own lyrics, or type in a subject to generate"
    }

    private var generateLabel: String {
        contentKind == .poem ? "Generate Lines" : "Generate"
    }

    private var stylesTitle: String {
        contentKind == .poem ? "Tone & Style" : "Styles"
    }

    private var stylesPlaceholder: String {
        contentKind == .poem ? "Enter a tone or style" : "Enter your own styles"
    }

    private var stylesIcon: String {
        contentKind == .poem ? "textformat" : "music.note"
    }

    @Environment(StyleStore.self) private var styleStore

    private var availableStyles: [String] {
        contentKind == .poem
            ? ["romantic", "playful", "reflective", "uplifting"]
            : styleStore.styles.map(\.key)
    }

    private var tempoLabel: String {
        contentKind == .poem ? "Length (lines)" : "Tempo (BPM)"
    }

    private var tempoPlaceholder: String {
        contentKind == .poem ? "e.g., 12" : "e.g., 120"
    }

    private var moodLabel: String {
        "Mood"
    }

    private var moodPlaceholder: String {
        "e.g., uplifting, melancholic"
    }

    private var durationLabel: String {
        contentKind == .poem ? "Rhyme style" : "Duration"
    }

    private var durationPlaceholder: String {
        contentKind == .poem ? "e.g., ABAB, free verse" : "e.g., 60 seconds"
    }

    private var titlePlaceholder: String {
        contentKind == .poem ? "Enter a title for your poem" : "Enter a title for your song"
    }

    private var songDescriptionBudgetState: BudgetState {
        StoryPromptBudget.state(
            count: songDescription.count,
            warningThreshold: StoryPromptBudget.initialPromptWarningThreshold,
            hardLimit: StoryPromptBudget.initialPromptHardLimit
        )
    }

    private var lyricsBudgetState: BudgetState {
        StoryPromptBudget.state(
            count: lyrics.count,
            warningThreshold: StoryPromptBudget.initialPromptWarningThreshold,
            hardLimit: StoryPromptBudget.initialPromptHardLimit
        )
    }

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header with Simple/Custom toggle (v1.pen)
                headerSection

                // Scrollable content based on selected tab
                ScrollView {
                    VStack(spacing: 16) {
                        if selectedTab == .simple {
                            simpleCreateContent
                        } else {
                            customCreateContent
                        }

                        Spacer(minLength: 100)
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 16)
                }

                // Bottom bar (same for both modes)
                bottomBar
            }
        }
        .onAppear {
            selectedTab = initialTab
        }
        .fullScreenCover(item: $speechInputContext) { context in
            SpeechInputView(
                storyId: context.storyId,
                onTranscription: { text in
                    applySpeechTranscription(text)
                    speechInputContext = nil
                },
                onCancel: {
                    speechInputContext = nil
                }
            )
        }
    }

    // MARK: - Header (v1.pen: settings icon, Simple/Custom toggle, X close)

    private var headerSection: some View {
        HStack {
            // Invisible spacer to balance header layout
            Color.clear.frame(width: 44, height: 44)

            Spacer()

            // Tab toggle (v1.pen: Simple/Custom)
            tabToggle

            Spacer()

            // Close button (v1.pen: 44x44 circle)
            Button {
                onCancel()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(.white)
                    .frame(width: 44, height: 44)
                    .background(DesignTokens.surface)
                    .clipShape(Circle())
            }
        }
        .padding(.horizontal, 20)
        .frame(height: 56)
    }

    // MARK: - Tab Toggle (v1.pen: Simple selected = gold underline)

    private var tabToggle: some View {
        HStack(spacing: 24) {
            ForEach(CreateModeTab.allCases, id: \.self) { tab in
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        selectedTab = tab
                    }
                } label: {
                    VStack(spacing: 4) {
                        Text(tab.rawValue)
                            .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                            .foregroundColor(selectedTab == tab ? DesignTokens.gold : DesignTokens.textSecondary)

                        // Gold underline for selected
                        Rectangle()
                            .fill(selectedTab == tab ? DesignTokens.gold : Color.clear)
                            .frame(height: 2)
                    }
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: - Simple Create Content (v1.pen: 08b)

    private var simpleCreateContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Describe your song section (v1.pen: sparkles icon + label)
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 16))
                        .foregroundColor(DesignTokens.gold)
                    Text(descriptionTitle)
                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        .foregroundColor(DesignTokens.textPrimary)
                }

                // Text area (v1.pen: large text area with placeholder)
                ZStack(alignment: .topLeading) {
                    if songDescription.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(descriptionPlaceholder)
                                .font(DesignTokens.bodyFont(size: 16))
                                .foregroundColor(DesignTokens.textTertiary)

                            Text(descriptionExample)
                                .font(DesignTokens.bodyFont(size: 14))
                                .foregroundColor(DesignTokens.textTertiary)
                                .lineSpacing(4)
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 16)
                    }

                    TextEditor(text: $songDescription)
                        .font(DesignTokens.bodyFont(size: 16))
                        .foregroundColor(DesignTokens.textPrimary)
                        .scrollContentBackground(.hidden)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 12)
                        .tint(DesignTokens.gold)
                }
                .frame(height: 100)
                .background(DesignTokens.inputBackground)
                .cornerRadius(12)

                promptBudgetRow(
                    count: songDescription.count,
                    state: songDescriptionBudgetState
                )
            }

            // Add Lyrics section (v1.pen: expandable with Instrumental toggle)
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            showAddLyrics.toggle()
                        }
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "doc.text")
                                .font(.system(size: 16))
                                .foregroundColor(DesignTokens.textSecondary)
                            Text(addLyricsTitle)
                                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                                .foregroundColor(DesignTokens.textSecondary)
                        }
                    }
                    .buttonStyle(.plain)

                    Spacer()

                    // Instrumental toggle (v1.pen: right side)
                    HStack(spacing: 8) {
                        Text(instrumentalLabel)
                            .font(DesignTokens.bodyFont(size: 14))
                            .foregroundColor(DesignTokens.textSecondary)

                        Toggle("", isOn: $isInstrumental)
                            .toggleStyle(SwitchToggleStyle(tint: DesignTokens.gold))
                            .labelsHidden()
                    }
                }

                // Expanded lyrics area
                if showAddLyrics && !isInstrumental {
                    ZStack(alignment: .topLeading) {
                        if additionalLyrics.isEmpty {
                            Text(addLyricsPlaceholder)
                                .font(DesignTokens.bodyFont(size: 16))
                                .foregroundColor(DesignTokens.textTertiary)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 16)
                        }

                        TextEditor(text: $additionalLyrics)
                            .font(DesignTokens.bodyFont(size: 16))
                            .foregroundColor(DesignTokens.textPrimary)
                            .scrollContentBackground(.hidden)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 12)
                            .tint(DesignTokens.gold)
                    }
                    .frame(height: 80)
                    .background(DesignTokens.inputBackground)
                    .cornerRadius(10)
                }
            }

            // Styles section (shared)
            stylesSection
        }
    }

    // MARK: - Custom Create Content (v1.pen: 08a)

    private var customCreateContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Lyrics section
            lyricsSection

            // Styles section (shared)
            stylesSection

            // Advanced options
            advancedOptionsSection

            // Title section
            titleSection
        }
    }

    // MARK: - Lyrics Section (v1.pen: 08a lyricsSection)

    private var lyricsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header with Instrumental toggle
            HStack {
                Text(lyricsSectionTitle)
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    .foregroundColor(DesignTokens.textPrimary)

                Spacer()

                // Instrumental toggle
                HStack(spacing: 8) {
                    Text(instrumentalLabel)
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundColor(DesignTokens.textSecondary)

                    Toggle("", isOn: $isInstrumental)
                        .toggleStyle(SwitchToggleStyle(tint: DesignTokens.gold))
                        .labelsHidden()
                }
            }

            // Text area (compact: 80h)
            ZStack(alignment: .topLeading) {
                if lyrics.isEmpty && !isInstrumental {
                    Text(lyricsPlaceholder)
                        .font(DesignTokens.bodyFont(size: 15))
                        .foregroundColor(DesignTokens.textTertiary)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                }

                TextEditor(text: $lyrics)
                    .font(DesignTokens.bodyFont(size: 15))
                    .foregroundColor(DesignTokens.textPrimary)
                    .scrollContentBackground(.hidden)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 10)
                    .tint(DesignTokens.gold)
            }
            .frame(height: 80)
            .background(DesignTokens.inputBackground)
            .cornerRadius(12)
            .opacity(isInstrumental ? 0.5 : 1.0)
            .disabled(isInstrumental)

            if !isInstrumental {
                promptBudgetRow(
                    count: lyrics.count,
                    state: lyricsBudgetState
                )
            }

            // Generate button hidden until text-to-lyrics backend endpoint is available
        }
    }

    // MARK: - Styles Section (v1.pen: shared between both modes)

    private var stylesSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header
            HStack(spacing: 8) {
                Image(systemName: stylesIcon)
                    .foregroundColor(DesignTokens.gold)
                Text(stylesTitle)
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    .foregroundColor(DesignTokens.textPrimary)
            }

            // Text input (v1.pen: 44h, pill shape)
            TextField(stylesPlaceholder, text: $stylesInput)
                .font(DesignTokens.bodyFont(size: 16))
                .foregroundColor(DesignTokens.textPrimary)
                .tint(DesignTokens.gold)
                .padding(.horizontal, 16)
                .frame(height: 44)
                .background(DesignTokens.inputBackground)
                .cornerRadius(22)

            // Chips row (v1.pen: refresh icon + style chips)
            HStack(spacing: 8) {
                // Refresh button
                Button {
                    // Shuffle styles
                } label: {
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .font(.system(size: 16))
                        .foregroundColor(DesignTokens.textSecondary)
                        .frame(width: 36, height: 36)
                        .background(DesignTokens.surface)
                        .cornerRadius(18)
                }

                // Style chips
                ForEach(availableStyles, id: \.self) { style in
                    styleChip(style)
                }
            }
        }
    }

    private func styleChip(_ style: String) -> some View {
        let isSelected = selectedStyles.contains(style)

        return Button {
            if isSelected {
                selectedStyles.remove(style)
            } else {
                selectedStyles.insert(style)
            }
        } label: {
            Text(styleStore.displayName(for: style))
                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                .foregroundColor(isSelected ? DesignTokens.background : DesignTokens.textSecondary)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(
                    isSelected
                        ? DesignTokens.gold
                        : DesignTokens.surface
                )
                .cornerRadius(20)
                .overlay(
                    RoundedRectangle(cornerRadius: 20)
                        .stroke(isSelected ? Color.clear : DesignTokens.borderSubtle, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Advanced Options (v1.pen: expandable)

    private var advancedOptionsSection: some View {
        VStack(spacing: 12) {
            // Toggle button (v1.pen: chevron)
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    showAdvancedOptions.toggle()
                }
            } label: {
                HStack {
                    Text("Advanced Options")
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundColor(DesignTokens.textSecondary)

                    Spacer()

                    Image(systemName: showAdvancedOptions ? "chevron.up" : "chevron.down")
                        .font(.system(size: 14))
                        .foregroundColor(DesignTokens.textTertiary)
                }
                .padding(.horizontal, 16)
                .frame(height: 48)
                .background(DesignTokens.surface)
                .cornerRadius(12)
            }
            .buttonStyle(.plain)

            // Expanded content
            if showAdvancedOptions {
                VStack(spacing: 12) {
                    advancedOptionField(label: tempoLabel, placeholder: tempoPlaceholder, text: $tempo)
                    advancedOptionField(label: moodLabel, placeholder: moodPlaceholder, text: $mood)
                    advancedOptionField(label: durationLabel, placeholder: durationPlaceholder, text: $duration)
                }
                .padding(16)
                .background(DesignTokens.surface)
                .cornerRadius(12)
            }
        }
    }

    private func advancedOptionField(label: String, placeholder: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(DesignTokens.bodyFont(size: 11, weight: .medium))
                .foregroundColor(DesignTokens.textSecondary)

            TextField(placeholder, text: text)
                .font(DesignTokens.bodyFont(size: 14))
                .foregroundColor(DesignTokens.textPrimary)
                .tint(DesignTokens.gold)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(DesignTokens.inputBackground)
                .cornerRadius(8)
        }
    }

    // MARK: - Title Section (v1.pen: 08a only)

    private var titleSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Title (Optional)")
                .font(DesignTokens.bodyFont(size: 12))
                .foregroundColor(DesignTokens.textSecondary)

            TextField(titlePlaceholder, text: $title)
                .font(DesignTokens.bodyFont(size: 16))
                .foregroundColor(DesignTokens.textPrimary)
                .tint(DesignTokens.gold)
                .padding(.horizontal, 20)
                .frame(height: 48)
                .background(DesignTokens.inputBackground)
                .cornerRadius(24)
        }
    }

    // MARK: - Bottom Bar (v1.pen: mic button + Create Song)

    private var bottomBar: some View {
        HStack(spacing: 12) {
            // Mic button (v1.pen: 56x56 circle)
            Button {
                speechInputContext = SpeechInputContext(storyId: nil)
            } label: {
                Image(systemName: "mic.fill")
                    .font(.system(size: 24))
                    .foregroundColor(DesignTokens.textPrimary)
                    .frame(width: 56, height: 56)
                    .background(DesignTokens.surface)
                    .cornerRadius(28)
            }

            // Create Song button (v1.pen: gold, full width)
            Button {
                createSong()
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: primaryCtaIcon)
                        .font(.system(size: 16))
                    Text(primaryCtaTitle)
                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                }
                .foregroundColor(DesignTokens.background)
                .frame(maxWidth: .infinity)
                .frame(height: 56)
                .background(canCreate ? DesignTokens.gold : DesignTokens.gold.opacity(0.5))
                .cornerRadius(28)
            }
            .disabled(!canCreate)
        }
        .padding(.horizontal, 20)
        .padding(.top, 16)
        .padding(.bottom, 34)
        .background(DesignTokens.background)
    }

    // MARK: - Helpers

    private var canCreate: Bool {
        if selectedTab == .simple {
            let hasDescription = !songDescription.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            let hasStyles = !selectedStyles.isEmpty || !stylesInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            return hasDescription && hasStyles
        } else {
            let hasContent = isInstrumental || !lyrics.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            let hasStyles = !selectedStyles.isEmpty || !stylesInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            return hasContent && hasStyles
        }
    }

    private func generateLyrics() {
        guard !lyrics.isEmpty else { return }

        // The lyrics text field contains a subject/topic that the user wants expanded
        // into full lyrics. Currently, the backend only supports generating lyrics from
        // a confirmed story context (via /story/:id/lyrics), not from a raw text prompt.
        //
        // Until a direct text-to-lyrics endpoint is available, show feedback to user.
        let subject = lyrics.trimmingCharacters(in: .whitespacesAndNewlines)

        // Provide helpful feedback based on content type
        if contentKind == .poem {
            ToastService.shared.info("Write your own lines below, then tap Create to generate your poem.")
        } else {
            ToastService.shared.info("Describe your song idea below — we'll craft the perfect lyrics during creation.")
        }

        // Log for debugging/analytics
        print("[CustomCreateView] Generate requested for subject: \(subject.prefix(50))...")
    }

    private func createSong() {
        var allStyles = Array(selectedStyles)
        if !stylesInput.isEmpty {
            allStyles.append(contentsOf: stylesInput.components(separatedBy: ",").map { $0.trimmingCharacters(in: .whitespaces) })
        }

        let request: CustomSongRequest

        if selectedTab == .simple {
            request = CustomSongRequest(
                description: songDescription,
                lyrics: additionalLyrics.isEmpty ? nil : additionalLyrics,
                isInstrumental: isInstrumental,
                styles: allStyles,
                title: nil,
                tempo: nil,
                mood: nil,
                duration: nil
            )
        } else {
            request = CustomSongRequest(
                description: nil,
                lyrics: isInstrumental ? nil : lyrics,
                isInstrumental: isInstrumental,
                styles: allStyles,
                title: title.isEmpty ? nil : title,
                tempo: tempo.isEmpty ? nil : tempo,
                mood: mood.isEmpty ? nil : mood,
                duration: duration.isEmpty ? nil : duration
            )
        }

        onCreateSong(request)
    }

    private func promptBudgetRow(count: Int, state: BudgetState) -> some View {
        HStack(spacing: 8) {
            Text(promptBudgetHint(for: state))
                .font(DesignTokens.bodyFont(size: 12))
                .foregroundColor(promptBudgetColor(for: state))
            Spacer()
            Text("\(count)/\(StoryPromptBudget.initialPromptHardLimit)")
                .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                .foregroundColor(promptBudgetColor(for: state))
        }
    }

    private func promptBudgetHint(for state: BudgetState) -> String {
        switch state {
        case .normal:
            return "Share your full story. We condense for reasoning while preserving key details."
        case .warning:
            return "Long story detected. Condensation keeps core facts and emotional beats."
        case .over:
            return "This is very long. Consider trimming repeated lines for faster generation."
        }
    }

    private func applySpeechTranscription(_ text: String) {
        if selectedTab == .simple {
            songDescription = text
        } else {
            lyrics = text
        }

        if text.count > StoryPromptBudget.initialPromptHardLimit {
            ToastService.shared.warning("Voice input is very long. Consider trimming repeated details for faster processing.")
        } else if text.count >= StoryPromptBudget.initialPromptWarningThreshold {
            ToastService.shared.info("Long story detected. We condense for reasoning while preserving key details.")
        }
    }

    private func promptBudgetColor(for state: BudgetState) -> Color {
        switch state {
        case .normal:
            return DesignTokens.textSecondary
        case .warning:
            return DesignTokens.gold
        case .over:
            return DesignTokens.error
        }
    }
}

// MARK: - Custom Song Request

struct CustomSongRequest {
    let description: String?  // For Simple mode
    let lyrics: String?
    let isInstrumental: Bool
    let styles: [String]
    let title: String?
    let tempo: String?
    let mood: String?
    let duration: String?
}

// MARK: - Preview

#Preview {
    CustomCreateView(
        apiClient: APIClient(baseURL: AppConfig.apiBaseURL),
        onCreateSong: { _ in },
        onCancel: { }
    )
}
