//
//  QuestionProvider.swift
//  StoryCollectionKit
//
//  Protocol for AI question generation.
//  The consuming app implements this to provide its own AI/API integration.
//

import Foundation

/// Protocol for generating contextual questions based on accumulated story content.
///
/// The consuming application implements this protocol to integrate their own
/// AI/API for generating relevant follow-up questions.
///
/// Example implementation:
/// ```swift
/// struct PorizoQuestionProvider: QuestionProvider {
///     let apiClient: APIClient
///
///     func generateQuestions(
///         currentContent: String,
///         contentType: ContentType,
///         occasion: String?,
///         recipientName: String?
///     ) async throws -> [ContentQuestion] {
///         let response = try await apiClient.generateMemoryQuestions(
///             memory: currentContent,
///             occasion: occasion,
///             recipientName: recipientName
///         )
///         return response.questions.map {
///             ContentQuestion(id: $0.id, question: $0.question, placeholder: $0.placeholder)
///         }
///     }
/// }
/// ```
public protocol QuestionProvider: Sendable {
    /// Generate contextual questions based on the current story content.
    ///
    /// - Parameters:
    ///   - currentContent: The accumulated story content so far
    ///   - contentType: Whether this is for a song or poem
    ///   - occasion: The occasion ID (e.g., "birthday", "anniversary")
    ///   - recipientName: The name of the person the content is for
    /// - Returns: An array of questions to ask next (typically 1-3)
    /// - Throws: Any error from the underlying API/AI service
    func generateQuestions(
        currentContent: String,
        contentType: ContentType,
        occasion: String?,
        recipientName: String?
    ) async throws -> [ContentQuestion]
}
