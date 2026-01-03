//
//  NewStoryWizardView.swift
//  PorizoApp
//
//  Drop-in replacement for StoryWizardView using the StoryCollectionKit module.
//  Same interface as the old view for easy migration.
//

import SwiftUI
import StoryCollectionKit

/// Drop-in replacement for StoryWizardView using the new StoryCollectionKit module.
///
/// Usage (same as old StoryWizardView):
/// ```swift
/// NewStoryWizardView(
///     apiClient: client,
///     onComplete: { storyContext in ... },
///     onCancel: { ... }
/// )
/// ```
struct NewStoryWizardView: View {
    let apiClient: APIClient
    let onComplete: (StoryContext) -> Void
    let onCancel: () -> Void

    var body: some View {
        ContentWizardCoordinator(
            questionProvider: PorizoQuestionProvider(apiClient: apiClient),
            config: .song,
            theme: PorizoWizardTheme(),
            onComplete: { result in
                // Convert ContentCollectionResult to StoryContext
                let storyContext = StoryContext(from: result)
                onComplete(storyContext)
            },
            onCancel: onCancel
        )
    }
}
