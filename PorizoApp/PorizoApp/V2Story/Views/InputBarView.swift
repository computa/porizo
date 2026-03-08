//
//  InputBarView.swift
//  PorizoApp
//
//  Isolated input bar for chat screen. Owns all typing-related state
//  (inputText, focus, budget) so keystrokes don't trigger parent reevaluation.
//

import SwiftUI

struct InputBarView: View {
    var engine: V2StoryEngine
    var onSubmit: (String) -> Void
    var onSpeechInput: () -> Void
    var onFinishEarly: () -> Void
    var onExitReviewEdit: () -> Void

    /// Parent sets this when speech transcription arrives; InputBarView consumes it.
    @Binding var pendingSpeechText: String?

    /// Exposes focus state so parent can hide suggestion chips while keyboard is active.
    @Binding var isInputActive: Bool

    @State private var inputText: String = ""
    @FocusState private var isInputFocused: Bool

    private var inputCharacterCount: Int { inputText.count }

    private var inputBudgetState: BudgetState {
        StoryPromptBudget.state(
            count: inputCharacterCount,
            warningThreshold: StoryPromptBudget.storyAnswerWarningThreshold,
            hardLimit: StoryPromptBudget.storyAnswerHardLimit
        )
    }

    private var canSendInput: Bool {
        !inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !engine.isLoading
            && !engine.isComplete
            && inputCharacterCount <= StoryPromptBudget.storyAnswerHardLimit
    }

    private var inputBudgetHint: String {
        if engine.isEditingFromReview {
            return "Be explicit about what changed, what was wrong, or what you want added."
        }
        switch inputBudgetState {
        case .normal:
            return "Keep responses concise for best results."
        case .warning:
            return "Long response detected. We condense for reasoning while preserving key details."
        case .over:
            return "Please shorten this response before sending."
        }
    }

    private var inputBudgetColor: Color { inputBudgetState.color }

    private var inputPlaceholder: String {
        engine.isEditingFromReview
            ? "Tell me what to change or add..."
            : "Share your thoughts..."
    }

    var body: some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(DesignTokens.borderSubtle)
                .frame(height: 1)

            VStack(spacing: 12) {
                // Text input row
                HStack(spacing: 12) {
                    TextField(inputPlaceholder, text: $inputText, axis: .vertical)
                        .textFieldStyle(.plain)
                        .font(DesignTokens.bodyFont(size: 16))
                        .foregroundColor(DesignTokens.textPrimary)
                        .tint(DesignTokens.gold)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(DesignTokens.inputBackground)
                        .clipShape(RoundedRectangle(cornerRadius: 20))
                        .overlay(
                            RoundedRectangle(cornerRadius: 20)
                                .strokeBorder(DesignTokens.borderSubtle, lineWidth: 1)
                        )
                        .focused($isInputFocused)
                        .lineLimit(1...4)

                    // Microphone button for speech input
                    if !engine.isLoading {
                        Button {
                            onSpeechInput()
                        } label: {
                            Image(systemName: "mic.fill")
                                .font(.system(size: 20))
                                .foregroundColor(DesignTokens.gold)
                                .frame(width: 44, height: 44)
                        }
                        .buttonStyle(.plain)
                    }

                    // Send button
                    Button {
                        submitAnswer()
                    } label: {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 32))
                            .foregroundColor(canSendInput ? DesignTokens.gold : DesignTokens.borderSubtle)
                    }
                    .disabled(!canSendInput)
                }

                HStack(spacing: 8) {
                    Text(inputBudgetHint)
                        .font(DesignTokens.bodyFont(size: 12))
                        .foregroundColor(inputBudgetColor)
                    Spacer()
                    Text("\(inputCharacterCount)/\(StoryPromptBudget.storyAnswerHardLimit)")
                        .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                        .foregroundColor(inputBudgetColor)
                }

                // "I'm done sharing" / "Return to review" escape button
                if engine.currentTurn >= 2 {
                    Button {
                        if engine.isEditingFromReview {
                            onExitReviewEdit()
                        } else {
                            onFinishEarly()
                        }
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: engine.isEditingFromReview
                                  ? "arrow.uturn.left.circle.fill"
                                  : "checkmark.circle.fill")
                                .font(.system(size: 18, weight: .semibold))
                            Text(engine.isEditingFromReview
                                 ? "Return to review"
                                 : "I'm done sharing")
                                .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                        }
                        .foregroundColor(DesignTokens.gold)
                        .padding(.vertical, 10)
                        .padding(.horizontal, 16)
                        .background(DesignTokens.gold.opacity(0.12))
                        .cornerRadius(20)
                    }
                    .disabled(engine.isLoading)
                    .opacity(engine.isLoading ? 0.4 : 1.0)
                    .padding(.top, 8)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(DesignTokens.surface)
        }
        .onChange(of: isInputFocused) { _, focused in
            isInputActive = focused
        }
        .onChange(of: pendingSpeechText) { _, newValue in
            guard let text = newValue else { return }
            pendingSpeechText = nil
            inputText = text
            isInputFocused = true
            if text.count > StoryPromptBudget.storyAnswerHardLimit {
                ToastService.shared.warning("Voice response is very long. Please trim before sending.")
            } else if text.count >= StoryPromptBudget.storyAnswerWarningThreshold {
                ToastService.shared.info("Voice response is long. We condense for reasoning while preserving key details.")
            }
        }
    }

    // MARK: - Actions

    private func submitAnswer() {
        guard !inputText.isEmpty, !engine.isLoading else { return }

        let generator = UIImpactFeedbackGenerator(style: .medium)
        generator.impactOccurred()

        let trimmedInput = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedInput.isEmpty else { return }

        if trimmedInput.count > StoryPromptBudget.storyAnswerHardLimit {
            ToastService.shared.warning("Response is too long. Please trim it before sending.")
            return
        }

        let answer = trimmedInput
        inputText = ""
        isInputFocused = false
        onSubmit(answer)
    }
}
