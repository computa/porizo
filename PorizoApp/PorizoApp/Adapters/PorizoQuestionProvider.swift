//
//  PorizoQuestionProvider.swift
//  PorizoApp
//
//  Adapter that bridges PorizoApp's APIClient to StoryCollectionKit's QuestionProvider protocol.
//  This allows the standalone module to generate questions without knowing about PorizoApp's networking.
//

import Foundation
import StoryCollectionKit

/// Adapts PorizoApp's APIClient to StoryCollectionKit's QuestionProvider protocol.
///
/// Usage:
/// ```swift
/// let provider = PorizoQuestionProvider(apiClient: apiClient)
/// ContentWizardCoordinator(questionProvider: provider, config: .song, ...)
/// ```
struct PorizoQuestionProvider: QuestionProvider {
    private let apiClient: APIClient

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    func generateQuestions(
        currentContent: String,
        contentType: ContentType,
        occasion: String?,
        recipientName: String?
    ) async throws -> [ContentQuestion] {
        // API requires at least 5 characters - use placeholder for initial question
        let trimmedContent = currentContent.trimmingCharacters(in: .whitespacesAndNewlines)
        let effectiveContent = trimmedContent.count >= 5 ? trimmedContent : "Starting a new \(contentType.rawValue)"

        // Call the existing API endpoint
        let response = try await apiClient.generateMemoryQuestions(
            memory: effectiveContent,
            occasion: occasion,
            recipientName: recipientName
        )

        // Map from PorizoApp's MemoryQuestion to StoryCollectionKit's ContentQuestion
        return response.questions.map { memoryQuestion in
            ContentQuestion(
                id: memoryQuestion.id,
                question: memoryQuestion.question,
                placeholder: memoryQuestion.placeholder
            )
        }
    }
}
