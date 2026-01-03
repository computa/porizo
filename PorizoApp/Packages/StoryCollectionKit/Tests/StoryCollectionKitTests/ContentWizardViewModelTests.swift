//
//  ContentWizardViewModelTests.swift
//  StoryCollectionKitTests
//
//  Tests for ContentWizardViewModel.
//

import XCTest
@testable import StoryCollectionKit

// MARK: - Mock Question Provider

final class MockQuestionProvider: QuestionProvider, @unchecked Sendable {
    var questionsToReturn: [ContentQuestion] = []
    var shouldThrowError: Bool = false
    var generateQuestionsCallCount: Int = 0
    var lastContentReceived: String = ""
    var lastOccasionReceived: String?
    var lastRecipientNameReceived: String?

    func generateQuestions(
        currentContent: String,
        contentType: ContentType,
        occasion: String?,
        recipientName: String?
    ) async throws -> [ContentQuestion] {
        generateQuestionsCallCount += 1
        lastContentReceived = currentContent
        lastOccasionReceived = occasion
        lastRecipientNameReceived = recipientName

        if shouldThrowError {
            throw NSError(domain: "MockError", code: 1, userInfo: nil)
        }

        return questionsToReturn
    }
}

// MARK: - ViewModel Tests

@MainActor
final class ContentWizardViewModelTests: XCTestCase {
    var mockProvider: MockQuestionProvider!
    var completedResult: ContentCollectionResult?
    var wasCancelled: Bool = false

    override func setUp() async throws {
        mockProvider = MockQuestionProvider()
        completedResult = nil
        wasCancelled = false
    }

    private func createViewModel(config: WizardConfig = .song) -> ContentWizardViewModel {
        ContentWizardViewModel(
            questionProvider: mockProvider,
            config: config,
            onComplete: { [weak self] result in
                self?.completedResult = result
            },
            onCancel: { [weak self] in
                self?.wasCancelled = true
            }
        )
    }

    // MARK: - Initialization Tests

    func testInitialState() {
        let vm = createViewModel()

        XCTAssertEqual(vm.currentStep, .basics)
        XCTAssertFalse(vm.isSubmitting)
        XCTAssertFalse(vm.isCancelled)
        XCTAssertNil(vm.result)
        XCTAssertEqual(vm.context.recipientName, "")
    }

    func testInitialContextHasDefaultSelections() {
        let vm = createViewModel()

        XCTAssertEqual(vm.context.selectedOccasionId, "birthday") // First occasion
        XCTAssertEqual(vm.context.selectedStyleId, "pop") // First style
    }

    // MARK: - Navigation Tests

    func testCannotProceedWithoutRecipientName() {
        let vm = createViewModel()

        XCTAssertFalse(vm.canProceed)
    }

    func testCanProceedWithRecipientName() {
        let vm = createViewModel()
        vm.setRecipientName("Mom")

        XCTAssertTrue(vm.canProceed)
    }

    func testNextStepMovesToStory() {
        let vm = createViewModel()
        vm.setRecipientName("Mom")
        vm.nextStep()

        XCTAssertEqual(vm.currentStep, .story)
    }

    func testNextStepBlockedWithoutRecipientName() {
        let vm = createViewModel()
        vm.nextStep()

        XCTAssertEqual(vm.currentStep, .basics, "Should remain on basics")
    }

    func testPreviousStepFromStory() {
        let vm = createViewModel()
        vm.setRecipientName("Mom")
        vm.nextStep()
        XCTAssertEqual(vm.currentStep, .story)

        vm.previousStep()
        XCTAssertEqual(vm.currentStep, .basics)
    }

    func testGoToCompletedStep() {
        let vm = createViewModel()
        vm.setRecipientName("Mom")
        vm.nextStep() // Go to story

        // Add enough content to proceed
        // Manually set story content for testing
        vm.setStoryContent("This is enough content to meet the minimum length requirement.")
        vm.nextStep() // Go to preview

        XCTAssertEqual(vm.currentStep, .preview)

        // Should be able to go back to completed steps
        vm.goToStep(.basics)
        XCTAssertEqual(vm.currentStep, .basics)
    }

    // MARK: - Basics Step Tests

    func testSetRecipientName() {
        let vm = createViewModel()
        vm.setRecipientName("Dad")

        XCTAssertEqual(vm.context.recipientName, "Dad")
    }

    func testSetOccasion() {
        let vm = createViewModel()
        vm.setOccasion("anniversary")

        XCTAssertEqual(vm.context.selectedOccasionId, "anniversary")
    }

    func testSetStyle() {
        let vm = createViewModel()
        vm.setStyle("jazz")

        XCTAssertEqual(vm.context.selectedStyleId, "jazz")
    }

    func testRandomizeStyle() {
        let vm = createViewModel()
        let initialStyle = vm.context.selectedStyleId

        // Run multiple times to ensure it can change
        var changed = false
        for _ in 0..<20 {
            vm.randomizeStyle()
            if vm.context.selectedStyleId != initialStyle {
                changed = true
                break
            }
        }

        // With 16 styles, probability of staying same 20 times is very low
        XCTAssertTrue(changed || vm.wizardConfig.styles.count == 1)
    }

