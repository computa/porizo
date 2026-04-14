//
//  RecipientNameView.swift
//  PorizoApp
//
//  Screen 6: Name Them — single text field.
//  "What's your mom's name?" Continue at >= 2 characters.
//

import SwiftUI

struct RecipientNameView: View {
    let resolvedQuestion: String
    @Binding var nameInput: String
    let onContinue: (String) -> Void

    @FocusState private var isFocused: Bool
    @State private var hasAdvanced = false

    private var trimmedName: String {
        nameInput.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        OnboardingScreenShell(accessibilityId: "onboarding-recipient-name") {
            VStack(spacing: DesignTokens.spacing24) {
                Text(resolvedQuestion)
                    .font(DesignTokens.displayFont(size: 28))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, DesignTokens.spacing20)

                TextField("Their name", text: $nameInput)
                    .font(DesignTokens.bodyFont(size: 16))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .textInputAutocapitalization(.words)
                    .focused($isFocused)
                    .padding(.horizontal, DesignTokens.spacing16)
                    .padding(.vertical, 14)
                    .background(DesignTokens.surface)
                    .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
                    .overlay(
                        RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                            .stroke(DesignTokens.border, lineWidth: 1.5)
                    )
                    .padding(.horizontal, DesignTokens.spacing20)
                    .onSubmit { submit() }
                    .accessibilityIdentifier("onboarding-name-field")
            }
        } bottom: {
            OnboardingCTAButton(
                enabled: trimmedName.count >= 2,
                accessibilityId: "onboarding-name-continue",
                action: submit
            )
        }
        .scrollDismissesKeyboard(.interactively)
        .onTapGesture { isFocused = false }
        .onAppear { isFocused = true }
    }

    private func submit() {
        guard trimmedName.count >= 2, !hasAdvanced else { return }
        hasAdvanced = true
        isFocused = false
        onContinue(trimmedName)
    }
}
