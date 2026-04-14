//
//  PainPointsView.swift
//  PorizoApp
//
//  Screen 3: Pain Points — multi-select chip grid.
//  "What makes gifting hard? Pick all that apply."
//

import SwiftUI

struct PainPointsView: View {
    let options: [GraphNodeOption]
    @Binding var selections: Set<String>
    let minRequired: Int
    let onContinue: ([String]) -> Void

    @State private var hasAdvanced = false
    private var canContinue: Bool { selections.count >= minRequired && !hasAdvanced }

    var body: some View {
        OnboardingScreenShell(accessibilityId: "onboarding-pain-points") {
            VStack(spacing: DesignTokens.spacing24) {
                Text("What makes gifting hard?")
                    .font(DesignTokens.displayFont(size: 28))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .multilineTextAlignment(.center)

                Text("Pick all that apply.")
                    .font(DesignTokens.bodyFont(size: 15))
                    .foregroundStyle(DesignTokens.textSecondary)

                VStack(spacing: DesignTokens.spacing12) {
                    ForEach(options) { option in
                        let key = option.value ?? option.label
                        let isSelected = selections.contains(key)
                        Button {
                            withAnimation(.easeInOut(duration: 0.15)) {
                                if isSelected {
                                    selections.remove(key)
                                } else {
                                    selections.insert(key)
                                }
                            }
                        } label: {
                            Text(option.label)
                                .font(DesignTokens.bodyFont(size: 15, weight: .medium))
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, DesignTokens.spacing16)
                                .padding(.vertical, DesignTokens.spacing12)
                        }
                        .boldChipStyle(isSelected: isSelected)
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("onboarding-pain-\(key)")
                        .accessibilityLabel(option.label)
                        .accessibilityValue(isSelected ? "Selected" : "Not selected")
                        .accessibilityHint("Double tap to \(isSelected ? "deselect" : "select")")
                    }
                }
                .padding(.horizontal, DesignTokens.spacing20)
            }
        } bottom: {
            OnboardingCTAButton(
                enabled: canContinue,
                accessibilityId: "onboarding-pain-continue"
            ) {
                guard !hasAdvanced else { return }
                hasAdvanced = true
                onContinue(Array(selections))
            }
        }
    }
}
