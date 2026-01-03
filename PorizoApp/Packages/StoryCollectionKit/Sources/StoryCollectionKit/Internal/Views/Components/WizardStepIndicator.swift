//
//  WizardStepIndicator.swift
//  StoryCollectionKit
//
//  A step indicator showing progress through the wizard.
//

import SwiftUI

/// Step indicator showing progress through the wizard steps
struct WizardStepIndicator: View {
    let steps: [String]
    let currentStep: WizardStep
    let onStepTap: (WizardStep) -> Void
    let theme: WizardTheme

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 0) {
                ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                    Button {
                        if let wizardStep = WizardStep(rawValue: index), index < currentStep.rawValue {
                            onStepTap(wizardStep)
                        }
                    } label: {
                        VStack(spacing: 6) {
                            ZStack {
                                Circle()
                                    .fill(stepColor(for: index))
                                    .frame(width: 28, height: 28)

                                if index < currentStep.rawValue {
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 12, weight: .bold))
                                        .foregroundColor(.white)
                                } else {
                                    Text("\(index + 1)")
                                        .font(.caption)
                                        .fontWeight(.semibold)
                                        .foregroundColor(index == currentStep.rawValue ? .white : theme.textSecondary)
                                }
                            }

                            Text(step)
                                .font(.caption2)
                                .fontWeight(index == currentStep.rawValue ? .semibold : .regular)
                                .foregroundColor(index <= currentStep.rawValue ? theme.textPrimary : theme.textTertiary)
                        }
                        .frame(width: 60)
                    }
                    .buttonStyle(.plain)
                    .disabled(index > currentStep.rawValue)

                    if index < steps.count - 1 {
                        Rectangle()
                            .fill(index < currentStep.rawValue ? theme.primaryColor : theme.borderColor)
                            .frame(width: 20, height: 2)
                            .offset(y: -8)
                    }
                }
            }
            .padding(.horizontal, 16)
        }
        .padding(.vertical, 12)
        .background(theme.cardBackground)
    }

    private func stepColor(for index: Int) -> Color {
        if index < currentStep.rawValue {
            return theme.successColor
        } else if index == currentStep.rawValue {
            return theme.primaryColor
        } else {
            return theme.borderColor
        }
    }
}
