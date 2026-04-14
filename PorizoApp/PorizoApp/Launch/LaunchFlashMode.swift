//
//  LaunchFlashMode.swift
//  PorizoApp
//
//  User setting for launch flash behavior. Single source of truth — no
//  separate `launchFlashDisabled` boolean. .off means never show.
//

import Foundation

enum LaunchFlashMode: String, CaseIterable, Codable, Sendable {
    case all       // Rotate through received + created (default)
    case mySongs   // Exclude received songs (privacy mode)
    case off       // Never show

    var displayName: String {
        switch self {
        case .all:     return "All Songs"
        case .mySongs: return "Only Mine"
        case .off:     return "Off"
        }
    }
}
