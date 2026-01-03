//
//  StoryCollectionKit.swift
//  StoryCollectionKit
//
//  A standalone module for AI-powered song and poem writing wizards.
//
//  Usage:
//  ```swift
//  import StoryCollectionKit
//
//  // Implement QuestionProvider to integrate your AI
//  struct MyQuestionProvider: QuestionProvider {
//      func generateQuestions(...) async throws -> [ContentQuestion] {
//          // Call your API here
//      }
//  }
//
//  // Use the wizard
//  ContentWizardCoordinator(
//      questionProvider: MyQuestionProvider(),
//      config: .song,  // or .poem
//      onComplete: { result in
//          // Handle the result
//      },
//      onCancel: {
//          // Handle cancellation
//      }
//  )
//  ```
//

import Foundation
import SwiftUI

// This file serves as the module's entry point.
// All public types are exported from their respective files.
