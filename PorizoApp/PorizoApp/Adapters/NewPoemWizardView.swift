//
//  NewPoemWizardView.swift
//  PorizoApp
//
//  Drop-in replacement for PoemWizardView using the StoryCollectionKit module.
//  Same interface as the old view for easy migration.
//

import SwiftUI
import StoryCollectionKit

/// Drop-in replacement for PoemWizardView using the new StoryCollectionKit module.
///
/// Usage (same as old PoemWizardView):
/// ```swift
/// NewPoemWizardView(
///     apiClient: client,
///     onComplete: { poemContext in ... },
///     onCancel: { ... }
/// )
/// ```
struct NewPoemWizardView: View {
    let apiClient: APIClient
    let onComplete: (PoemContext) -> Void
    let onCancel: () -> Void

    var body: some View {
        ContentWizardCoordinator(
            questionProvider: PorizoQuestionProvider(apiClient: apiClient),
            config: .poem,
            theme: PorizoWizardTheme(),
            onComplete: { result in
                // Convert ContentCollectionResult to PoemContext
                let poemContext = PoemContext(from: result)
                onComplete(poemContext)
            },
            onCancel: onCancel
        )
    }
}

#Preview {
    NewPoemWizardView(
        apiClient: APIClient(baseURL: "http://localhost:3000"),
        onComplete: { context in
            print("Poem context: \(context)")
        },
        onCancel: { }
    )
}
