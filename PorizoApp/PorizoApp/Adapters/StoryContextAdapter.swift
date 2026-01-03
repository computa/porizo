//
//  StoryContextAdapter.swift
//  PorizoApp
//
//  Maps StoryCollectionKit's ContentCollectionResult to PorizoApp's StoryContext.
//  This allows gradual migration - the rest of the app continues using StoryContext.
//

import Foundation
import StoryCollectionKit

extension StoryContext {
    /// Creates a StoryContext from a ContentCollectionResult.
    ///
    /// Maps the module's generic output to the app's specific domain types.
    init(from result: ContentCollectionResult) {
        // Map occasionId string to Occasion enum
        let occasion = Occasion(rawValue: result.occasionId) ?? .birthday

        // Map styleId string to MusicStyle enum
        let style = MusicStyle(rawValue: result.styleId) ?? .pop

        // Map ContentAnswers to MemoryAnswers
        let memoryAnswers = result.answers.map { answer in
            MemoryAnswer(
                questionId: answer.questionId,
                question: answer.question,
                answer: answer.answer
            )
        }

        self.init(
            recipientName: result.recipientName,
            occasion: occasion,
            specificMemory: result.storyContent,
            memoryAnswers: memoryAnswers,
            specialPhrases: result.specialPhrases,
            whatMakesThemSpecial: result.whatMakesThemSpecial,
            style: style
        )
    }
}
