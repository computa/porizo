//
//  LaunchFlashSource.swift
//  PorizoApp
//
//  Identifies which library the launch flash content came from.
//  Used for analytics and content priority routing.
//

import Foundation

enum LaunchFlashSource: String, CaseIterable, Codable, Sendable {
    case received
    case created
    case suggestion
    case demo
}
