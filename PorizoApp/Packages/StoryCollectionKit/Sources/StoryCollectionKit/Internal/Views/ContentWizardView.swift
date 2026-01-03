//
//  ContentWizardView.swift
//  StoryCollectionKit
//
//  Main container view that coordinates the wizard flow.
//

import SwiftUI

/// Internal container view that manages step navigation and layout
struct ContentWizardView: View {
    @ObservedObject var viewModel: ContentWizardViewModel
    let theme: WizardTheme
    let onComplete: (ContentCollectionResult) -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            // Step indicator at top
            WizardStepIndicator(
                steps: ["Basics", "Story", "Preview"],
                currentStep: viewModel.currentStep,
                onStepTap: { step in
                    viewModel.goToStep(step)
                },
                theme: theme
            )

            // Scrollable content area
            ScrollView {
                VStack(spacing: 0) {
                    stepContent
                        .padding(.horizontal, 16)
                        .padding(.top, 16)
                        .padding(.bottom, 100) // Space for floating button
                }
            }

            Spacer(minLength: 0)
        }
        .background(theme.backgroundColor)
        .safeAreaInset(edge: .bottom) {
            actionButton
        }
        .onChange(of: viewModel.result) { _, result in
            if let result = result {
                onComplete(result)
            }
        }
        .onChange(of: viewModel.isCancelled) { _, isCancelled in
            if isCancelled {
                onCancel()
            }
        }
    }

    @ViewBuilder
    private var stepContent: some View {
        switch viewModel.currentStep {
        case .basics:
            BasicsStepView(viewModel: viewModel, theme: theme)
        case .story:
            StoryStepView(viewModel: viewModel, theme: theme)
        case .preview:
            PreviewStepView(viewModel: viewModel, theme: theme)
        }
    }

    @ViewBuilder
    private var actionButton: some View {
        VStack(spacing: 0) {
            Divider()
                .background(theme.borderColor)

            HStack(spacing: 12) {
                // Back button (except on first step)
                if viewModel.currentStep != .basics {
                    Button {
                        viewModel.previousStep()
                    } label: {
                        HStack {
                            Image(systemName: "chevron.left")
                            Text("Back")
                        }
                        .font(.subheadline.weight(.medium))
                        .foregroundColor(theme.textSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(theme.cardBackground)
                        .cornerRadius(12)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(theme.borderColor, lineWidth: 1)
                        )
                    }
                    .frame(maxWidth: 120)
                }

                // Primary action button
                Button {
                    if viewModel.currentStep == .preview {
                        viewModel.submit()
                    } else {
                        viewModel.nextStep()
                    }
                } label: {
                    HStack {
                        if viewModel.isSubmitting {
                            ProgressView()
                                .tint(.white)
                                .scaleEffect(0.9)
                        } else {
                            Text(primaryButtonTitle)
                            if viewModel.currentStep != .preview {
                                Image(systemName: "chevron.right")
                            }
                        }
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(canProceedToNext ? theme.primaryColor : theme.textTertiary)
                    .cornerRadius(12)
                }
                .disabled(!canProceedToNext || viewModel.isSubmitting)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(theme.backgroundColor)
        }
    }

    private var primaryButtonTitle: String {
        switch viewModel.currentStep {
        case .basics:
            return "Continue"
        case .story:
            return "Preview"
        case .preview:
            return "Create \(viewModel.wizardConfig.contentType.displayName)"
        }
    }

    private var canProceedToNext: Bool {
        viewModel.canProceed
    }
}
