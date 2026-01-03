//
//  PoemWizardView.swift
//  PorizoApp
//
//  Guided wizard for creating personalized poems.
//  Uses same card-based design with tab navigation and horizontal pill selectors.
//

import SwiftUI

// MARK: - Poem Context

/// The complete context gathered from the poem wizard
struct PoemContext {
    let recipientName: String
    let occasion: Occasion
    let tone: PoemTone
    let topic: String
    let specialPhrases: String?
    let whatMakesThemSpecial: String?
}

// MARK: - Poem Wizard View

/// The main poem wizard that guides users through creating a personalized poem
struct PoemWizardView: View {
    let apiClient: APIClient
    let onComplete: (PoemContext) -> Void
    let onCancel: () -> Void

    // MARK: - Wizard State

    @State private var currentStep: Int = 0

    // Step 0: Who
    @State private var recipientName = ""

    // Step 1: Occasion
    @State private var selectedOccasion: Occasion = .birthday

    // Step 2: Tone
    @State private var selectedTone: PoemTone = .heartfelt

    // Step 3: Topic
    @State private var topic = ""

    // Step 4: Extras
    @State private var specialPhrases = ""
    @State private var whatMakesThemSpecial = ""

    // Error handling
    @State private var showingError = false
    @State private var errorMessage = ""

    private let steps = ["Who", "Occasion", "Tone", "Topic", "Extras"]

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // Step tabs
                WizardStepTabs(
                    steps: steps,
                    currentStep: currentStep,
                    onStepTap: { step in
                        withAnimation {
                            currentStep = step
                        }
                    }
                )

