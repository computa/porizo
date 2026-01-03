//
//  ContentWizardCoordinator.swift
//  StoryCollectionKit
//
//  Public entry point for the content collection wizard.
//  Inject your QuestionProvider and receive collected content on completion.
//

import SwiftUI

/// Public entry point for the content collection wizard.
///
/// Use this view to embed the song/poem writing wizard in your app.
/// The wizard guides users through collecting story content via AI-powered Q&A.
///
/// Example usage:
/// ```swift
/// ContentWizardCoordinator(
///     questionProvider: myAPIQuestionProvider,
///     config: .song,
///     onComplete: { result in
///         // Use result.storyContent, result.recipientName, etc.
///     },
///     onCancel: {
///         // Handle cancellation
///     }
/// )
/// ```
public struct ContentWizardCoordinator: View {
    @StateObject private var viewModel: ContentWizardViewModel

    private let theme: WizardTheme
    private let onComplete: (ContentCollectionResult) -> Void
    private let onCancel: () -> Void

    /// Creates a new content wizard.
    ///
    /// - Parameters:
    ///   - questionProvider: Your implementation of `QuestionProvider` for generating AI questions
    ///   - config: Wizard configuration (use `.song` or `.poem` presets, or create custom)
    ///   - theme: Optional theme customization (defaults to system-appropriate colors)
    ///   - onComplete: Called when user completes the wizard with collected content
    ///   - onCancel: Called when user cancels the wizard
    public init(
        questionProvider: QuestionProvider,
        config: WizardConfig,
        theme: WizardTheme? = nil,
        onComplete: @escaping (ContentCollectionResult) -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.theme = theme ?? DefaultWizardTheme()
        self.onComplete = onComplete
        self.onCancel = onCancel

        // Create ViewModel with injected dependencies
        _viewModel = StateObject(wrappedValue: ContentWizardViewModel(
            questionProvider: questionProvider,
            config: config,
            onComplete: onComplete,
            onCancel: onCancel
        ))
    }

    public var body: some View {
        ContentWizardView(
            viewModel: viewModel,
            theme: theme,
            onComplete: onComplete,
            onCancel: onCancel
        )
    }
}

// MARK: - Convenience Initializers

extension ContentWizardCoordinator {
    /// Creates a song writing wizard with default configuration.
    ///
    /// - Parameters:
    ///   - questionProvider: Your implementation of `QuestionProvider`
    ///   - onComplete: Called when user completes the wizard
    ///   - onCancel: Called when user cancels
    public static func song(
        questionProvider: QuestionProvider,
        theme: WizardTheme? = nil,
        onComplete: @escaping (ContentCollectionResult) -> Void,
        onCancel: @escaping () -> Void
    ) -> ContentWizardCoordinator {
        ContentWizardCoordinator(
            questionProvider: questionProvider,
            config: .song,
            theme: theme,
            onComplete: onComplete,
            onCancel: onCancel
        )
    }

    /// Creates a poem writing wizard with default configuration.
    ///
    /// - Parameters:
    ///   - questionProvider: Your implementation of `QuestionProvider`
    ///   - onComplete: Called when user completes the wizard
    ///   - onCancel: Called when user cancels
    public static func poem(
        questionProvider: QuestionProvider,
        theme: WizardTheme? = nil,
        onComplete: @escaping (ContentCollectionResult) -> Void,
        onCancel: @escaping () -> Void
    ) -> ContentWizardCoordinator {
        ContentWizardCoordinator(
            questionProvider: questionProvider,
            config: .poem,
            theme: theme,
            onComplete: onComplete,
            onCancel: onCancel
        )
    }
}
