//
//  PoemWizardView.swift
//  PorizoApp
//
//  3-step wizard for creating personalized poems.
//  Steps: Basics -> Tone -> Message -> Preview
//

import SwiftUI

// MARK: - Wizard State

enum PoemWizardStep: Int, CaseIterable {
    case basics = 0
    case tone = 1
    case message = 2
    case preview = 3

    var title: String {
        switch self {
        case .basics: return "Basics"
        case .tone: return "Style"
        case .message: return "Message"
        case .preview: return "Preview"
        }
    }
}

// MARK: - Poem Wizard View

struct PoemWizardView: View {
    let apiClient: APIClient
    let onComplete: (Poem) -> Void
    let onCancel: () -> Void

    // Step state
    @State private var currentStep: PoemWizardStep = .basics

    // Form state - Basics
    @State private var title: String = ""
    @State private var recipientName: String = ""
    @State private var selectedOccasion: Occasion = .birthday

    // Form state - Tone
    @State private var selectedTone: PoemTone = .heartfelt

    // Form state - Message
    @State private var personalMessage: String = ""

    // Generation state
    @State private var isGenerating: Bool = false
    @State private var generatedPoem: Poem?
    @State private var errorMessage: String?
    @State private var showError: Bool = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Step indicator
                stepIndicator
                    .padding(.horizontal)
                    .padding(.top, 8)

                // Content
                ScrollView {
                    VStack(spacing: 24) {
                        stepContent
                    }
                    .padding()
                    .padding(.bottom, 100)
                }

