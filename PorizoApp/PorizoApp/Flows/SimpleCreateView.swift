//
//  SimpleCreateView.swift
//  PorizoApp
//
//  Focused story input screen (Screen 2 of Create Flow).
//  Clean interface for gathering the user's story with contextual prompts.
//  Velvet & Gold design system.
//

import SwiftUI

struct SimpleCreateView: View {
    let recipientName: String
    let occasion: Occasion
    let isInstrumental: Bool
    let hasOwnLyrics: Bool
    let onContinue: (String) -> Void  // Passes the story description
    let onBack: () -> Void
    let onCancel: () -> Void

    // Content kind (song vs poem) affects labels
    var contentKind: CreateContentKind = .song

    @State private var storyDescription: String = ""
    @State private var showSpeechInput: Bool = false
    @Environment(APIClientWrapper.self) private var apiWrapper

    private var prompts: [OccasionPrompts.PromptChip] {
        OccasionPrompts.prompts(for: occasion)
    }

    private var inputPrompt: String {
        OccasionPrompts.inputPrompt(for: occasion, recipientName: recipientName)
    }

    private var headerTitle: String {
        OccasionPrompts.headerTitle(for: recipientName)
    }

    private var canContinue: Bool {
        !storyDescription.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var storyPromptCount: Int {
        storyDescription.count
    }

    private var storyPromptBudgetState: BudgetState {
        StoryPromptBudget.state(
            count: storyPromptCount,
            warningThreshold: StoryPromptBudget.initialPromptWarningThreshold,
            hardLimit: StoryPromptBudget.initialPromptHardLimit
        )
    }

    private var storyPromptHint: String {
        switch storyPromptBudgetState {
        case .normal:
            return "Share as much detail as you need. We condense for reasoning without dropping key facts."
        case .warning:
            return "Long story detected. We'll condense intelligently while preserving key details."
        case .over:
            return "This is very long. Consider trimming repetitive parts for faster processing."
        }
    }

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header
                headerSection

                // Scrollable content
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        // Title with sparkles
                        titleSection

                        // Main text area
                        storyTextArea

                        // Prompt chips
                        promptChipsSection

                        Spacer(minLength: 120)
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 16)
                }
                .scrollIndicators(.hidden)

                // Bottom bar
                bottomBar
            }
        }
        .fullScreenCover(isPresented: $showSpeechInput) {
            SpeechInputView(
                storyId: nil,  // No story created yet in Simple flow - uses on-device STT only
                onTranscription: { text in
                    applySpeechTranscription(text)
                    showSpeechInput = false
                },
                onCancel: {
                    showSpeechInput = false
                }
            )
        }
    }

    // MARK: - Header

    private var headerSection: some View {
        HStack {
            // Back button
            Button {
                onBack()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(DesignTokens.surface)
                    .clipShape(Circle())
            }

            Spacer()

            // Mode indicator
            Text("Simple")
                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                .foregroundStyle(DesignTokens.gold)

            Spacer()

            // Close button
            Button {
                onCancel()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(DesignTokens.surface)
                    .clipShape(Circle())
            }
        }
        .padding(.horizontal, 20)
        .frame(height: 56)
    }

    // MARK: - Title Section

    private var titleSection: some View {
        HStack(spacing: 8) {
            Image(systemName: "sparkles")
                .font(.system(size: 20))
                .foregroundStyle(DesignTokens.gold)

            Text(headerTitle)
                .font(DesignTokens.displayFont(size: 22, weight: .semibold))
                .foregroundStyle(DesignTokens.textPrimary)
        }
        .padding(.top, 8)
    }

    // MARK: - Story Text Area

    private var storyTextArea: some View {
        VStack(alignment: .leading, spacing: 8) {
            ZStack(alignment: .topLeading) {
                if storyDescription.isEmpty {
                    Text(inputPrompt)
                        .font(DesignTokens.bodyFont(size: 16))
                        .foregroundStyle(DesignTokens.textTertiary)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 16)
                }

                TextEditor(text: $storyDescription)
                    .font(DesignTokens.bodyFont(size: 16))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .scrollContentBackground(.hidden)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 12)
                    .tint(DesignTokens.gold)
            }
            .frame(minHeight: 140)
            .background(DesignTokens.inputBackground)
            .clipShape(.rect(cornerRadius: 14))

            HStack(spacing: 8) {
                Text(storyPromptHint)
                    .font(DesignTokens.bodyFont(size: 12))
                    .foregroundStyle(storyPromptBudgetState.color)
                Spacer()
                Text("\(storyPromptCount)/\(StoryPromptBudget.initialPromptHardLimit)")
                    .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                    .foregroundStyle(storyPromptBudgetState.color)
            }
        }
    }

    // MARK: - Prompt Chips Section

    private var promptChipsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Label
            HStack(spacing: 6) {
                Image(systemName: "lightbulb")
                    .font(.system(size: 14))
                    .foregroundStyle(DesignTokens.gold)
                Text("Try these:")
                    .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                    .foregroundStyle(DesignTokens.textSecondary)
            }

            // Chips in a flow layout
            FlowLayout(spacing: 8) {
                ForEach(prompts) { prompt in
                    promptChip(prompt)
                }
            }
        }
    }

    private func promptChip(_ prompt: OccasionPrompts.PromptChip) -> some View {
        Button {
            insertPrompt(prompt)
        } label: {
            Text(prompt.label)
                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                .foregroundStyle(DesignTokens.textPrimary)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(DesignTokens.surface)
                .clipShape(.rect(cornerRadius: 20))
                .overlay(
                    RoundedRectangle(cornerRadius: 20)
                        .stroke(DesignTokens.borderSubtle, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }

    private func insertPrompt(_ prompt: OccasionPrompts.PromptChip) {
        // If text area is empty or only whitespace, replace with prompt
        // Otherwise, append on new line
        let trimmed = storyDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            storyDescription = prompt.fullPrompt
        } else {
            storyDescription = trimmed + "\n\n" + prompt.fullPrompt
        }
    }

    private func applySpeechTranscription(_ text: String) {
        storyDescription = text
        if text.count > StoryPromptBudget.initialPromptHardLimit {
            ToastService.shared.warning("Voice input is very long. Consider trimming repetition for faster processing.")
        } else if text.count >= StoryPromptBudget.initialPromptWarningThreshold {
            ToastService.shared.info("Long story detected. We will condense for reasoning while keeping key details.")
        }
    }

    // MARK: - Bottom Bar

    private var bottomBar: some View {
        HStack(spacing: 12) {
            // Mic button
            Button {
                showSpeechInput = true
            } label: {
                Image(systemName: "mic.fill")
                    .font(.system(size: 24))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .frame(width: 56, height: 56)
                    .background(DesignTokens.surface)
                    .clipShape(.rect(cornerRadius: 28))
            }

            // Continue button
            Button {
                onContinue(storyDescription)
            } label: {
                HStack(spacing: 8) {
                    Text("Continue")
                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    Image(systemName: "arrow.right")
                        .font(.system(size: 14, weight: .semibold))
                }
                .foregroundStyle(canContinue ? DesignTokens.background : DesignTokens.background.opacity(0.6))
                .frame(maxWidth: .infinity)
                .frame(height: 56)
                .background(canContinue ? DesignTokens.gold : DesignTokens.gold.opacity(0.4))
                .clipShape(.rect(cornerRadius: 28))
            }
            .disabled(!canContinue)
        }
        .padding(.horizontal, 20)
        .padding(.top, 16)
        .padding(.bottom, 34)
        .background(DesignTokens.background)
    }
}

// MARK: - Preview

#Preview {
    SimpleCreateView(
        recipientName: "Sarah",
        occasion: .birthday,
        isInstrumental: false,
        hasOwnLyrics: false,
        onContinue: { _ in },
        onBack: { },
        onCancel: { }
    )
    .environment(APIClientWrapper(client: APIClient(baseURL: AppConfig.apiBaseURL)))
}
