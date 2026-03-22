//
//  MockLyricsData.swift
//  PorizoApp
//
//  Shared mock lyrics data for post-Create flow options.
//

import Foundation

#if DEBUG

struct MockLyricsSection: Identifiable {
    let id = UUID()
    let type: SectionType
    let lines: [String]

    enum SectionType: String {
        case verse1 = "Verse 1"
        case chorus = "Chorus"
        case verse2 = "Verse 2"
        case bridge = "Bridge"
        case outro = "Outro"
    }
}

let mockLyrics: [MockLyricsSection] = [
    MockLyricsSection(type: .verse1, lines: [
        "Remember that trail up the mountain side",
        "You complained the whole way, I won't lie",
        "But when we reached the top, the fog rolled in",
        "You went quiet and let the world begin",
    ]),
    MockLyricsSection(type: .chorus, lines: [
        "Here's to you, here's to thirty years",
        "Of bad puns and laughter through the tears",
        "You're the one who picks up at 3 AM",
        "Sarah, I'd climb every mountain again",
    ]),
    MockLyricsSection(type: .verse2, lines: [
        "Ten years deep since that freshman door",
        "Through the worst apartments, wanting more",
        "Your terrible jokes still make us cry",
        "The friend who stays, who never says goodbye",
    ]),
    MockLyricsSection(type: .bridge, lines: [
        "I don't know what I'd do",
        "If I didn't have you",
        "The best thing college ever gave to me",
        "Was a friend who sets my spirit free",
    ]),
]

#endif
