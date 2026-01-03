//
//  ContentType.swift
//  StoryCollectionKit
//
//  Defines the type of content being created (song or poem).
//

import Foundation

/// The type of content the wizard is collecting for
public enum ContentType: String, Sendable, Equatable, Hashable {
    case song
    case poem

    public var displayName: String {
        switch self {
        case .song: return "Song"
        case .poem: return "Poem"
        }
    }
}
