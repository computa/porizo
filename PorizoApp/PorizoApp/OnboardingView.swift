//
//  OnboardingView.swift
//  PorizoApp
//
//  Three-page onboarding wizard introducing Porizo's value proposition.
//  Light mode design with the shared gradient background.
//

import SwiftUI

struct OnboardingView: View {
    let onComplete: () -> Void
    let onSkip: () -> Void

    @State private var currentPage = 0

    private let pages: [OnboardingPage] = [
        OnboardingPage(
            icon: "music.note",
            iconColor: DesignTokens.gold,
            headline: "Create Songs That Sound Like You",
            subtext: "Turn your special moments into personalized songs with AI-powered music generation",
            highlights: ["Your voice", "Your memories", "Your style"],
            footnote: "No studio, no stress"
        ),
        OnboardingPage(
            icon: "bubble.left.and.bubble.right",
            iconColor: DesignTokens.gold,
            headline: "Tell Us Your Story",
            subtext: "Share who the song is for, the occasion, and your favorite memories. We help shape the story.",
            highlights: ["Who it's for", "What happened", "How it felt"],
            footnote: "We guide you with smart prompts"
        ),
        OnboardingPage(
            icon: "mic.badge.plus",
            iconColor: DesignTokens.gold,
            headline: "Your Voice, Your Way",
            subtext: "Use AI vocals or optionally add your own voice to make songs even more personal",
            highlights: ["AI vocals", "Record yours", "Optional"],
            footnote: "Add your voice anytime"
        )
    ]

    var body: some View {
        ZStack {
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
                VStack(spacing: 20) {
                    pageIndicator

                    Button {
                        if currentPage < pages.count - 1 {
                            withAnimation(.easeInOut(duration: 0.25)) {
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
                            .background(DesignTokens.gold)
                            .foregroundColor(.white)
                            .cornerRadius(14)
                            .accentShadow()
                    }
                    .padding(.horizontal, 24)
                }
                .padding(.bottom, 44)
            }
        }
    }

    private var pageIndicator: some View {
        HStack(spacing: 8) {
            ForEach(0..<pages.count, id: \.self) { index in
                Capsule()
                    .fill(index == currentPage ? DesignTokens.gold : DesignTokens.borderSubtle)
                    .frame(width: index == currentPage ? 18 : 8, height: 8)
                    .animation(.easeInOut(duration: 0.2), value: currentPage)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Page \(currentPage + 1) of \(pages.count)")
        .accessibilityValue(pages[currentPage].headline)
    }
}

// MARK: - Onboarding Page Model

struct OnboardingPage {
    let icon: String
    let iconColor: Color
    let headline: String
    let subtext: String
    let highlights: [String]
    let footnote: String
}

// MARK: - Onboarding Page View

struct OnboardingPageView: View {
    let page: OnboardingPage
    @State private var isAnimating = false

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            heroIllustration

            VStack(spacing: 16) {
                Text(page.headline)
                    .font(.system(size: 28, weight: .bold))
                    .foregroundColor(DesignTokens.textPrimary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 28)

                Text(page.subtext)
                    .font(.system(size: 17, weight: .regular))
                    .foregroundColor(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(4)
                    .padding(.horizontal, 40)

                highlightsGrid

                Text(page.footnote)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(DesignTokens.textSecondary)
            }
            .padding(.vertical, 20)
            .padding(.horizontal, 20)
            .background(DesignTokens.surface.opacity(0.95))
            .cornerRadius(20)
            .overlay(
                RoundedRectangle(cornerRadius: 20)
                    .stroke(DesignTokens.borderSubtle, lineWidth: 1)
            )
            .cardShadow()

            Spacer()
            Spacer()
        }
    }

    private var heroIllustration: some View {
        ZStack {
            Circle()
                .fill(
                    LinearGradient(
                        colors: [DesignTokens.gold.opacity(0.15), DesignTokens.gold.opacity(0.7)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .frame(width: 190, height: 190)

            Circle()
                .stroke(DesignTokens.gold.opacity(0.25), lineWidth: 1)
                .frame(width: 230, height: 230)
                .scaleEffect(isAnimating ? 1.08 : 1.0)

            Circle()
                .stroke(DesignTokens.gold.opacity(0.18), lineWidth: 1)
                .frame(width: 265, height: 265)
                .scaleEffect(isAnimating ? 1.12 : 1.0)

            Image(systemName: page.icon)
                .font(.system(size: 64, weight: .light))
                .foregroundColor(page.iconColor)
                .shadow(color: DesignTokens.gold.opacity(0.2), radius: 10, y: 6)
        }
        .accessibilityHidden(true)
        .onAppear {
            withAnimation(.easeInOut(duration: 2.2).repeatForever(autoreverses: true)) {
                isAnimating = true
            }
        }
    }

    private var highlightsGrid: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 120))], spacing: 10) {
            ForEach(page.highlights, id: \.self) { highlight in
                Text(highlight)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(DesignTokens.gold)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(DesignTokens.gold.opacity(0.15))
                    .cornerRadius(16)
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
