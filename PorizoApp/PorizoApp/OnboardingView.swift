//
//  OnboardingView.swift
//  PorizoApp
//
//  Single-page onboarding — gold mic hero, sample audio player mock,
//  and two CTAs (Create a Song / Sign in). Matches the Warm Canvas gallery.
//

import SwiftUI

struct OnboardingView: View {
    let onComplete: () -> Void
    let onSkip: () -> Void

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 24) {
                Spacer()

                // Gold mic circle
                Circle()
                    .fill(DesignTokens.gold)
                    .frame(width: 56, height: 56)
                    .overlay(
                        Image(systemName: "mic.fill")
                            .font(.system(size: 28))
                            .foregroundStyle(.white)
                    )
                    .accessibilityHidden(true)

                // Headline
                Text("Hear what a birthday\nsounds like")
                    .font(DesignTokens.displayFont(size: 22))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .multilineTextAlignment(.center)

                // Audio player mock widget
                HStack(spacing: 12) {
                    Circle()
                        .fill(DesignTokens.gold)
                        .frame(width: 44, height: 44)
                        .overlay(
                            Image(systemName: "play.fill")
                                .font(.system(size: 16))
                                .foregroundStyle(.white)
                        )
                        .accessibilityLabel("Play sample")

                    VStack(alignment: .leading, spacing: 4) {
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                RoundedRectangle(cornerRadius: 2)
                                    .fill(DesignTokens.border)
                                    .frame(height: 4)
                                RoundedRectangle(cornerRadius: 2)
                                    .fill(DesignTokens.gold)
                                    .frame(width: geo.size.width * 0.53, height: 4)
                            }
                        }
                        .frame(height: 4)

                        Text("0:08 / 0:15")
                            .font(DesignTokens.bodyFont(size: 12))
                            .foregroundStyle(DesignTokens.textTertiary)
                    }
                }
                .padding(16)
                .background(DesignTokens.surface)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .padding(.horizontal, 40)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Sample song preview, 8 of 15 seconds")

                // Tagline
                Text("Make one in 90 seconds")
                    .font(DesignTokens.bodyFont(size: 14, weight: .semibold))
                    .foregroundStyle(DesignTokens.gold)

                Spacer()

                // Bottom CTAs
                VStack(spacing: 12) {
                    Button {
                        onComplete()
                    } label: {
                        Text("Create a Song")
                            .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(DesignTokens.gold)
                            .clipShape(RoundedRectangle(cornerRadius: 14))
                    }

                    Button {
                        onSkip()
                    } label: {
                        Text("Sign in")
                            .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                            .foregroundStyle(DesignTokens.gold)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 40)
            }
        }
    }
}

#Preview {
    OnboardingView(
        onComplete: { print("Complete") },
        onSkip: { print("Skip") }
    )
}
