//
//  WizardReducerTests.swift
//  StoryCollectionKitTests
//
//  Tests for the WizardReducer state machine.
//

import XCTest
@testable import StoryCollectionKit

final class WizardReducerTests: XCTestCase {
    var reducer: WizardReducer!

    override func setUp() {
        super.setUp()
        reducer = WizardReducer(config: .song)
    }

    // MARK: - Validation Tests

    func testCannotProceedWithEmptyRecipientName() {
        var context = WizardContext.initial(with: .song)
        context.recipientName = ""

        XCTAssertFalse(reducer.canProceed(from: .basics, context: context))
    }

    func testCanProceedWithRecipientName() {
        var context = WizardContext.initial(with: .song)
        context.recipientName = "Mom"

        XCTAssertTrue(reducer.canProceed(from: .basics, context: context))
    }

    func testCannotProceedFromStoryWithInsufficientContent() {
        var context = WizardContext.initial(with: .song)
        context.storyContent = "Short"

        XCTAssertFalse(reducer.canProceed(from: .story, context: context))
    }

    func testCanProceedFromStoryWithSufficientContent() {
        var context = WizardContext.initial(with: .song)
        context.storyContent = "This is a longer story that meets the minimum length requirement for proceeding."

        XCTAssertTrue(reducer.canProceed(from: .story, context: context))
    }

    func testAlwaysCanProceedFromPreview() {
        let context = WizardContext.initial(with: .song)
        XCTAssertTrue(reducer.canProceed(from: .preview, context: context))
    }

    // MARK: - Navigation Tests

    func testNextStepFromBasicsToStory() {
        var context = WizardContext.initial(with: .song)
        context.recipientName = "Mom"
        let state = WizardState.active(step: .basics, context: context)

        let newState = reducer.reduce(state: state, action: .nextStep)

        if case .active(let step, _) = newState {
            XCTAssertEqual(step, .story)
        } else {
            XCTFail("Expected active state")
        }
    }

    func testNextStepBlockedWithoutRecipientName() {
        let context = WizardContext.initial(with: .song)
        let state = WizardState.active(step: .basics, context: context)

        let newState = reducer.reduce(state: state, action: .nextStep)

        if case .active(let step, _) = newState {
            XCTAssertEqual(step, .basics, "Should remain on basics step")
        } else {
            XCTFail("Expected active state")
        }
    }

    func testPreviousStepFromStoryToBasics() {
        let context = WizardContext.initial(with: .song)
        let state = WizardState.active(step: .story, context: context)

        let newState = reducer.reduce(state: state, action: .previousStep)

        if case .active(let step, _) = newState {
            XCTAssertEqual(step, .basics)
        } else {
            XCTFail("Expected active state")
        }
    }

    // MARK: - Answer Submission Tests

    func testSubmitAnswerAppendsToStory() {
        var context = WizardContext.initial(with: .song)
        context.currentQuestion = ContentQuestion(
            id: "q1",
            question: "What's your favorite memory?",
            placeholder: "Tell us about it..."
        )
        context.currentAnswer = "The day we went to the beach together."
        let state = WizardState.active(step: .story, context: context)

        let newState = reducer.reduce(state: state, action: .submitAnswer)

        if case .active(_, let newContext) = newState {
            XCTAssertEqual(newContext.storyContent, "The day we went to the beach together.")
            XCTAssertEqual(newContext.answers.count, 1)
            XCTAssertEqual(newContext.answers.first?.answer, "The day we went to the beach together.")
            XCTAssertEqual(newContext.currentAnswer, "")
            XCTAssertNil(newContext.currentQuestion)
            XCTAssertTrue(newContext.isLoadingQuestion, "Should signal to load next question")
        } else {
            XCTFail("Expected active state")
        }
    }

    func testSubmitMultipleAnswersAppendsToStory() {
        var context = WizardContext.initial(with: .song)
        context.storyContent = "First answer content."
        context.currentQuestion = ContentQuestion(
            id: "q2",
            question: "What else?",
            placeholder: "..."
        )
        context.currentAnswer = "Second answer content."
        let state = WizardState.active(step: .story, context: context)

        let newState = reducer.reduce(state: state, action: .submitAnswer)

        if case .active(_, let newContext) = newState {
            XCTAssertEqual(newContext.storyContent, "First answer content.\n\nSecond answer content.")
        } else {
            XCTFail("Expected active state")
        }
    }

    func testSubmitEmptyAnswerIsIgnored() {
        var context = WizardContext.initial(with: .song)
        context.currentQuestion = ContentQuestion(id: "q1", question: "Test?", placeholder: "")
        context.currentAnswer = "   " // Whitespace only
        let state = WizardState.active(step: .story, context: context)

        let newState = reducer.reduce(state: state, action: .submitAnswer)

        if case .active(_, let newContext) = newState {
            XCTAssertEqual(newContext.answers.count, 0, "Should not add empty answer")
        } else {
            XCTFail("Expected active state")
        }
    }

    // MARK: - Completion Tests

    func testSubmitFromPreviewEntersSubmittingState() {
        var context = WizardContext.initial(with: .song)
        context.recipientName = "Mom"
        context.storyContent = "Story content here."
        let state = WizardState.active(step: .preview, context: context)

        let newState = reducer.reduce(state: state, action: .submit)

        if case .submitting = newState {
            // Success
        } else {
            XCTFail("Expected submitting state")
        }
    }

    func testSubmitFromNonPreviewIsIgnored() {
        let context = WizardContext.initial(with: .song)
        let state = WizardState.active(step: .story, context: context)

        let newState = reducer.reduce(state: state, action: .submit)

        if case .active(let step, _) = newState {
            XCTAssertEqual(step, .story, "Should remain on story step")
        } else {
            XCTFail("Expected active state")
        }
    }

    func testCancelReturnsCancelledState() {
        let context = WizardContext.initial(with: .song)
        let state = WizardState.active(step: .basics, context: context)

        let newState = reducer.reduce(state: state, action: .cancel)

        if case .cancelled = newState {
            // Success
        } else {
            XCTFail("Expected cancelled state")
        }
    }

    // MARK: - Build Result Tests

    func testBuildResultCreatesCorrectOutput() {
        var context = WizardContext.initial(with: .song)
        context.recipientName = "Mom"
        context.selectedOccasionId = "birthday"
        context.selectedStyleId = "pop"
        context.storyContent = "My story content"
        context.answers = [
            ContentAnswer(questionId: "q1", question: "Q1?", answer: "A1")
        ]
        context.specialPhrases = "Sunshine"
        context.whatMakesThemSpecial = "Her smile"

        let result = reducer.buildResult(from: context)

        XCTAssertEqual(result.contentType, .song)
        XCTAssertEqual(result.recipientName, "Mom")
        XCTAssertEqual(result.occasionId, "birthday")
        XCTAssertEqual(result.styleId, "pop")
        XCTAssertEqual(result.storyContent, "My story content")
        XCTAssertEqual(result.answers.count, 1)
        XCTAssertEqual(result.specialPhrases, "Sunshine")
        XCTAssertEqual(result.whatMakesThemSpecial, "Her smile")
    }

    func testBuildResultOmitsEmptyOptionals() {
        var context = WizardContext.initial(with: .song)
        context.recipientName = "Dad"
        context.storyContent = "Content"
        context.specialPhrases = ""
        context.whatMakesThemSpecial = ""

        let result = reducer.buildResult(from: context)

        XCTAssertNil(result.specialPhrases)
        XCTAssertNil(result.whatMakesThemSpecial)
    }
}
