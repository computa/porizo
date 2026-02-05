//
//  Models.swift
//  PorizoApp
//
//  This file is now a barrel file that imports all domain-specific model files.
//  The models have been split into domain-specific files in the Models/ directory:
//
//  - AuthModels.swift       - Phone auth, device registration, username
//  - BillingModels.swift    - Entitlements, subscriptions, plans, trials
//  - EnrollmentModels.swift - Voice enrollment, profiles, quality tiers
//  - PoemModels.swift       - Poems, tones, poem sharing
//  - ShareModels.swift      - Track sharing, claims, statistics
//  - SharedModels.swift     - Common types (APIError, MemoryQuestion, etc.)
//  - StoryModels.swift      - Story API v1/v2, sessions, beats
//  - TrackModels.swift      - Tracks, versions, lyrics, reroll, styles, occasions
//
//  Note: In Swift, all public types are automatically visible across the module,
//  so no explicit re-exports are needed. This file is kept for documentation.
//

import Foundation
