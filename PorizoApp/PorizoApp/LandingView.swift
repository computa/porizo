//
//  LandingView.swift
//  PorizoApp
//
//  Landing page matching v1.pen "01 - Landing" design.
//  Pre-auth screen with hero content and CTAs.
//

import SwiftUI

struct LandingView: View {
    let onCreateAccount: () -> Void
    let onSignIn: () -> Void

    var body: some View {
        ZStack {
            // Background: Deep velvet black
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Hero section with top padding
                VStack(spacing: 32) {
                    // Hero content
                    VStack(spacing: 16) {
                        // Headline in Playfair Display
                        Text("Your voice,\ntheir song.")
                            .font(DesignTokens.displayFont(size: 42))
                            .multilineTextAlignment(.center)
                            .lineSpacing(42 * 0.1) // line-height 1.1
                            .foregroundColor(DesignTokens.textPrimary)

                        // Subhead in system font (Inter equivalent)
                        Text("Create personalized songs for the\nmoments that matter")
                            .font(DesignTokens.bodyFont(size: 17))
                            .multilineTextAlignment(.center)
                            .lineSpacing(17 * 0.4) // line-height 1.4
                            .foregroundColor(DesignTokens.textSecondary)
                    }

                    Spacer()

                    // Waveform visualizer
                    WaveformVisualizer(barCount: 9, maxHeight: 110, animated: true)
                        .frame(height: 120)

                    // CTA section
                    VStack(spacing: 16) {
                        // Primary CTA
                        VelvetButton("Create account", style: .primary) {
                            onCreateAccount()
                        }

                        // Sign in link
                        HStack(spacing: 4) {
                            Text("Already have an account?")
                                .font(DesignTokens.bodyFont(size: 14))
                                .foregroundColor(DesignTokens.textSecondary)

                            Button(action: onSignIn) {
                                Text("Sign in")
                                    .font(DesignTokens.bodyFont(size: 14, weight: .semibold))
                                    .foregroundColor(DesignTokens.gold)
                            }
                        }
                    }
                }
                .padding(.top, 60)
                .padding(.horizontal, 24)
                .padding(.bottom, 24)
            }
        }
    }
}

#Preview {
    LandingView(
        onCreateAccount: { print("Create account") },
        onSignIn: { print("Sign in") }
    )
}
