//
//  BasicsStepView.swift
//  StoryCollectionKit
//
//  Step 1: Who + Occasion + Style
//

import SwiftUI

/// Basics step view - Who, Occasion, Style selection
struct BasicsStepView: View {
    @ObservedObject var viewModel: ContentWizardViewModel
    let theme: WizardTheme

    var body: some View {
        VStack(spacing: 16) {
            // Who is this for?
            FormSectionCard(
                title: "Who is this \(viewModel.wizardConfig.contentType.displayName.lowercased()) for?",
                characterCount: viewModel.context.recipientName.count,
                maxCharacters: 40,
                theme: theme
            ) {
                FormTextField(
                    placeholder: "e.g., Mom, My love, Best friend Jake",
                    text: viewModel.recipientNameBinding,
                    theme: theme
                )
            }

            // Occasion
            FormSectionCard(title: "Occasion", theme: theme) {
                OccasionChipSelector(
                    items: viewModel.wizardConfig.occasions,
                    selection: Binding(
                        get: { viewModel.context.selectedOccasionId },
                        set: { viewModel.setOccasion($0) }
                    ),
                    theme: theme
                )
            }

            // Style (Music Style for songs, Tone for poems)
            FormSectionCard(
                title: viewModel.wizardConfig.styleLabel,
                helperButtonTitle: "Random",
                helperButtonAction: { viewModel.randomizeStyle() },
                theme: theme
            ) {
                ChipSelector(
                    items: Array(viewModel.wizardConfig.styles.prefix(8)),
                    selection: Binding(
                        get: { viewModel.context.selectedStyleId },
                        set: { viewModel.setStyle($0) }
                    ),
                    showRefreshButton: true,
                    onRefresh: { viewModel.randomizeStyle() },
                    theme: theme
                )
            }

            Spacer()
        }
    }
}
