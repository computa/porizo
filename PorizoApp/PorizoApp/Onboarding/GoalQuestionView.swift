//
//  GoalQuestionView.swift
//  PorizoApp
//
//  Screen 4: Goal Question — single-select vertical list.
//  "What brought you here today?" Auto-advances on tap.
//

import SwiftUI

struct GoalQuestionView: View {
    let options: [GraphNodeOption]
    let onSelect: (String) -> Void

    @State private var selectedValue: String?

    var body: some View {
        OnboardingScreenShell(accessibilityId: "onboarding-goal-question") {
            VStack(spacing: DesignTokens.spacing24) {
                Text("What brought you here today?")
                    .font(DesignTokens.displayFont(size: 28))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, DesignTokens.spacing20)

                VStack(spacing: DesignTokens.spacing12) {
                    ForEach(options) { option in
                        let isSelected = selectedValue == option.value
                        Button {
                            guard selectedValue == nil else { return }
                            withAnimation(.easeInOut(duration: 0.15)) {
                                selectedValue = option.value
                            }
                            Task { @MainActor in
                                try? await Task.sleep(for: .milliseconds(300))
                                onSelect(option.value ?? "")
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
                        .accessibilityIdentifier("onboarding-goal-\(option.value ?? "unknown")")
                    }
                }
                .padding(.horizontal, DesignTokens.spacing20)
            }
        }
    }
}
