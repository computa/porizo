//
//  WizardConfig.swift
//  StoryCollectionKit
//
//  Configuration for the content wizard.
//  Allows customizing occasions, styles, and validation rules.
//

import Foundation

/// An occasion option for the wizard (e.g., Birthday, Anniversary)
public struct OccasionOption: Sendable, Identifiable, Equatable, Hashable {
    public let id: String
    public let displayName: String
    public let emoji: String

    public init(id: String, displayName: String, emoji: String) {
        self.id = id
        self.displayName = displayName
        self.emoji = emoji
    }
}

/// A style option for the wizard (music style for songs, tone for poems)
public struct StyleOption: Sendable, Identifiable, Equatable, Hashable {
    public let id: String
    public let displayName: String

    public init(id: String, displayName: String) {
        self.id = id
        self.displayName = displayName
    }
}

/// Configuration for the content collection wizard
public struct WizardConfig: Sendable {
    /// The type of content being created
    public let contentType: ContentType

    /// Available occasions to choose from
    public let occasions: [OccasionOption]

    /// Available styles (music styles for songs, tones for poems)
    public let styles: [StyleOption]

    /// Minimum story content length required to proceed
    public let minContentLength: Int

    /// Maximum story content length allowed
    public let maxContentLength: Int

    /// Title shown in the navigation bar
    public let title: String

    /// Label for the style selector (e.g., "Music Style" or "Tone")
    public let styleLabel: String

    public init(
        contentType: ContentType,
        occasions: [OccasionOption],
        styles: [StyleOption],
        minContentLength: Int = 20,
        maxContentLength: Int = 2000,
        title: String,
        styleLabel: String
    ) {
        self.contentType = contentType
        self.occasions = occasions
        self.styles = styles
        self.minContentLength = minContentLength
        self.maxContentLength = maxContentLength
        self.title = title
        self.styleLabel = styleLabel
    }
}

// MARK: - Preset Configurations

extension WizardConfig {
    /// Default configuration for song creation
    public static let song = WizardConfig(
        contentType: .song,
        occasions: OccasionOption.defaultOccasions,
        styles: StyleOption.musicStyles,
        minContentLength: 20,
        maxContentLength: 2000,
        title: "Create Song",
        styleLabel: "Music Style"
    )

    /// Default configuration for poem creation
    public static let poem = WizardConfig(
        contentType: .poem,
        occasions: OccasionOption.defaultOccasions,
        styles: StyleOption.poemTones,
        minContentLength: 10,
        maxContentLength: 2000,
        title: "Create Poem",
        styleLabel: "Tone"
    )
}

// MARK: - Default Options

extension OccasionOption {
    /// Default occasions available for both songs and poems
    public static let defaultOccasions: [OccasionOption] = [
        OccasionOption(id: "birthday", displayName: "Birthday", emoji: "🎂"),
        OccasionOption(id: "anniversary", displayName: "Anniversary", emoji: "💑"),
        OccasionOption(id: "thank_you", displayName: "Thank You", emoji: "🙏"),
        OccasionOption(id: "i_love_you", displayName: "I Love You", emoji: "❤️"),
        OccasionOption(id: "wedding", displayName: "Wedding", emoji: "💒"),
        OccasionOption(id: "graduation", displayName: "Graduation", emoji: "🎓"),
        OccasionOption(id: "celebration", displayName: "Celebration", emoji: "🎉"),
        OccasionOption(id: "apology", displayName: "Apology", emoji: "💐"),
        OccasionOption(id: "encouragement", displayName: "Encouragement", emoji: "💪"),
        OccasionOption(id: "custom", displayName: "Custom", emoji: "✨")
    ]
}

extension StyleOption {
    /// Music styles for songs
    public static let musicStyles: [StyleOption] = [
        StyleOption(id: "pop", displayName: "Pop"),
        StyleOption(id: "acoustic", displayName: "Acoustic"),
        StyleOption(id: "soul", displayName: "Soul"),
        StyleOption(id: "folk", displayName: "Folk"),
        StyleOption(id: "jazz", displayName: "Jazz"),
        StyleOption(id: "rnb", displayName: "R&B"),
        StyleOption(id: "rock", displayName: "Rock"),
        StyleOption(id: "country", displayName: "Country"),
        StyleOption(id: "afrobeats", displayName: "Afrobeats"),
        StyleOption(id: "highlife", displayName: "Highlife"),
        StyleOption(id: "afropop", displayName: "Afropop"),
        StyleOption(id: "reggaeton", displayName: "Reggaeton"),
        StyleOption(id: "salsa", displayName: "Salsa"),
        StyleOption(id: "bossa_nova", displayName: "Bossa Nova"),
        StyleOption(id: "bachata", displayName: "Bachata"),
        StyleOption(id: "latin_pop", displayName: "Latin Pop")
    ]

    /// Poem tones
    public static let poemTones: [StyleOption] = [
        StyleOption(id: "heartfelt", displayName: "Heartfelt"),
        StyleOption(id: "playful", displayName: "Playful"),
        StyleOption(id: "formal", displayName: "Formal"),
        StyleOption(id: "poetic", displayName: "Poetic"),
        StyleOption(id: "simple", displayName: "Simple"),
        StyleOption(id: "rhyming", displayName: "Rhyming"),
        StyleOption(id: "free_verse", displayName: "Free Verse")
    ]
}
