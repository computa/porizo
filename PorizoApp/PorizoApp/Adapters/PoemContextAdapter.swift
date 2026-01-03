//
//  PoemContextAdapter.swift
//  PorizoApp
//
//  Maps StoryCollectionKit's ContentCollectionResult to PorizoApp's PoemContext.
//  This allows gradual migration - the rest of the app continues using PoemContext.
//

import Foundation
import StoryCollectionKit

extension PoemContext {
    /// Creates a PoemContext from a ContentCollectionResult.
    ///
    /// Maps the module's generic output to the app's specific domain types.
    init(from result: ContentCollectionResult) {
        // Map occasionId string to Occasion enum
        let occasion = Occasion(rawValue: result.occasionId) ?? .birthday

        // Map styleId string to PoemTone enum
        let tone = PoemTone(rawValue: result.styleId) ?? .heartfelt

        self.init(
            recipientName: result.recipientName,
            occasion: occasion,
            tone: tone,
            topic: result.storyContent,
            specialPhrases: result.specialPhrases,
            whatMakesThemSpecial: result.whatMakesThemSpecial
        )
    }
}
