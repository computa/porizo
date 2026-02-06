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
            icon: "waveform",
            iconSize: 48,
            headline: "Every moment\ndeserves a song",
            subtext: "Create personalized songs that sound like you singing, for the people you love."
        ),
        OnboardingPage(
            icon: "sparkles",
            iconSize: 44,
            headline: "Create in\nseconds",
            subtext: "Pick an occasion, write a message, and we'll craft a unique song in under 90 seconds."
        ),
        OnboardingPage(
            icon: "gift",
            iconSize: 44,
            headline: "Share the\nfeeling",
            subtext: "Send your song as a gift link. They'll hear your voice singing just for them."
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
                    .font(DesignTokens.bodyFont(size: 16, weight: .medium))
                    .foregroundColor(DesignTokens.textSecondary)
                    .padding(.horizontal, 20)
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
                        HStack(spacing: 8) {
                            Text(currentPage < pages.count - 1 ? "Continue" : "Get Started")
                                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                            if currentPage == pages.count - 1 {
                                Image(systemName: "arrow.right")
                                    .font(.system(size: 14, weight: .semibold))
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(DesignTokens.gold)
                        .foregroundColor(DesignTokens.background)
                        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
                    }
                    .padding(.horizontal, 20)
                }
                .padding(.bottom, 44)
            }
        }
    }

    private var pageIndicator: some View {
        HStack(spacing: 8) {
            ForEach(0..<pages.count, id: \.self) { index in
                Circle()
                    .fill(index == currentPage ? DesignTokens.gold : DesignTokens.textTertiary.opacity(0.4))
                    .frame(width: 8, height: 8)
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
    let iconSize: CGFloat
    let headline: String
    let subtext: String
}

// MARK: - Onboarding Page View

struct OnboardingPageView: View {
    let page: OnboardingPage

    var body: some View {
        VStack(spacing: 20) {
            Spacer()

            // Icon circle
            ZStack {
                Circle()
                    .fill(DesignTokens.gold.opacity(0.12))
                    .frame(width: 96, height: 96)
                Image(systemName: page.icon)
                    .font(.system(size: page.iconSize))
                    .foregroundColor(DesignTokens.gold)
            }
            .accessibilityHidden(true)

            // Title
            Text(page.headline)
                .font(DesignTokens.displayFont(size: 28))
                .foregroundColor(DesignTokens.textPrimary)
                .multilineTextAlignment(.center)
                .lineSpacing(4)
                .padding(.horizontal, 32)

            // Subtitle
            Text(page.subtext)
                .font(DesignTokens.bodyFont(size: 15))
                .foregroundColor(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)
                .lineSpacing(4)
                .padding(.horizontal, 32)

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