    // MARK: - Story Step Tests

    func testFetchNextQuestionSuccess() async {
        let vm = createViewModel()
        mockProvider.questionsToReturn = [
            ContentQuestion(id: "q1", question: "What's your favorite memory?", placeholder: "Tell us...")
        ]

        vm.fetchNextQuestion()

        // Wait for async operation
        try? await Task.sleep(nanoseconds: 100_000_000) // 0.1 seconds

        XCTAssertEqual(mockProvider.generateQuestionsCallCount, 1)
        XCTAssertNotNil(vm.context.currentQuestion)
        XCTAssertEqual(vm.context.currentQuestion?.id, "q1")
        XCTAssertFalse(vm.context.isLoadingQuestion)
        XCTAssertNil(vm.context.questionError)
    }

    func testFetchNextQuestionError() async {
        let vm = createViewModel()
        mockProvider.shouldThrowError = true

        vm.fetchNextQuestion()

        // Wait for async operation
        try? await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertNotNil(vm.context.questionError)
        XCTAssertFalse(vm.context.isLoadingQuestion)
    }

    func testFetchNextQuestionNoMoreQuestions() async {
        let vm = createViewModel()
        mockProvider.questionsToReturn = [] // Empty

        vm.fetchNextQuestion()

        try? await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertFalse(vm.context.hasMoreQuestions)
        XCTAssertNil(vm.context.currentQuestion)
    }

    func testSetCurrentAnswer() {
        let vm = createViewModel()
        vm.setCurrentAnswer("My answer here")

        XCTAssertEqual(vm.context.currentAnswer, "My answer here")
    }

    func testFinishQuestions() {
        let vm = createViewModel()
        vm.finishQuestions()

        XCTAssertFalse(vm.context.hasMoreQuestions)
        XCTAssertNil(vm.context.currentQuestion)
    }

    // MARK: - Preview Step Tests

    func testSetStoryContent() {
        let vm = createViewModel()
        vm.setStoryContent("Updated story content")

        XCTAssertEqual(vm.context.storyContent, "Updated story content")
    }

    func testSetSpecialPhrases() {
        let vm = createViewModel()
        vm.setSpecialPhrases("Sunshine")

        XCTAssertEqual(vm.context.specialPhrases, "Sunshine")
    }

    func testSetWhatMakesThemSpecial() {
        let vm = createViewModel()
        vm.setWhatMakesThemSpecial("Their amazing smile")

        XCTAssertEqual(vm.context.whatMakesThemSpecial, "Their amazing smile")
    }

    // MARK: - Completion Tests

    func testSubmitFromPreviewCallsOnComplete() {
        let vm = createViewModel()

        // Navigate to preview
        vm.setRecipientName("Mom")
        vm.setOccasion("birthday")
        vm.setStyle("pop")
        vm.nextStep()

        vm.setStoryContent("This is my story about Mom and all the wonderful things she does.")
        vm.nextStep()

        XCTAssertEqual(vm.currentStep, .preview)

        // Submit
        vm.submit()

        XCTAssertNotNil(completedResult)
        XCTAssertEqual(completedResult?.recipientName, "Mom")
        XCTAssertEqual(completedResult?.occasionId, "birthday")
        XCTAssertEqual(completedResult?.styleId, "pop")
        XCTAssertEqual(completedResult?.contentType, .song)
    }

    func testCancelCallsOnCancel() {
        let vm = createViewModel()
        vm.cancel()

        XCTAssertTrue(wasCancelled)
        XCTAssertTrue(vm.isCancelled)
    }

    // MARK: - Binding Tests

    func testRecipientNameBinding() {
        let vm = createViewModel()

        vm.recipientNameBinding.wrappedValue = "Sister"

        XCTAssertEqual(vm.context.recipientName, "Sister")
    }

    func testCurrentAnswerBinding() {
        let vm = createViewModel()

        vm.currentAnswerBinding.wrappedValue = "My answer"

        XCTAssertEqual(vm.context.currentAnswer, "My answer")
    }

    // MARK: - Poem Configuration Tests

    func testPoemConfigHasTones() {
        let vm = createViewModel(config: .poem)

        XCTAssertEqual(vm.wizardConfig.contentType, .poem)
        XCTAssertEqual(vm.wizardConfig.styleLabel, "Tone")
        XCTAssertTrue(vm.wizardConfig.styles.contains { $0.id == "heartfelt" })
    }

    func testActionButtonText() {
        let vm = createViewModel()

        XCTAssertEqual(vm.actionButtonText, "Continue")

        vm.setRecipientName("Mom")
        vm.nextStep()

        XCTAssertEqual(vm.actionButtonText, "Answer questions first")

        vm.setStoryContent("Story content here that is long enough")
        XCTAssertEqual(vm.actionButtonText, "Preview Song")
    }
}
