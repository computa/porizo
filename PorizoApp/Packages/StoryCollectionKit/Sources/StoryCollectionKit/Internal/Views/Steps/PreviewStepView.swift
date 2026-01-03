//
//  PreviewStepView.swift
//  StoryCollectionKit
//
//  Step 3: Review and extras before creation
//

import SwiftUI

/// Preview step view - Summary and optional extras
struct PreviewStepView: View {
    @ObservedObject var viewModel: ContentWizardViewModel
    let theme: WizardTheme

    private var selectedOccasion: OccasionOption? {
        viewModel.wizardConfig.occasions.first { $0.id == viewModel.context.selectedOccasionId }
    }

    private var selectedStyle: StyleOption? {
        viewModel.wizardConfig.styles.first { $0.id == viewModel.context.selectedStyleId }
    }

    var body: some View {
        VStack(spacing: 16) {
            // Summary header
            VStack(spacing: 8) {
                Text("🎵")
                    .font(.system(size: 48))

                Text("\(viewModel.wizardConfig.contentType.displayName) for \(viewModel.context.recipientName)")
                    .font(.title2.weight(.bold))
                    .foregroundColor(theme.textPrimary)

                HStack(spacing: 8) {
                    if let occasion = selectedOccasion {
                        Text("\(occasion.emoji) \(occasion.displayName)")
                    }
                    Text("•")
                        .foregroundColor(theme.textTertiary)
                    if let style = selectedStyle {
                        Text(style.displayName)
                    }
                }
                .font(.subheadline)
                .foregroundColor(theme.textSecondary)
            }
            .frame(maxWidth: .infinity)
            .padding(24)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(theme.primaryColor.opacity(0.1))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(theme.borderColor, lineWidth: 1)
            )

            // Editable story content
            FormSectionCard(
                title: "Story & Lyrics Content",
                characterCount: viewModel.context.storyContent.count,
                maxCharacters: viewModel.wizardConfig.maxContentLength,
                theme: theme
            ) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Review and edit your \(viewModel.wizardConfig.contentType.displayName.lowercased()) content")
                        .font(.caption)
                        .foregroundColor(theme.textSecondary)

                    FormTextArea(
                        placeholder: "Your story content...",
                        text: viewModel.storyContentBinding,
                        minHeight: 200,
                        theme: theme
                    )
                }
            }

            // Optional extras
            FormSectionCard(title: "Special Touches (Optional)", theme: theme) {
                VStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Nicknames / Inside Jokes")
                            .font(.caption)
                            .foregroundColor(theme.textSecondary)
                        FormTextField(
                            placeholder: "e.g., Sunshine, My rock",
                            text: viewModel.specialPhrasesBinding,
                            theme: theme
                        )
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text("What makes them special")
                            .font(.caption)
                            .foregroundColor(theme.textSecondary)
                        FormTextField(
                            placeholder: "e.g., Their laugh fills every room",
                            text: viewModel.whatMakesThemSpecialBinding,
                            theme: theme
                        )
                    }
                }
            }

            Spacer()
        }
    }
}
