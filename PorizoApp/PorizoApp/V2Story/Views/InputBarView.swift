//
//  InputBarView.swift
//  PorizoApp
//
//  Isolated input bar for chat screen. Owns all typing-related state
//  (inputText, focus, budget) so keystrokes don't trigger parent reevaluation.
//
//  Perplexity-style floating container: full-width text area on top (#1E1E1E),
//  compact action row below (#161616), all inside a 24pt rounded card that
//  floats above the #0A0A0A background.
//

import SwiftUI

struct InputBarCallbacks {
    let onSubmit: (String) -> Void
    let onSpeechInput: () -> Void
    let onFinishEarly: () -> Void
    let onExitReviewEdit: () -> Void
}

struct InputBarView: View {
    var engine: V2StoryEngine
    var callbacks: InputBarCallbacks

    /// Parent sets this when speech transcription arrives; InputBarView consumes it.
    @Binding var pendingSpeechText: String?

    /// Exposes focus state so parent can hide suggestion chips while keyboard is active.
    @Binding var isInputActive: Bool

    @State private var inputText: String = ""
    @State private var submitHapticTrigger = false
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

    private var inputPlaceholder: String {
        engine.isEditingFromReview
            ? "Tell me what to change or add..."
            : "Share your thoughts..."
    }

    var body: some View {
        VStack(spacing: 8) {
            // Budget warning — above the container, only when threshold exceeded
            if inputBudgetState != .normal {
                BudgetWarningView(state: inputBudgetState)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }

            // Floating container
            FloatingInputContainer {
                TextField(inputPlaceholder, text: $inputText, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(DesignTokens.bodyFont(size: 16))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .tint(DesignTokens.gold)
                    .focused($isInputFocused)
                    .lineLimit(1...6)
            } actionRow: {
                HStack(spacing: 8) {
                    BudgetChipView(
                        count: inputCharacterCount,
                        limit: StoryPromptBudget.storyAnswerHardLimit,
                        state: inputBudgetState
                    )

                    if engine.currentTurn >= 2 {
                        DoneChipView(
                            isReviewMode: engine.isEditingFromReview,
                            isLoading: engine.isLoading,
                            action: handleDoneAction
                        )
                    }

                    Spacer()

                    MicButtonView(action: callbacks.onSpeechInput)
                        .opacity(engine.isLoading ? 0.3 : 1.0)
                        .disabled(engine.isLoading)

                    SendButtonView(
                        canSend: canSendInput,
                        action: submitAnswer
                    )
                }
            }
        }
        .background(DesignTokens.background)
        .sensoryFeedback(.impact(weight: .medium), trigger: submitHapticTrigger)
        .animation(.easeInOut(duration: 0.2), value: inputBudgetState)
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

    private func handleDoneAction() {
        if engine.isEditingFromReview {
            callbacks.onExitReviewEdit()
        } else {
            callbacks.onFinishEarly()
        }
    }

    private func submitAnswer() {
        let trimmedInput = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedInput.isEmpty, !engine.isLoading else { return }

        submitHapticTrigger.toggle()

        if trimmedInput.count > StoryPromptBudget.storyAnswerHardLimit {
            ToastService.shared.warning("Response is too long. Please trim it before sending.")
            return
        }

        let answer = trimmedInput
        inputText = ""
        isInputFocused = false
        callbacks.onSubmit(answer)
    }
}

// MARK: - Extracted Subviews

private struct BudgetWarningView: View {
    let state: BudgetState

    var body: some View {
        HStack(spacing: 6) {
            Text(state == .over ? "⛔" : "⚠")
                .font(.system(size: 13))
            Text(state == .over
                 ? "Please shorten this response before sending."
                 : "Long response. We condense for reasoning while preserving key details.")
                .font(DesignTokens.bodyFont(size: 12))
                .foregroundStyle(state.color)
        }
        .padding(.horizontal, 4)
    }
}

private struct BudgetChipView: View {
    let count: Int
    let limit: Int
    let state: BudgetState

    var body: some View {
        Text("\(count)/\(limit)")
            .font(DesignTokens.bodyFont(size: 12, weight: .medium))
            .foregroundStyle(state.color)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(chipBackground)
            .clipShape(Capsule())
            .accessibilityLabel("\(count) of \(limit) characters used")
    }

    private var chipBackground: Color {
        switch state {
        case .normal: .clear
        case .warning: DesignTokens.gold.opacity(0.08)
        case .over: DesignTokens.error.opacity(0.1)
        }
    }
}

private struct DoneChipView: View {
    let isReviewMode: Bool
    let isLoading: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: isReviewMode
                      ? "arrow.uturn.left.circle.fill"
                      : "checkmark.circle.fill")
                    .font(.system(size: 12, weight: .semibold))
                Text(isReviewMode ? "Return" : "Done")
                    .font(DesignTokens.bodyFont(size: 12, weight: .semibold))
            }
            .foregroundStyle(DesignTokens.gold)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(DesignTokens.gold.opacity(0.1))
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(isLoading)
        .opacity(isLoading ? 0.4 : 1.0)
        .accessibilityLabel(isReviewMode ? "Return to review" : "Finish sharing")
    }
}

