//
//  ContentAnswer.swift
//  StoryCollectionKit
//
//  Represents a user's answer to an AI-generated question.
//

import Foundation

/// A user's answer to an AI-generated question
public struct ContentAnswer: Sendable, Equatable, Hashable, Codable {
    public let questionId: String
    public let question: String
    public let answer: String

    public init(questionId: String, question: String, answer: String) {
        self.questionId = questionId
        self.question = question
        self.answer = answer
    }

    enum CodingKeys: String, CodingKey {
        case questionId = "question_id"
        case question
        case answer
    }
}