                // Step content
                ScrollView {
                    stepContent
                        .padding(16)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(DesignTokens.backgroundSubtle)

                // Bottom action button
                actionButton
            }
            .navigationTitle("Create Poem")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        onCancel()
                    }
                    .foregroundColor(DesignTokens.textSecondary)
                }
            }
            .alert("Error", isPresented: $showingError) {
                Button("OK") { }
            } message: {
                Text(errorMessage)
            }
        }
    }

    // MARK: - Step Content

    @ViewBuilder
    private var stepContent: some View {
        switch currentStep {
        case 0:
            whoStep
        case 1:
            occasionStep
        case 2:
            toneStep
        case 3:
            topicStep
        case 4:
            extrasStep
        default:
            EmptyView()
        }
    }

    // MARK: - Step 0: Who

    private var whoStep: some View {
        VStack(spacing: 20) {
            WizardInputCard(
                title: "Who is this poem for?",
                subtitle: "Enter the name or nickname of the person"
            ) {
                CharacterCountTextField(
                    placeholder: "e.g., Mom, My love, Best friend Jake",
                    text: $recipientName,
                    maxLength: 40
                )
            }

            Spacer()
        }
    }

    // MARK: - Step 1: Occasion

    private var occasionStep: some View {
        VStack(spacing: 20) {
            WizardInputCard(
                title: "What's the occasion?",
                subtitle: "Choose the moment you're celebrating"
            ) {
                HorizontalPillSelector(
                    items: Occasion.allCases,
                    selection: $selectedOccasion,
                    labelProvider: { $0.displayName },
                    emojiProvider: { $0.emoji }
                )
            }

            // Occasion preview
            VStack(spacing: 8) {
                Text(selectedOccasion.emoji)
                    .font(.system(size: 48))

                Text(selectedOccasion.displayName)
                    .font(.headline)
                    .foregroundColor(.white)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 32)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(occasionGradient(for: selectedOccasion))
            )

            Spacer()
        }
    }

    // MARK: - Step 2: Tone

    private var toneStep: some View {
        VStack(spacing: 20) {
            WizardInputCard(
                title: "Choose a tone",
                subtitle: "Set the mood for your poem"
            ) {
                HorizontalPillSelector(
                    items: PoemTone.allCases,
                    selection: $selectedTone,
                    labelProvider: { $0.displayName }
                )
            }

            // Tone preview card
            VStack(spacing: 12) {
                Image(systemName: toneIcon(for: selectedTone))
                    .font(.system(size: 40))
                    .foregroundColor(DesignTokens.rose)

                Text(selectedTone.displayName)
                    .font(.title3)
                    .fontWeight(.semibold)
                    .foregroundColor(DesignTokens.textPrimary)

                Text(selectedTone.description)
                    .font(.caption)
                    .foregroundColor(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(24)
            .background(DesignTokens.cardBackground)
            .cornerRadius(16)
            .cardShadow()

            Spacer()
        }
    }

    // MARK: - Step 3: Topic

    private var topicStep: some View {
        VStack(spacing: 20) {
            WizardInputCard(
                title: "What's this poem about?",
                subtitle: "A memory, feeling, or message you want to express"
            ) {
                CharacterCountTextField(
                    placeholder: "e.g., How you always believed in me, Our first dance together",
                    text: $topic,
                    maxLength: 200,
                    minHeight: 100
                )
            }

            // Example topics
            WizardInputCard(title: "Examples") {
                VStack(alignment: .leading, spacing: 8) {
                    exampleTopicRow("💝", "How you always believed in me")
                    exampleTopicRow("🌟", "The strength you gave me through hard times")
                    exampleTopicRow("🏠", "All the little things you do that mean so much")
                }
            }

            Spacer()
        }
    }

    private func exampleTopicRow(_ emoji: String, _ text: String) -> some View {
        HStack(spacing: 12) {
            Text(emoji)
                .font(.title3)
            Text(text)
                .font(.subheadline)
                .foregroundColor(DesignTokens.textSecondary)
                .italic()
        }
    }

    // MARK: - Step 4: Extras

    private var extrasStep: some View {
        VStack(spacing: 20) {
            WizardInputCard(
                title: "Any nicknames or inside jokes?",
                subtitle: "Optional - These will be woven into the poem"
            ) {
                CharacterCountTextField(
                    placeholder: "e.g., Sunshine, My rock, Partner in crime",
                    text: $specialPhrases,
                    maxLength: 100
                )
            }

            WizardInputCard(
                title: "What makes \(recipientName.isEmpty ? "them" : recipientName) special?",
                subtitle: "Optional - Add that personal touch"
            ) {
                CharacterCountTextField(
                    placeholder: "e.g., Their laugh fills every room, They never gave up on me",
                    text: $whatMakesThemSpecial,
                    maxLength: 150,
                    minHeight: 80
                )
            }

            // Summary card
            WizardInputCard(title: "Your Poem Summary") {
                VStack(alignment: .leading, spacing: 12) {
                    summaryRow("For", recipientName)
                    summaryRow("Occasion", "\(selectedOccasion.emoji) \(selectedOccasion.displayName)")
                    summaryRow("Tone", selectedTone.displayName)
                    summaryRow("Topic", String(topic.prefix(50)) + (topic.count > 50 ? "..." : ""))
                }
            }

            Spacer()
        }
    }

    private func summaryRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
                .font(.caption)
                .foregroundColor(DesignTokens.textSecondary)
                .frame(width: 60, alignment: .leading)

            Text(value)
                .font(.subheadline)
                .foregroundColor(DesignTokens.textPrimary)

            Spacer()
        }
    }

    // MARK: - Action Button

    private var actionButton: some View {
        Button {
            if currentStep == steps.count - 1 {
                createPoem()
            } else {
                goNext()
            }
        } label: {
            HStack {
                if currentStep == steps.count - 1 {
                    Image(systemName: "text.book.closed.fill")
                    Text("Create My Poem")
                } else {
                    Text("Continue")
                    Image(systemName: "arrow.right")
                }
            }
            .font(.headline)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(canProceed ? DesignTokens.rose : DesignTokens.textTertiary)
            .foregroundColor(.white)
            .cornerRadius(14)
        }
        .disabled(!canProceed)
        .padding(16)
        .background(DesignTokens.cardBackground)
    }

    // MARK: - Navigation Logic

    private var canProceed: Bool {
        switch currentStep {
        case 0:
            return !recipientName.trimmingCharacters(in: .whitespaces).isEmpty
        case 1, 2:
            return true
        case 3:
            return topic.trimmingCharacters(in: .whitespaces).count >= 10
        case 4:
            return true
        default:
            return true
        }
    }

    private func goNext() {
        if currentStep < steps.count - 1 {
            withAnimation {
                currentStep += 1
            }
        }
    }

    // MARK: - Create Poem

    private func createPoem() {
        let context = PoemContext(
            recipientName: recipientName,
            occasion: selectedOccasion,
            tone: selectedTone,
            topic: topic,
            specialPhrases: specialPhrases.isEmpty ? nil : specialPhrases,
            whatMakesThemSpecial: whatMakesThemSpecial.isEmpty ? nil : whatMakesThemSpecial
        )

        onComplete(context)
    }

    // MARK: - Helpers

    private func occasionGradient(for occasion: Occasion) -> LinearGradient {
        let colors: [Color]
        switch occasion {
        case .birthday:
            colors = [Color(hex: "#ec4899"), Color(hex: "#f472b6")]
        case .anniversary:
            colors = [Color(hex: "#f43f5e"), Color(hex: "#fb7185")]
        case .thankYou:
            colors = [Color(hex: "#f59e0b"), Color(hex: "#fbbf24")]
        case .iLoveYou:
            colors = [Color(hex: "#ef4444"), Color(hex: "#f87171")]
        case .wedding:
            colors = [Color(hex: "#a855f7"), Color(hex: "#c084fc")]
        case .graduation:
            colors = [Color(hex: "#3b82f6"), Color(hex: "#60a5fa")]
        case .encouragement:
            colors = [Color(hex: "#10b981"), Color(hex: "#34d399")]
        case .apology:
            colors = [Color(hex: "#6366f1"), Color(hex: "#818cf8")]
        case .celebration:
            colors = [Color(hex: "#06b6d4"), Color(hex: "#22d3ee")]
        case .custom:
            colors = [DesignTokens.rose, DesignTokens.roseLight]
        }
        return LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    private func toneIcon(for tone: PoemTone) -> String {
        switch tone {
        case .heartfelt: return "heart.fill"
        case .playful: return "face.smiling.fill"
        case .formal: return "crown.fill"
        case .poetic: return "sparkles"
        case .simple: return "doc.text"
        case .rhyming: return "waveform"
        case .freeVerse: return "wind"
        }
    }
}

#Preview {
    PoemWizardView(
        apiClient: APIClient(baseURL: "http://localhost:3000"),
        onComplete: { context in
            print("Poem context: \(context)")
        },
        onCancel: { }
    )
}
