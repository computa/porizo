//
//  CustomCreateView.swift
//  PorizoApp
//
//  Unified Create screen matching v1.pen "08a - Custom Create" and "08b - Simple Create".
//  Both modes live in the same view with a tab toggle.
//  Velvet & Gold design system.
//

import SwiftUI

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
    @State private var selectedStyles: Set<String> = ["indie"]  // Default selection per v1.pen
    @State private var title: String = ""
    @State private var showAdvancedOptions: Bool = false
    @State private var showSpeechInput: Bool = false

    // Advanced options
    @State private var tempo: String = ""
    @State private var mood: String = ""
    @State private var duration: String = ""

    private let availableStyles = ["indie", "reggae", "epic", "folk"]

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header with Simple/Custom toggle (v1.pen)
                headerSection

                // Scrollable content based on selected tab
                ScrollView {
                    VStack(spacing: 24) {
                        if selectedTab == .simple {
                            simpleCreateContent
                        } else {
                            customCreateContent
                        }

                        Spacer(minLength: 120)
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 24)
                }

                // Bottom bar (same for both modes)
                bottomBar
            }
        }
        .onAppear {
            selectedTab = initialTab
        }
        .fullScreenCover(isPresented: $showSpeechInput) {
            SpeechInputView(
                storyId: "",
                onTranscription: { text in
                    if selectedTab == .simple {
                        songDescription = text
                    } else {
                        lyrics = text
                    }
                    showSpeechInput = false
                },
                onCancel: {
                    showSpeechInput = false
                }
            )
        }
    }

    // MARK: - Header (v1.pen: settings icon, Simple/Custom toggle, X close)

    private var headerSection: some View {
        HStack {
            // Settings button (v1.pen: 44x44 circle)
            Button {
                // TODO: Show settings
            } label: {
                Image(systemName: "gearshape")
                    .font(.system(size: 20))
                    .foregroundColor(.white)
                    .frame(width: 44, height: 44)
                    .background(DesignTokens.surface)
                    .clipShape(Circle())
            }

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
        VStack(alignment: .leading, spacing: 24) {
            // Describe your song section (v1.pen: sparkles icon + label)
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 16))
                        .foregroundColor(DesignTokens.gold)
                    Text("Describe your song")
                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        .foregroundColor(DesignTokens.textPrimary)
                }

                // Text area (v1.pen: large text area with placeholder)
                ZStack(alignment: .topLeading) {
                    if songDescription.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Tell me what kind of song you want...")
                                .font(DesignTokens.bodyFont(size: 16))
                                .foregroundColor(DesignTokens.textTertiary)

                            Text("Example: \"A happy birthday song for my daughter turning 5, with a playful melody\"")
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
                .frame(height: 140)
                .background(DesignTokens.surface)
                .cornerRadius(16)
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
                            Text("+ Add Lyrics")
                                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                                .foregroundColor(DesignTokens.textSecondary)
                        }
                    }
                    .buttonStyle(.plain)

                    Spacer()

                    // Instrumental toggle (v1.pen: right side)
                    HStack(spacing: 8) {
                        Text("Instrumental")
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
                            Text("Add specific lyrics you want included...")
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
                    .frame(height: 100)
                    .background(DesignTokens.surface)
                    .cornerRadius(12)
                }
            }

            // Styles section (shared)
            stylesSection
        }
    }

    // MARK: - Custom Create Content (v1.pen: 08a)

    private var customCreateContent: some View {
        VStack(alignment: .leading, spacing: 24) {
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
                Text("Lyrics")
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    .foregroundColor(DesignTokens.textPrimary)

                Spacer()

                // Instrumental toggle
                HStack(spacing: 8) {
                    Text("Instrumental")
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundColor(DesignTokens.textSecondary)

                    Toggle("", isOn: $isInstrumental)
                        .toggleStyle(SwitchToggleStyle(tint: DesignTokens.gold))
                        .labelsHidden()
                }
            }

            // Text area (v1.pen: 120h)
            ZStack(alignment: .topLeading) {
                if lyrics.isEmpty && !isInstrumental {
                    Text("Add your own lyrics, or type in a subject to generate")
                        .font(DesignTokens.bodyFont(size: 16))
                        .foregroundColor(DesignTokens.textTertiary)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 16)
                }

                TextEditor(text: $lyrics)
                    .font(DesignTokens.bodyFont(size: 16))
                    .foregroundColor(DesignTokens.textPrimary)
                    .scrollContentBackground(.hidden)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 12)
                    .tint(DesignTokens.gold)
            }
            .frame(height: 120)
            .background(DesignTokens.surface)
            .cornerRadius(16)
            .opacity(isInstrumental ? 0.5 : 1.0)
            .disabled(isInstrumental)

            // Generate button (v1.pen: gold outline capsule)
            if !isInstrumental {
                Button {
                    generateLyrics()
                } label: {
                    HStack(spacing: 8) {
                        if isGeneratingLyrics {
                            ProgressView()
                                .tint(DesignTokens.gold)
                                .scaleEffect(0.8)
                        } else {
                            Image(systemName: "sparkles")
                        }
                        Text("Generate")
                            .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                    }
                    .foregroundColor(DesignTokens.gold)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 10)
                    .background(
                        Capsule()
                            .stroke(DesignTokens.gold, lineWidth: 1)
                    )
                }
                .disabled(isGeneratingLyrics || lyrics.isEmpty)
            }
        }
    }

    // MARK: - Styles Section (v1.pen: shared between both modes)

    private var stylesSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header
            HStack(spacing: 8) {
                Image(systemName: "music.note")
                    .foregroundColor(DesignTokens.gold)
                Text("Styles")
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    .foregroundColor(DesignTokens.textPrimary)
            }

            // Text input (v1.pen: 44h, pill shape)
            TextField("Enter your own styles", text: $stylesInput)
                .font(DesignTokens.bodyFont(size: 16))
                .foregroundColor(DesignTokens.textPrimary)
                .tint(DesignTokens.gold)
                .padding(.horizontal, 16)
                .frame(height: 44)
                .background(DesignTokens.surface)
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
            Text(style)
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
                    advancedOptionField(label: "Tempo (BPM)", placeholder: "e.g., 120", text: $tempo)
                    advancedOptionField(label: "Mood", placeholder: "e.g., uplifting, melancholic", text: $mood)
                    advancedOptionField(label: "Duration", placeholder: "e.g., 60 seconds", text: $duration)
                }
                .padding(16)
                .background(DesignTokens.surface)
                .cornerRadius(12)
            }
        }
    }

    private func advancedOptionField(label: String, placeholder: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                .foregroundColor(DesignTokens.textSecondary)

            TextField(placeholder, text: text)
                .font(DesignTokens.bodyFont(size: 14))
                .foregroundColor(DesignTokens.textPrimary)
                .tint(DesignTokens.gold)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(Color(hex: "#1A1A1A"))
                .cornerRadius(8)
        }
    }

    // MARK: - Title Section (v1.pen: 08a only)

    private var titleSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Title (Optional)")
                .font(DesignTokens.bodyFont(size: 12))
                .foregroundColor(DesignTokens.textSecondary)

            TextField("Enter a title for your song", text: $title)
                .font(DesignTokens.bodyFont(size: 16))
                .foregroundColor(DesignTokens.textPrimary)
                .tint(DesignTokens.gold)
                .padding(.horizontal, 20)
                .frame(height: 48)
                .background(DesignTokens.surface)
                .cornerRadius(24)
        }
    }

    // MARK: - Bottom Bar (v1.pen: mic button + Create Song)

    private var bottomBar: some View {
        HStack(spacing: 12) {
            // Mic button (v1.pen: 56x56 circle)
            Button {
                showSpeechInput = true
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
                    Image(systemName: "music.note")
                        .font(.system(size: 16))
                    Text("Create Song")
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

        isGeneratingLyrics = true

        // TODO: Call API to generate lyrics based on the subject
        Task {
            try? await Task.sleep(for: .seconds(2))
            await MainActor.run {
                isGeneratingLyrics = false
            }
        }
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
