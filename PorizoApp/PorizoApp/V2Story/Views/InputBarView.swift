//
//  InputBarView.swift
//  PorizoApp
//
//  Isolated input bar for chat screen. Owns all typing-related state
//  (inputText, focus, budget) so keystrokes don't trigger parent reevaluation.
//
//  Perplexity-style floating container: full-width text area on top,
//  compact action row below, all inside a 24pt rounded card that
//  floats above the background using Warm Canvas design tokens.
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

    private func logInputEvent(_ event: String) {
        print(
            "[InputBar] \(event) " +
            "storyId=\(engine.storyId ?? "nil") " +
            "isLoading=\(engine.isLoading) " +
            "isComplete=\(engine.isComplete) " +
            "isReviewing=\(engine.isEditingFromReview) " +
            "chars=\(inputText.count)"
        )
    }

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
            && inputCharacterCount <= StoryPromptBudget.storyAnswerHardLimit
    }

    private var inputPlaceholder: String {
        engine.isEditingFromReview
            ? "Tell me what to change or add..."
            : "Tell me more..."
    }

    var body: some View {
        VStack(spacing: 8) {
            // Budget warning — above the container, only when threshold exceeded
            if inputBudgetState != .normal {
                BudgetWarningView(state: inputBudgetState)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }

            // Done chip — available when the draft is complete or materially reviewable.
            if engine.canOfferUserFinish {
                HStack {
                    DoneChipView(
                        isReviewMode: engine.isEditingFromReview,
                        isLoading: engine.isLoading,
                        action: handleDoneAction
                    )
                    Spacer()
                }
                .padding(.horizontal, 16)
            }

            // Floating two-part container (matching the current Warm Canvas chat treatment)
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
                    // Show character count only when approaching the limit (5200+)
                    if inputCharacterCount >= 5200 {
                        BudgetChipView(
                            count: inputCharacterCount,
                            limit: StoryPromptBudget.storyAnswerHardLimit,
                            state: inputBudgetState
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
        .padding(.top, 8)
        .background(DesignTokens.surfaceMuted)
        .overlay(alignment: .top) {
            Rectangle().fill(DesignTokens.border).frame(height: 1)
        }
        .sensoryFeedback(.impact(weight: .medium), trigger: submitHapticTrigger)
        .animation(.easeInOut(duration: 0.2), value: inputBudgetState)
        .onChange(of: isInputFocused) { _, focused in
            isInputActive = focused
            logInputEvent("focus -> \(focused)")
        }
        .onChange(of: pendingSpeechText) { _, newValue in
            guard let text = newValue else { return }
            pendingSpeechText = nil
            inputText = text
            isInputFocused = true
            logInputEvent("pendingSpeechText consumed chars=\(text.count)")
            if text.count > StoryPromptBudget.storyAnswerHardLimit {
                ToastService.shared.warning("Voice response is very long. Please trim before sending.")
            } else if text.count >= StoryPromptBudget.storyAnswerWarningThreshold {
                ToastService.shared.info("Voice response is long. We condense for reasoning while preserving key details.")
            }
        }
        .onAppear {
            logInputEvent("appear")
        }
        .onDisappear {
            logInputEvent("disappear")
        }
    }

    // MARK: - Actions

    private func handleDoneAction() {
        logInputEvent("doneTapped")
        if engine.isEditingFromReview {
            callbacks.onExitReviewEdit()
        } else {
            callbacks.onFinishEarly()
        }
    }

    private func submitAnswer() {
        let trimmedInput = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedInput.isEmpty, !engine.isLoading else { return }
        logInputEvent("submitTapped trimmedChars=\(trimmedInput.count)")

        submitHapticTrigger.toggle()

        if trimmedInput.count > StoryPromptBudget.storyAnswerHardLimit {
            ToastService.shared.warning("Response is too long. Please trim it before sending.")
            return
        }

        inputText = ""
        isInputFocused = false
        callbacks.onSubmit(trimmedInput)
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
            HStack(spacing: 6) {
                Image(systemName: isReviewMode
                      ? "arrow.uturn.left.circle.fill"
                      : "checkmark.circle.fill")
                    .font(.system(size: 16, weight: .semibold))
                Text(isReviewMode ? "Return" : "Done — ready to create")
                    .font(DesignTokens.bodyFont(size: 14, weight: .semibold))
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(DesignTokens.gold)
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(isLoading)
        .opacity(isLoading ? 0.4 : 1.0)
        .accessibilityLabel(isReviewMode ? "Return to review" : "Finish sharing — ready to create")
    }
}
