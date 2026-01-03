//
//  WizardReducer.swift
//  StoryCollectionKit
//
//  Pure function state machine for wizard logic.
//  100% unit testable with no side effects.
//

import Foundation

/// Pure reducer for wizard state transitions.
/// All logic is deterministic and testable.
public struct WizardReducer: Sendable {
    private let config: WizardConfig

    public init(config: WizardConfig) {
        self.config = config
    }

    /// Reduce an action into a new state
    /// - Parameters:
    ///   - state: Current wizard state
    ///   - action: Action to apply
    /// - Returns: New wizard state
    public func reduce(state: WizardState, action: WizardAction) -> WizardState {
        switch state {
        case .active(let step, var context):
            return reduceActive(step: step, context: &context, action: action)

        case .submitting:
            // Cannot dispatch actions while submitting
            return state

        case .completed, .cancelled:
            // Terminal states - no further transitions
            return state
        }
    }

    private func reduceActive(step: WizardStep, context: inout WizardContext, action: WizardAction) -> WizardState {
        switch action {
        // MARK: - Navigation
        case .nextStep:
            guard canProceed(from: step, context: context) else {
                return .active(step: step, context: context)
            }
            if let nextStep = WizardStep(rawValue: step.rawValue + 1) {
                return .active(step: nextStep, context: context)
            }
            return .active(step: step, context: context)

        case .previousStep:
            if let prevStep = WizardStep(rawValue: step.rawValue - 1) {
                return .active(step: prevStep, context: context)
            }
            return .active(step: step, context: context)

        case .goToStep(let targetStep):
            // Only allow going to completed steps or current step
            if targetStep.rawValue <= step.rawValue {
                return .active(step: targetStep, context: context)
            }
            return .active(step: step, context: context)

        // MARK: - Basics Step
        case .setRecipientName(let name):
            context.recipientName = name
            return .active(step: step, context: context)

        case .setOccasion(let occasionId):
            context.selectedOccasionId = occasionId
            return .active(step: step, context: context)

        case .setStyle(let styleId):
            context.selectedStyleId = styleId
            return .active(step: step, context: context)

        // MARK: - Story Step
        case .startLoadingQuestion:
            context.isLoadingQuestion = true
            context.questionError = nil
            return .active(step: step, context: context)

        case .questionLoaded(let question):
            context.isLoadingQuestion = false
            context.currentQuestion = question
            context.questionError = nil
            return .active(step: step, context: context)

        case .questionLoadFailed(let error):
            context.isLoadingQuestion = false
            context.questionError = error
            return .active(step: step, context: context)

        case .setCurrentAnswer(let answer):
            context.currentAnswer = answer
            return .active(step: step, context: context)

        case .submitAnswer:
            guard let question = context.currentQuestion else {
                return .active(step: step, context: context)
            }
            let trimmedAnswer = context.currentAnswer.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmedAnswer.isEmpty else {
                return .active(step: step, context: context)
            }

            // Create and store the answer
            let answer = ContentAnswer(
                questionId: question.id,
                question: question.question,
                answer: trimmedAnswer
            )
            context.answers.append(answer)

            // Append to story content
            if context.storyContent.isEmpty {
                context.storyContent = trimmedAnswer
            } else {
                context.storyContent += "\n\n" + trimmedAnswer
            }

            // Clear for next question
            context.currentAnswer = ""
            context.currentQuestion = nil
            context.isLoadingQuestion = true // Signal to fetch next question

            return .active(step: step, context: context)

        case .skipQuestion:
            context.currentAnswer = ""
            context.currentQuestion = nil
            context.isLoadingQuestion = true // Signal to fetch next question
            return .active(step: step, context: context)

        case .finishQuestions:
            context.hasMoreQuestions = false
            context.currentQuestion = nil
            context.currentAnswer = ""
            return .active(step: step, context: context)

        // MARK: - Preview Step
        case .setStoryContent(let content):
            context.storyContent = content
            return .active(step: step, context: context)

        case .setSpecialPhrases(let phrases):
            context.specialPhrases = phrases
            return .active(step: step, context: context)

        case .setWhatMakesThemSpecial(let text):
            context.whatMakesThemSpecial = text
            return .active(step: step, context: context)

        // MARK: - Completion
        case .submit:
            guard step == .preview else {
                return .active(step: step, context: context)
            }
            return .submitting(context: context)

        case .cancel:
            return .cancelled
        }
    }

    // MARK: - Validation

    /// Check if the user can proceed from the current step
    public func canProceed(from step: WizardStep, context: WizardContext) -> Bool {
        switch step {
        case .basics:
            return !context.recipientName.trimmingCharacters(in: .whitespaces).isEmpty

        case .story:
            return context.storyContent.trimmingCharacters(in: .whitespaces).count >= config.minContentLength

        case .preview:
            return true
        }
    }

    /// Build the final result from the context
    public func buildResult(from context: WizardContext) -> ContentCollectionResult {
        ContentCollectionResult(
            contentType: config.contentType,
            recipientName: context.recipientName,
            occasionId: context.selectedOccasionId,
            styleId: context.selectedStyleId,
            storyContent: context.storyContent,
            answers: context.answers,
            specialPhrases: context.specialPhrases.isEmpty ? nil : context.specialPhrases,
            whatMakesThemSpecial: context.whatMakesThemSpecial.isEmpty ? nil : context.whatMakesThemSpecial
        )
    }

    /// Get the action button text for the current step
    public func actionButtonText(for step: WizardStep, context: WizardContext) -> String {
        switch step {
        case .basics:
            return "Continue"
        case .story:
            return context.storyContent.isEmpty ? "Answer questions first" : "Preview \(config.contentType.displayName)"
        case .preview:
            return "Create My \(config.contentType.displayName)"
        }
    }
}
