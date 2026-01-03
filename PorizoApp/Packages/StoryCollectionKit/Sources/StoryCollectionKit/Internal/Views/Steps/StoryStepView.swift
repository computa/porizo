//
//  StoryStepView.swift
//  StoryCollectionKit
//
//  Step 2: AI-powered conversational Q&A
//

import SwiftUI

/// Story step view - AI-powered question/answer flow
struct StoryStepView: View {
    @ObservedObject var viewModel: ContentWizardViewModel
    let theme: WizardTheme

    var body: some View {
        VStack(spacing: 16) {
            // Main accumulated story area
            FormSectionCard(
                title: "Your \(viewModel.wizardConfig.contentType.displayName) Story",
                characterCount: viewModel.context.storyContent.count,
                maxCharacters: viewModel.wizardConfig.maxContentLength,
                theme: theme
            ) {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Watch your story build as you answer questions")
                        .font(.caption)
                        .foregroundColor(theme.textSecondary)

                    FormTextArea(
                        placeholder: "Your story will appear here as you answer the questions below...",
                        text: viewModel.storyContentBinding,
                        minHeight: 200,
                        theme: theme
                    )
                }
            }

            // AI-powered question card
            questionContent

            Spacer()
        }
        .onAppear {
            // Fetch first question when entering Story step
            if viewModel.context.currentQuestion == nil &&
               !viewModel.context.isLoadingQuestion &&
               viewModel.context.storyContent.isEmpty {
                viewModel.fetchNextQuestion()
            }
        }
    }

    @ViewBuilder
    private var questionContent: some View {
        if viewModel.context.isLoadingQuestion {
            LoadingQuestionCard(theme: theme)
        } else if let error = viewModel.context.questionError {
            ErrorQuestionCard(
                error: error,
                onRetry: { viewModel.fetchNextQuestion() },
                theme: theme
            )
        } else if let question = viewModel.context.currentQuestion {
            QuestionCard(
                question: question,
                answer: viewModel.currentAnswerBinding,
                onSubmit: { viewModel.submitAnswer() },
                onSkip: { viewModel.skipQuestion() },
                canFinish: viewModel.context.storyContent.count >= 50,
                onFinish: { viewModel.finishQuestions() },
                theme: theme
            )
        } else if !viewModel.context.hasMoreQuestions || viewModel.context.storyContent.count >= 100 {
            StoryCompleteCard(
                onAddMore: {
                    // Reset to allow more questions
                    viewModel.fetchNextQuestion()
                },
                theme: theme
            )
        } else {
            StartStoryCard(
                onStart: { viewModel.fetchNextQuestion() },
                theme: theme,
                contentType: viewModel.wizardConfig.contentType
            )
        }
    }
}
