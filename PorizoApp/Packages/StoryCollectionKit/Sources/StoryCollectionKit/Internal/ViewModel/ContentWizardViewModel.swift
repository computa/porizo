//
//  ContentWizardViewModel.swift
//  StoryCollectionKit
//
//  Main ViewModel for the content wizard.
//  Coordinates between the UI and the pure state machine.
//

import Foundation
import SwiftUI

/// Main ViewModel for the content collection wizard.
/// Handles UI state, async operations, and delegates logic to WizardReducer.
@MainActor
public final class ContentWizardViewModel: ObservableObject {
    // MARK: - Published State

    /// Current wizard step
    @Published public private(set) var currentStep: WizardStep = .basics

    /// All form data and state
    @Published public private(set) var context: WizardContext

    /// Whether the wizard is in a submitting state
    @Published public private(set) var isSubmitting: Bool = false

    /// Whether the wizard has been cancelled
    @Published public private(set) var isCancelled: Bool = false

    /// The final result (set when completed)
    @Published public private(set) var result: ContentCollectionResult?

    // MARK: - Dependencies

    private let questionProvider: QuestionProvider
    private let config: WizardConfig
    private let reducer: WizardReducer

    // MARK: - Callbacks

    private let onComplete: (ContentCollectionResult) -> Void
    private let onCancel: () -> Void

    // MARK: - Initialization

    public init(
        questionProvider: QuestionProvider,
        config: WizardConfig,
        onComplete: @escaping (ContentCollectionResult) -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.questionProvider = questionProvider
        self.config = config
        self.reducer = WizardReducer(config: config)
        self.onComplete = onComplete
        self.onCancel = onCancel
        self.context = WizardContext.initial(with: config)
    }

    // MARK: - Public Properties

    /// The wizard configuration
    public var wizardConfig: WizardConfig { config }

    /// Whether the user can proceed to the next step
    public var canProceed: Bool {
        reducer.canProceed(from: currentStep, context: context)
    }

    /// Text for the action button
    public var actionButtonText: String {
        reducer.actionButtonText(for: currentStep, context: context)
    }

    // MARK: - Navigation Actions

    /// Move to the next step
    public func nextStep() {
        let state = WizardState.active(step: currentStep, context: context)
        applyState(reducer.reduce(state: state, action: .nextStep))
    }

    /// Move to the previous step
    public func previousStep() {
        let state = WizardState.active(step: currentStep, context: context)
        applyState(reducer.reduce(state: state, action: .previousStep))
    }

    /// Go to a specific step (only completed or current)
    public func goToStep(_ step: WizardStep) {
        let state = WizardState.active(step: currentStep, context: context)
        applyState(reducer.reduce(state: state, action: .goToStep(step)))
    }

    // MARK: - Basics Step Actions

    /// Update recipient name
    public func setRecipientName(_ name: String) {
        let state = WizardState.active(step: currentStep, context: context)
        applyState(reducer.reduce(state: state, action: .setRecipientName(name)))
    }

    /// Update selected occasion
    public func setOccasion(_ occasionId: String) {
        let state = WizardState.active(step: currentStep, context: context)
        applyState(reducer.reduce(state: state, action: .setOccasion(occasionId)))
    }

    /// Update selected style
    public func setStyle(_ styleId: String) {
        let state = WizardState.active(step: currentStep, context: context)
        applyState(reducer.reduce(state: state, action: .setStyle(styleId)))
    }

    /// Select a random style
    public func randomizeStyle() {
        if let randomStyle = config.styles.randomElement() {
            setStyle(randomStyle.id)
        }
    }

    // MARK: - Story Step Actions

    /// Fetch the next AI-generated question
    public func fetchNextQuestion() {
        // Mark as loading
        var state = WizardState.active(step: currentStep, context: context)
        state = reducer.reduce(state: state, action: .startLoadingQuestion)
        applyState(state)

        Task {
            do {
                let questions = try await questionProvider.generateQuestions(
                    currentContent: context.storyContent,
                    contentType: config.contentType,
                    occasion: context.selectedOccasionId,
                    recipientName: context.recipientName.isEmpty ? nil : context.recipientName
                )

                if let firstQuestion = questions.first {
                    let loadedState = reducer.reduce(
                        state: WizardState.active(step: currentStep, context: context),
                        action: .questionLoaded(firstQuestion)
                    )
                    applyState(loadedState)
                } else {
                    // No more questions - mark as finished
                    let finishedState = reducer.reduce(
                        state: WizardState.active(step: currentStep, context: context),
                        action: .finishQuestions
                    )
                    applyState(finishedState)
                }
            } catch {
                let errorState = reducer.reduce(
                    state: WizardState.active(step: currentStep, context: context),
                    action: .questionLoadFailed("Couldn't generate question. Please try again.")
                )
                applyState(errorState)
                print("Question generation error: \(error)")
            }
        }
    }