                Spacer(minLength: 0)
            }
            .background(DesignTokens.background)
            .safeAreaInset(edge: .bottom) {
                actionButtons
            }
            .navigationTitle("Create Poem")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        onCancel()
                    }
                    .foregroundColor(DesignTokens.rose)
                }
            }
            .alert("Error", isPresented: $showError) {
                Button("OK") { }
            } message: {
                Text(errorMessage ?? "Something went wrong")
            }
        }
    }

    // MARK: - Step Indicator

    private var stepIndicator: some View {
        HStack(spacing: 8) {
            ForEach(PoemWizardStep.allCases, id: \.rawValue) { step in
                VStack(spacing: 4) {
                    Circle()
                        .fill(step.rawValue <= currentStep.rawValue ? DesignTokens.rose : DesignTokens.backgroundSubtle)
                        .frame(width: 8, height: 8)

                    Text(step.title)
                        .font(.caption2)
                        .foregroundColor(step.rawValue == currentStep.rawValue ? DesignTokens.rose : DesignTokens.textSecondary)
                }
                .frame(maxWidth: .infinity)

                if step.rawValue < PoemWizardStep.allCases.count - 1 {
                    Rectangle()
                        .fill(step.rawValue < currentStep.rawValue ? DesignTokens.rose : DesignTokens.backgroundSubtle)
                        .frame(height: 2)
                }
            }
        }
        .padding(.vertical, 12)
    }

    // MARK: - Step Content

    @ViewBuilder
    private var stepContent: some View {
        switch currentStep {
        case .basics:
            basicsStep
        case .tone:
            toneStep
        case .message:
            messageStep
        case .preview:
            previewStep
        }
    }

    // MARK: - Basics Step

    private var basicsStep: some View {
        VStack(alignment: .leading, spacing: 24) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Who is this poem for?")
                    .font(.title2.bold())
                    .foregroundColor(DesignTokens.textPrimary)

                Text("Tell us about the lucky recipient")
                    .font(.subheadline)
                    .foregroundColor(DesignTokens.textSecondary)
            }

            // Recipient name
            VStack(alignment: .leading, spacing: 8) {
                Text("Recipient's Name")
                    .font(.subheadline.weight(.medium))
                    .foregroundColor(DesignTokens.textSecondary)

                TextField("e.g., Mom, Sarah, Dad", text: $recipientName)
                    .textFieldStyle(.plain)
                    .padding()
                    .background(DesignTokens.backgroundSubtle)
                    .cornerRadius(12)
            }

            // Title (optional)
            VStack(alignment: .leading, spacing: 8) {
                Text("Poem Title (Optional)")
                    .font(.subheadline.weight(.medium))
                    .foregroundColor(DesignTokens.textSecondary)

                TextField("e.g., For My Dearest Mom", text: $title)
                    .textFieldStyle(.plain)
                    .padding()
                    .background(DesignTokens.backgroundSubtle)
                    .cornerRadius(12)
            }

            // Occasion
            VStack(alignment: .leading, spacing: 12) {
                Text("What's the occasion?")
                    .font(.subheadline.weight(.medium))
                    .foregroundColor(DesignTokens.textSecondary)

                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    ForEach(Occasion.allCases) { occasion in
                        Button {
                            selectedOccasion = occasion
                        } label: {
                            HStack {
                                Text(occasion.emoji)
                                Text(occasion.displayName)
                                    .font(.subheadline)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                            .background(selectedOccasion == occasion ? DesignTokens.roseMuted : DesignTokens.backgroundSubtle)
                            .foregroundColor(selectedOccasion == occasion ? DesignTokens.rose : DesignTokens.textPrimary)
                            .cornerRadius(12)
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(selectedOccasion == occasion ? DesignTokens.rose : Color.clear, lineWidth: 2)
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    // MARK: - Tone Step

    private var toneStep: some View {
        VStack(alignment: .leading, spacing: 24) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Choose a style")
                    .font(.title2.bold())
                    .foregroundColor(DesignTokens.textPrimary)

                Text("What mood should the poem convey?")
                    .font(.subheadline)
                    .foregroundColor(DesignTokens.textSecondary)
            }

            VStack(spacing: 12) {
                ForEach(PoemTone.allCases) { tone in
                    Button {
                        selectedTone = tone
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(tone.displayName)
                                    .font(.headline)
                                    .foregroundColor(DesignTokens.textPrimary)

                                Text(tone.description)
                                    .font(.caption)
                                    .foregroundColor(DesignTokens.textSecondary)
                            }

                            Spacer()

                            if selectedTone == tone {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundColor(DesignTokens.rose)
                                    .accessibilityHidden(true)
                            }
                        }
                        .padding()
                        .background(selectedTone == tone ? DesignTokens.roseMuted : DesignTokens.backgroundSubtle)
                        .cornerRadius(12)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(selectedTone == tone ? DesignTokens.rose : Color.clear, lineWidth: 2)
                        )
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(tone.displayName): \(tone.description)")
                    .accessibilityAddTraits(selectedTone == tone ? .isSelected : [])
                }
            }
        }
    }

    // MARK: - Message Step

    private var messageStep: some View {
        VStack(alignment: .leading, spacing: 24) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Add a personal touch")
                    .font(.title2.bold())
                    .foregroundColor(DesignTokens.textPrimary)

                Text("Share any special memories, inside jokes, or sentiments you'd like included")
                    .font(.subheadline)
                    .foregroundColor(DesignTokens.textSecondary)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Personal Message (Optional)")
                    .font(.subheadline.weight(.medium))
                    .foregroundColor(DesignTokens.textSecondary)

                TextEditor(text: $personalMessage)
                    .frame(minHeight: 150)
                    .padding(12)
                    .background(DesignTokens.backgroundSubtle)
                    .cornerRadius(12)
                    .scrollContentBackground(.hidden)

                Text("e.g., \"Remember when we used to watch the stars together? I want to thank you for always being there...\"")
                    .font(.caption)
                    .foregroundColor(DesignTokens.textTertiary)
                    .italic()
            }
        }
    }

    // MARK: - Preview Step

    private var previewStep: some View {
        VStack(alignment: .leading, spacing: 24) {
            if isGenerating {
                generatingView
            } else if let poem = generatedPoem {
                poemPreview(poem)
            } else {
                Text("Generating your poem...")
                    .foregroundColor(DesignTokens.textSecondary)
                    .onAppear {
                        generatePoem()
                    }
            }
        }
    }

    private var generatingView: some View {
        VStack(spacing: 24) {
            Spacer()

            ProgressView()
                .scaleEffect(1.5)
                .tint(DesignTokens.rose)

            Text("Crafting Your Poem...")
                .font(.headline)
                .foregroundColor(DesignTokens.textPrimary)

            Text("Our AI poet is creating something special for \(recipientName)")
                .font(.subheadline)
                .foregroundColor(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            Spacer()
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 60)
    }

    private func poemPreview(_ poem: Poem) -> some View {
        VStack(alignment: .leading, spacing: 24) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Your Poem")
                    .font(.title2.bold())
                    .foregroundColor(DesignTokens.textPrimary)

                Text("Review and make any adjustments")
                    .font(.subheadline)
                    .foregroundColor(DesignTokens.textSecondary)
            }

            // Poem card
            VStack(alignment: .leading, spacing: 16) {
                if !poem.title.isEmpty {
                    Text(poem.title)
                        .font(.title3.bold())
                        .foregroundColor(DesignTokens.textPrimary)
                }

                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(poem.verses.enumerated()), id: \.offset) { _, verse in
                        Text(verse)
                            .font(.body)
                            .foregroundColor(DesignTokens.textPrimary)
                            .italic()
                    }
                }

                HStack {
                    Text("For \(poem.recipientName)")
                        .font(.caption)
                        .foregroundColor(DesignTokens.textSecondary)

                    Spacer()

                    Text(poem.tone.capitalized)
                        .font(.caption)
                        .foregroundColor(DesignTokens.rose)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(DesignTokens.roseMuted)
                        .cornerRadius(8)
                }
            }
            .padding()
            .background(DesignTokens.cardBackground)
            .cornerRadius(16)
            .subtleShadow()

            // Regenerate button
            Button {
                generatePoem()
            } label: {
                HStack {
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .accessibilityHidden(true)
                    Text("Try Different Words")
                }
                .font(.subheadline)
                .foregroundColor(DesignTokens.textSecondary)
            }
            .frame(maxWidth: .infinity)
        }
    }

    // MARK: - Action Buttons

    private var actionButtons: some View {
        VStack(spacing: 0) {
            Divider()

            HStack(spacing: 12) {
                // Back button (except on first step)
                if currentStep != .basics {
                    Button {
                        withAnimation {
                            if let prev = PoemWizardStep(rawValue: currentStep.rawValue - 1) {
                                currentStep = prev
                            }
                        }
                    } label: {
                        HStack {
                            Image(systemName: "chevron.left")
                                .accessibilityHidden(true)
                            Text("Back")
                        }
                        .font(.subheadline.weight(.medium))
                        .foregroundColor(DesignTokens.textSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(DesignTokens.cardBackground)
                        .cornerRadius(12)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(DesignTokens.cardBorder, lineWidth: 1)
                        )
                    }
                    .frame(maxWidth: 100)
                }

                // Primary button
                Button {
                    primaryAction()
                } label: {
                    HStack {
                        if isGenerating {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .white))
                        } else {
                            Text(primaryButtonTitle)
                        }
                    }
                    .font(.headline)
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(canProceed ? DesignTokens.rose : DesignTokens.textTertiary)
                    .cornerRadius(12)
                }
                .disabled(!canProceed || isGenerating)
            }
            .padding()
            .background(DesignTokens.background)
        }
    }

    private var primaryButtonTitle: String {
        switch currentStep {
        case .basics, .tone, .message:
            return "Continue"
        case .preview:
            return "Save Poem"
        }
    }

    private var canProceed: Bool {
        switch currentStep {
        case .basics:
            return !recipientName.trimmingCharacters(in: .whitespaces).isEmpty
        case .tone:
            return true
        case .message:
            return true
        case .preview:
            return generatedPoem != nil && !isGenerating
        }
    }

    private func primaryAction() {
        switch currentStep {
        case .basics, .tone, .message:
            withAnimation {
                if let next = PoemWizardStep(rawValue: currentStep.rawValue + 1) {
                    currentStep = next
                }
            }
        case .preview:
            if let poem = generatedPoem {
                onComplete(poem)
            }
        }
    }

    // MARK: - API

    private func generatePoem() {
        isGenerating = true
        errorMessage = nil

        Task {
            do {
                let poemTitle = title.isEmpty ? "For \(recipientName)" : title

                let request = CreatePoemRequest(
                    title: poemTitle,
                    recipientName: recipientName,
                    occasion: selectedOccasion.rawValue,
                    tone: selectedTone.rawValue,
                    message: personalMessage,
                    memoryAnswers: nil
                )

                let poem = try await apiClient.createPoem(request: request)

                await MainActor.run {
                    generatedPoem = poem
                    isGenerating = false
                }
            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    showError = true
                    isGenerating = false
                }
            }
        }
    }
}

#Preview {
    PoemWizardView(
        apiClient: APIClient(baseURL: "http://localhost:3000"),
        onComplete: { _ in },
        onCancel: { }
    )
}
