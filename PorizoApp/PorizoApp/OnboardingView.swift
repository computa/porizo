//
//  OnboardingView.swift
//  PorizoApp
//
//  Three-page onboarding wizard introducing Porizo's value proposition.
//  Light mode design with rose accents.
//

import SwiftUI

struct OnboardingView: View {
    let onComplete: () -> Void
    let onSkip: () -> Void

    @State private var currentPage = 0

    private let pages: [OnboardingPage] = [
        OnboardingPage(
            icon: "music.note",
            iconColor: DesignTokens.rose,
            headline: "Create Songs That Sound Like You",
            subtext: "Turn your special moments into personalized songs with AI-powered music generation"
        ),
        OnboardingPage(
            icon: "bubble.left.and.bubble.right",
            iconColor: DesignTokens.rose,
            headline: "Tell Us Your Story",
            subtext: "Share who the song is for, the occasion, and your favorite memories. Our AI crafts lyrics just for them."
        ),
        OnboardingPage(
            icon: "mic.badge.plus",
            iconColor: DesignTokens.rose,
            headline: "Your Voice, Your Way",
            subtext: "Use AI vocals or optionally add your own voice to make songs even more personal"
        )
    ]

    var body: some View {
        ZStack {
            // Light background
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Skip button
                HStack {
                    Spacer()
                    Button("Skip") {
                        onSkip()
                    }
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(DesignTokens.textSecondary)
                    .padding(.horizontal, 24)
                    .padding(.top, 16)
                }

                // Page content
                TabView(selection: $currentPage) {
                    ForEach(0..<pages.count, id: \.self) { index in
                        OnboardingPageView(page: pages[index])
                            .tag(index)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))

                // Bottom section
                VStack(spacing: 24) {
                    // Page dots
                    HStack(spacing: 8) {
                        ForEach(0..<pages.count, id: \.self) { index in
                            Circle()
                                .fill(index == currentPage ? DesignTokens.rose : DesignTokens.cardBorder)
                                .frame(width: 8, height: 8)
                                .animation(.easeInOut(duration: 0.2), value: currentPage)
                        }
                    }

                    // Continue button
                    Button {
                        if currentPage < pages.count - 1 {
                            withAnimation {
                                currentPage += 1
                            }
                        } else {
                            onComplete()
                        }
                    } label: {
                        Text(currentPage < pages.count - 1 ? "Continue" : "Get Started")
                            .font(.system(size: 17, weight: .semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(DesignTokens.rose)
                            .foregroundColor(.white)
                            .cornerRadius(12)
                    }
                    .padding(.horizontal, 24)
                }
                .padding(.bottom, 48)
            }
        }
    }
}

// MARK: - Onboarding Page Model

struct OnboardingPage {
    let icon: String
    let iconColor: Color
    let headline: String
    let subtext: String
}

// MARK: - Onboarding Page View

struct OnboardingPageView: View {
    let page: OnboardingPage
    @State private var isAnimating = false

    var body: some View {
        VStack(spacing: 32) {
            Spacer()

            // Illustration area
            ZStack {
                // Background circle
                Circle()
                    .fill(DesignTokens.roseMuted)
                    .frame(width: 200, height: 200)

                // Decorative rings
                Circle()
                    .stroke(DesignTokens.roseLight.opacity(0.3), lineWidth: 1)
                    .frame(width: 240, height: 240)
                    .scaleEffect(isAnimating ? 1.1 : 1.0)

                Circle()
                    .stroke(DesignTokens.roseLight.opacity(0.2), lineWidth: 1)
                    .frame(width: 280, height: 280)
                    .scaleEffect(isAnimating ? 1.15 : 1.0)

                // Icon
                Image(systemName: page.icon)
                    .font(.system(size: 64, weight: .light))
                    .foregroundColor(page.iconColor)
            }
            .onAppear {
                withAnimation(.easeInOut(duration: 2).repeatForever(autoreverses: true)) {
                    isAnimating = true
                }
            }

            // Text content
            VStack(spacing: 16) {
                Text(page.headline)
                    .font(.system(size: 28, weight: .bold))
                    .foregroundColor(DesignTokens.textPrimary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)

                Text(page.subtext)
                    .font(.system(size: 17, weight: .regular))
                    .foregroundColor(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(4)
                    .padding(.horizontal, 40)
            }

            Spacer()
            Spacer()
        }
    }
}

#Preview {
    OnboardingView(
        onComplete: { print("Complete") },
        onSkip: { print("Skip") }
    )
}
