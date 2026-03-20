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
                Spacer()

                // Hero text
                VStack(spacing: 16) {
                    Text("Your moment,\nin a song.")
                        .font(DesignTokens.displayFont(size: 42))
                        .foregroundStyle(DesignTokens.textPrimary)
                        .multilineTextAlignment(.center)
                        .lineSpacing(4)

                    Text("Create personalized songs for the\nmoments that matter")
                        .font(DesignTokens.bodyFont(size: 15))
                        .foregroundStyle(DesignTokens.textSecondary)
                        .multilineTextAlignment(.center)
                        .lineSpacing(4)
                }

                Spacer().frame(height: 40)

                // Waveform visualizer
                WaveformVisualizer(barCount: 9, maxHeight: 44, animated: true)
                    .frame(height: 44)
                    .padding(.bottom, 40)

                Spacer()

                // CTAs
                VStack(spacing: 16) {
                    Button(action: onCreateAccount) {
                        HStack(spacing: 8) {
                            Image(systemName: "person.badge.plus")
                                .font(.system(size: 14))
                            Text("Create account")
                                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        }
                        .foregroundStyle(DesignTokens.background)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(DesignTokens.gold)
                        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
                    }
                    .padding(.horizontal, 20)

                    Button(action: onSignIn) {
                        (Text("Already have an account? ")
                            .foregroundStyle(DesignTokens.textSecondary)
                        + Text("Sign in")
                            .foregroundStyle(DesignTokens.gold))
                        .font(DesignTokens.bodyFont(size: 14))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.bottom, 48)
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
