//
//  AIQuestionCard.swift
//  StoryCollectionKit
//
//  Cards for AI question flow states (loading, error, question, complete).
//

import SwiftUI

/// Loading state while AI generates next question
struct LoadingQuestionCard: View {
    let theme: WizardTheme

    var body: some View {
        VStack(spacing: 16) {
            ProgressView()
                .tint(theme.primaryColor)
                .scaleEffect(1.2)

            Text("AI is thinking of the next question...")
                .font(.subheadline)
                .foregroundColor(theme.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(32)
        .background(theme.cardBackground)
        .cornerRadius(16)
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(theme.borderColor, lineWidth: 1)
        )
    }
}

/// Error state with retry button
struct ErrorQuestionCard: View {
    let error: String
    let onRetry: () -> Void
    let theme: WizardTheme

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 32))
                .foregroundColor(theme.warningColor)

            Text(error)
                .font(.subheadline)
                .foregroundColor(theme.textSecondary)
                .multilineTextAlignment(.center)

            Button(action: onRetry) {
                HStack {
                    Image(systemName: "arrow.clockwise")
                    Text("Try Again")
                }
                .font(.subheadline.weight(.semibold))
                .foregroundColor(theme.primaryColor)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(24)
        .background(theme.cardBackground)
        .cornerRadius(16)
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(theme.borderColor, lineWidth: 1)
        )
    }
}

/// Initial prompt to start answering questions
struct StartStoryCard: View {
    let onStart: () -> Void
    let theme: WizardTheme
    let contentType: ContentType

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "text.bubble.fill")
                .font(.system(size: 40))
                .foregroundColor(theme.primaryColor)

            Text("Let's write your \(contentType.displayName.lowercased())!")
                .font(.headline)
                .foregroundColor(theme.textPrimary)

            Text("I'll ask you questions to understand the story you want to tell. Your answers will shape the lyrics.")
                .font(.subheadline)
                .foregroundColor(theme.textSecondary)
                .multilineTextAlignment(.center)

            Button(action: onStart) {
                HStack {
                    Image(systemName: "sparkles")
                    Text("Start Writing")
                }
                .font(.subheadline.weight(.semibold))
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(theme.primaryColor)
                .cornerRadius(10)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(24)
        .background(theme.cardBackground)
        .cornerRadius(16)
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(theme.borderColor, lineWidth: 1)
        )
    }
}

/// Card showing an AI-generated question with answer input
struct QuestionCard: View {
    let question: ContentQuestion
    @Binding var answer: String
    let onSubmit: () -> Void
    let onSkip: () -> Void
    let canFinish: Bool
    let onFinish: () -> Void
    let theme: WizardTheme

    var body: some View {
        FormSectionCard(title: question.question, theme: theme) {
            VStack(spacing: 12) {
                FormTextArea(
                    placeholder: question.placeholder,
                    text: $answer,
                    minHeight: 100,
                    theme: theme
                )

                // Done button - submit answer
                Button(action: onSubmit) {
                    HStack {
                        Text("Done")
                        Image(systemName: "checkmark")
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(answer.trimmingCharacters(in: .whitespaces).isEmpty ? theme.textTertiary : theme.primaryColor)
                    .cornerRadius(10)
                }
                .disabled(answer.trimmingCharacters(in: .whitespaces).isEmpty)

                // Skip or finish options
                HStack(spacing: 16) {
                    Button(action: onSkip) {
                        Text("Skip this question")
                            .font(.caption)
                            .foregroundColor(theme.textSecondary)
                    }

                    if canFinish {
                        Text("•")
                            .foregroundColor(theme.textTertiary)

                        Button(action: onFinish) {
                            Text("I'm done")
                                .font(.caption)
                                .foregroundColor(theme.textSecondary)
                        }
                    }
                }
            }
        }
    }
}

/// Shown when story is complete
struct StoryCompleteCard: View {
    let onAddMore: () -> Void
    let theme: WizardTheme

    var body: some View {
        VStack(spacing: 16) {
            VStack(spacing: 12) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 48))
                    .foregroundColor(theme.successColor)

                Text("Story Complete!")
                    .font(.headline)
                    .foregroundColor(theme.textPrimary)

                Text("Review your story above and edit if needed, then continue to preview.")
                    .font(.subheadline)
                    .foregroundColor(theme.textSecondary)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(24)
            .background(theme.cardBackground)
            .cornerRadius(16)
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(theme.borderColor, lineWidth: 1)
            )

            // Option to add more
            Button(action: onAddMore) {
                HStack {
                    Image(systemName: "plus.circle")
                    Text("Add more details")
                }
                .font(.subheadline)
                .foregroundColor(theme.primaryColor)
            }
        }
    }
}
