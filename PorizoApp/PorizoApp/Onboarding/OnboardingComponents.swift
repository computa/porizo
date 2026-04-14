//
//  OnboardingComponents.swift
//  PorizoApp
//
//  Shared UI components for the V2 onboarding flow.
//  Eliminates duplication across onboarding screens.
//

import SwiftUI

// MARK: - Onboarding Screen Shell

/// Standard onboarding screen layout: warm background, vertically centered content, bottom-pinned action area.
struct OnboardingScreenShell<Content: View, BottomContent: View>: View {
    let accessibilityId: String
    @ViewBuilder let content: () -> Content
    @ViewBuilder let bottom: () -> BottomContent

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()
                content()
                Spacer()
                bottom()
            }
        }
        .accessibilityIdentifier(accessibilityId)
    }
}

extension OnboardingScreenShell where BottomContent == EmptyView {
    init(accessibilityId: String, @ViewBuilder content: @escaping () -> Content) {
        self.accessibilityId = accessibilityId
        self.content = content
        self.bottom = { EmptyView() }
    }
}

// MARK: - Onboarding CTA Button

/// Full-width coral CTA button used at the bottom of onboarding screens.
struct OnboardingCTAButton: View {
    let label: String
    let enabled: Bool
    let accessibilityId: String
    let action: () -> Void

    init(
        _ label: String = "Continue",
        enabled: Bool = true,
        accessibilityId: String,
        action: @escaping () -> Void
    ) {
        self.label = label
        self.enabled = enabled
        self.accessibilityId = accessibilityId
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .background(DesignTokens.gold)
                .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
        }
        .disabled(!enabled)
        .opacity(enabled ? 1.0 : 0.5)
        .padding(.horizontal, DesignTokens.spacing20)
        .padding(.bottom, 40)
        .accessibilityIdentifier(accessibilityId)
    }
}
