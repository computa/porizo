//
//  MirrorView.swift
//  PorizoApp
//
//  Screen 2: The Mirror — one sharp emotional contrast.
//  Staggered text reveal, then landing line.
//

import SwiftUI

struct MirrorView: View {
    let onContinue: () -> Void

    @State private var hasAdvanced = false
    @State private var showLine1 = false
    @State private var showLine2 = false
    @State private var showLine3 = false
    @State private var showLanding = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        OnboardingScreenShell(accessibilityId: "onboarding-mirror") {
            VStack(spacing: DesignTokens.spacing24) {
                VStack(spacing: DesignTokens.spacing16) {
                    Text("Think about the last birthday you celebrated.")
                        .opacity(showLine1 ? 1 : 0)
                        .offset(y: reduceMotion ? 0 : (showLine1 ? 0 : 8))

                    Text("Did you send a text? Flowers? A gift card?")
                        .opacity(showLine2 ? 1 : 0)
                        .offset(y: reduceMotion ? 0 : (showLine2 ? 0 : 8))

                    Text("Do you still remember what you sent?")
                        .opacity(showLine3 ? 1 : 0)
                        .offset(y: reduceMotion ? 0 : (showLine3 ? 0 : 8))
                }
                .font(DesignTokens.bodyFont(size: 17))
                .foregroundStyle(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)
                .lineSpacing(3)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Think about the last birthday you celebrated. Did you send a text? Flowers? A gift card? Do you still remember what you sent?")

                Text("Most gifts fade. A song stays.")
                    .font(DesignTokens.displayFont(size: 24))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .multilineTextAlignment(.center)
                    .opacity(showLanding ? 1 : 0)
                    .offset(y: reduceMotion ? 0 : (showLanding ? 0 : 12))
            }
            .padding(.horizontal, DesignTokens.spacing20)
        } bottom: {
            OnboardingCTAButton(accessibilityId: "onboarding-mirror-continue") {
                guard !hasAdvanced else { return }
                hasAdvanced = true
                onContinue()
            }
                .opacity(showLanding ? 1 : 0)
        }
        .onAppear {
            if reduceMotion {
                showLine1 = true
                showLine2 = true
                showLine3 = true
                showLanding = true
            } else {
                withAnimation(.easeOut(duration: 0.5).delay(0.3)) { showLine1 = true }
                withAnimation(.easeOut(duration: 0.5).delay(1.0)) { showLine2 = true }
                withAnimation(.easeOut(duration: 0.5).delay(1.7)) { showLine3 = true }
                withAnimation(.easeOut(duration: 0.6).delay(2.8)) { showLanding = true }
            }
        }
    }
}