    /// Update the current answer text
    public func setCurrentAnswer(_ answer: String) {
        let state = WizardState.active(step: currentStep, context: context)
        applyState(reducer.reduce(state: state, action: .setCurrentAnswer(answer)))
    }

    /// Submit the current answer and fetch next question
    public func submitAnswer() {
        let state = WizardState.active(step: currentStep, context: context)
        let newState = reducer.reduce(state: state, action: .submitAnswer)
        applyState(newState)

        // If the reducer set isLoadingQuestion, fetch the next question
        if context.isLoadingQuestion {
            fetchNextQuestion()
        }
    }

    /// Skip the current question
    public func skipQuestion() {
        let state = WizardState.active(step: currentStep, context: context)
        let newState = reducer.reduce(state: state, action: .skipQuestion)
        applyState(newState)

        // Fetch next question
        if context.isLoadingQuestion {
            fetchNextQuestion()
        }
    }

    /// Mark question answering as complete
    public func finishQuestions() {
        let state = WizardState.active(step: currentStep, context: context)
        applyState(reducer.reduce(state: state, action: .finishQuestions))
    }

    // MARK: - Preview Step Actions

    /// Update story content (for editing)
    public func setStoryContent(_ content: String) {
        let state = WizardState.active(step: currentStep, context: context)
        applyState(reducer.reduce(state: state, action: .setStoryContent(content)))
    }

    /// Update special phrases
    public func setSpecialPhrases(_ phrases: String) {
        let state = WizardState.active(step: currentStep, context: context)
        applyState(reducer.reduce(state: state, action: .setSpecialPhrases(phrases)))
    }

    /// Update what makes them special
    public func setWhatMakesThemSpecial(_ text: String) {
        let state = WizardState.active(step: currentStep, context: context)
        applyState(reducer.reduce(state: state, action: .setWhatMakesThemSpecial(text)))
    }

    // MARK: - Completion Actions

    /// Submit the wizard and create the content
    public func submit() {
        let state = WizardState.active(step: currentStep, context: context)
        let newState = reducer.reduce(state: state, action: .submit)

        if case .submitting(let ctx) = newState {
            isSubmitting = true
            let finalResult = reducer.buildResult(from: ctx)
            result = finalResult
            onComplete(finalResult)
        }
    }

    /// Cancel the wizard
    public func cancel() {
        isCancelled = true
        onCancel()
    }

    // MARK: - Private Helpers

    private func applyState(_ state: WizardState) {
        switch state {
        case .active(let step, let ctx):
            currentStep = step
            context = ctx
            isSubmitting = false

        case .submitting(let ctx):
            context = ctx
            isSubmitting = true

        case .completed(let res):
            result = res
            isSubmitting = false

        case .cancelled:
            isCancelled = true
        }
    }
}

// MARK: - Convenience Bindings

extension ContentWizardViewModel {
    /// Binding for recipient name text field
    public var recipientNameBinding: Binding<String> {
        Binding(
            get: { self.context.recipientName },
            set: { self.setRecipientName($0) }
        )
    }

    /// Binding for current answer text field
    public var currentAnswerBinding: Binding<String> {
        Binding(
            get: { self.context.currentAnswer },
            set: { self.setCurrentAnswer($0) }
        )
    }

    /// Binding for story content text area
    public var storyContentBinding: Binding<String> {
        Binding(
            get: { self.context.storyContent },
            set: { self.setStoryContent($0) }
        )
    }

    /// Binding for special phrases text field
    public var specialPhrasesBinding: Binding<String> {
        Binding(
            get: { self.context.specialPhrases },
            set: { self.setSpecialPhrases($0) }
        )
    }

    /// Binding for what makes them special text field
    public var whatMakesThemSpecialBinding: Binding<String> {
        Binding(
            get: { self.context.whatMakesThemSpecial },
            set: { self.setWhatMakesThemSpecial($0) }
        )
    }
}
