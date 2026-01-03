//
//  ContentCollectionResult.swift
//  StoryCollectionKit
//
//  The final output of the wizard containing all collected content.
//

import Foundation

/// The complete result from the content collection wizard
/// Contains everything needed to create a song or poem
public struct ContentCollectionResult: Sendable, Equatable {
    /// The type of content created (.song or .poem)
    public let contentType: ContentType

    /// Name of the person this content is for
    public let recipientName: String

    /// The occasion ID (e.g., "birthday", "anniversary")
    public let occasionId: String

    /// Style ID - music style for songs, tone for poems
    public let styleId: String

    /// The accumulated story content from all answers
    public let storyContent: String

    /// All question/answer pairs from the Q&A flow
    public let answers: [ContentAnswer]

    /// Optional nicknames or inside jokes to weave in
    public let specialPhrases: String?

    /// Optional description of what makes the recipient special
    public let whatMakesThemSpecial: String?

    public init(
        contentType: ContentType,
        recipientName: String,
        occasionId: String,
        styleId: String,
        storyContent: String,
        answers: [ContentAnswer],
        specialPhrases: String? = nil,
        whatMakesThemSpecial: String? = nil
    ) {
        self.contentType = contentType
        self.recipientName = recipientName
        self.occasionId = occasionId
        self.styleId = styleId
        self.storyContent = storyContent
        self.answers = answers
        self.specialPhrases = specialPhrases
        self.whatMakesThemSpecial = whatMakesThemSpecial
    }
}
