//
//  StoryRevisionIntent.swift
//  PorizoApp
//
//  Shared revision intent model for review editing.
//

import Foundation

enum StoryRevisionIntent: String, CaseIterable, Identifiable {
    case append
    case replace
    case remove
    case resolveConflict = "resolve_conflict"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .append: return "Add"
        case .replace: return "Replace"
        case .remove: return "Remove"
        case .resolveConflict: return "Resolve"
        }
    }

    var subtitle: String {
        switch self {
        case .append: return "Add new detail or emphasis."
        case .replace: return "Swap an existing detail for a better one."
        case .remove: return "Remove a detail that should not stay."
        case .resolveConflict: return "Tell the draft which version is correct."
        }
    }
}
