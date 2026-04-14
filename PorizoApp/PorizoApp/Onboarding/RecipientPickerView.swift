//
//  RecipientPickerView.swift
//  PorizoApp
//
//  Screen 5: Pick One Person — 2-column grid.
//  "Who deserves something unforgettable?" Auto-advances on tap.
//

import SwiftUI

struct RecipientPickerView: View {
    let options: [GraphNodeOption]
    let onSelect: (String) -> Void

    @State private var selectedValue: String?

    private let columns = [
        GridItem(.flexible(), spacing: DesignTokens.spacing12),
        GridItem(.flexible(), spacing: DesignTokens.spacing12)
    ]

    private static let relationshipEmoji: [String: String] = [
        "mom": "👩", "dad": "👨", "partner": "❤️", "sister": "👧",
        "brother": "👦", "best_friend": "🤝", "son": "👦", "daughter": "👧",
        "grandparent": "👴", "other": "🌟"
    ]

    var body: some View {
        OnboardingScreenShell(accessibilityId: "onboarding-recipient-picker") {
            VStack(spacing: DesignTokens.spacing24) {
                Text("Who deserves something\nunforgettable?")
                    .font(DesignTokens.displayFont(size: 28))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, DesignTokens.spacing20)

                LazyVGrid(columns: columns, spacing: DesignTokens.spacing12) {
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
                            VStack(spacing: DesignTokens.spacing8) {
                                Text(Self.relationshipEmoji[option.value ?? ""] ?? "🌟")
                                    .font(.system(size: 28))
                                Text(option.label)
                                    .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, DesignTokens.spacing16)
                        }
                        .boldChipStyle(isSelected: isSelected)
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("onboarding-person-\(option.value ?? "other")")
                        .accessibilityLabel(option.label)
                        .accessibilityHint("Double tap to select")
                    }
                }
                .padding(.horizontal, DesignTokens.spacing20)
            }
        }
    }
}
