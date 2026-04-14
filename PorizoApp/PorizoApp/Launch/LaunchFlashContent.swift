//
//  LaunchFlashContent.swift
//  PorizoApp
//
//  Resolved content shown on the launch flash screen.
//
//  Invariants:
//  - `title` is non-empty
//  - `audioURL == nil` means visual-only mode (no audio attempted)
//  - `coverImageURL == nil` means use coral gradient fallback
//  - `trackId` is non-nil for .received and .created sources
//

import Foundation

struct LaunchFlashContent: Equatable, Sendable {
    let trackId: String?
    let title: String
    let recipientName: String?
    let lyricPreview: String?
    let audioURL: URL?
    let coverImageURL: URL?
    let source: LaunchFlashSource
}
