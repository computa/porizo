//
//  WizardState.swift
//  StoryCollectionKit
//
//  State types for the wizard state machine.
//

import Foundation

/// The three steps of the content wizard
public enum WizardStep: Int, CaseIterable, Sendable, Equatable {
    case basics = 0   // Who + Occasion + Style
    case story = 1    // AI-powered Q&A
    case preview = 2  // Review and extras
}

/// Actions that can be dispatched to the wizard
public enum WizardAction: Sendable, Equatable {
    // Navigation
    case nextStep
    case previousStep
    case goToStep(WizardStep)

    // Basics step
    case setRecipientName(String)
    case setOccasion(String)
    case setStyle(String)

    // Story step
    case startLoadingQuestion
    case questionLoaded(ContentQuestion)
    case questionLoadFailed(String)
    case setCurrentAnswer(String)
    case submitAnswer
    case skipQuestion
    case finishQuestions

    // Preview step
    case setStoryContent(String)
    case setSpecialPhrases(String)
    case setWhatMakesThemSpecial(String)

    // Completion
    case submit
    case cancel
}

/// The current context/data of the wizard
public struct WizardContext: Sendable, Equatable {
    // Basics
    public var recipientName: String = ""
    public var selectedOccasionId: String = ""
    public var selectedStyleId: String = ""

    // Story
    public var storyContent: String = ""
    public var currentAnswer: String = ""
    public var currentQuestion: ContentQuestion? = nil
    public var answers: [ContentAnswer] = []
    public var hasMoreQuestions: Bool = true

    // Preview extras
    public var specialPhrases: String = ""
    public var whatMakesThemSpecial: String = ""

    // Loading/error states
    public var isLoadingQuestion: Bool = false
    public var questionError: String? = nil

    public init() {}

    /// Creates initial context with default selections from config
    public static func initial(with config: WizardConfig) -> WizardContext {
        var context = WizardContext()
        context.selectedOccasionId = config.occasions.first?.id ?? ""
        context.selectedStyleId = config.styles.first?.id ?? ""
        return context
    }
}

/// The overall state of the wizard
public enum WizardState: Sendable, Equatable {
    case active(step: WizardStep, context: WizardContext)
    case submitting(context: WizardContext)
    case completed(ContentCollectionResult)
    case cancelled
}
