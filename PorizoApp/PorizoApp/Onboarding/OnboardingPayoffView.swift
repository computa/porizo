//
//  OnboardingPayoffView.swift
//  PorizoApp
//
//  Screen 9: The Payoff — personalized song suggestion with "Make This Song" CTA.
//  Shows fallback immediately, replaces with server response if available.
//

import SwiftUI

/// Codable song suggestion used throughout onboarding.
/// Produced by `FallbackSuggestion` locally or decoded from the server response.
struct OnboardingSuggestion: Codable, Sendable {
    let title: String
    let emotionalAngle: String
    let previewLine: String
    let source: String

    enum CodingKeys: String, CodingKey {
        case title
        case emotionalAngle = "emotional_angle"
        case previewLine = "preview_line"
        case source
    }
}

struct OnboardingPayoffView: View {
    let recipientName: String
    let suggestion: OnboardingSuggestion?
    let isLoading: Bool
    let onCreateTapped: () -> Void
    let onSkip: () -> Void

    var body: some View {
        OnboardingScreenShell(accessibilityId: "onboarding-payoff") {
            VStack(spacing: DesignTokens.spacing24) {
                Text("Your first forever gift\nfor \(recipientName)")
                    .font(DesignTokens.displayFont(size: 28))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .multilineTextAlignment(.center)

                if let suggestion {
                    suggestionCard(suggestion)
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("Song suggestion: \(suggestion.title). \(suggestion.emotionalAngle). \(suggestion.previewLine)")
                } else {
                    shimmerCard
                        .accessibilityLabel("Loading your song suggestion")
                }

                if isLoading {
                    ProgressView()
                        .tint(DesignTokens.gold)
                        .scaleEffect(0.8)
                }
            }
            .padding(.horizontal, DesignTokens.spacing20)
        } bottom: {
            VStack(spacing: DesignTokens.spacing12) {
                Button(action: onCreateTapped) {
                    HStack(spacing: DesignTokens.spacing8) {
                        Image(systemName: "sparkles")
                            .font(.system(size: 16))
                        Text("Make This Song")
                            .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(DesignTokens.gold)
                    .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
                }
                .goldGlow()
                .accessibilityIdentifier("onboarding-payoff-create")

                Button(action: onSkip) {
                    Text("Maybe later")
                        .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                        .foregroundStyle(DesignTokens.textSecondary)
                }
                .accessibilityIdentifier("onboarding-payoff-skip")
            }
            .padding(.horizontal, DesignTokens.spacing20)
            .padding(.bottom, 40)
        }
    }

    // MARK: - Suggestion Card

    private func suggestionCard(_ suggestion: OnboardingSuggestion) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing12) {
            // Song cover + title row
            HStack(spacing: DesignTokens.spacing12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10)
                        .fill(
                            LinearGradient(
                                colors: [DesignTokens.gold, DesignTokens.goldGradientEnd],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 56, height: 56)
                    Image(systemName: "music.note")
                        .font(.system(size: 20))
                        .foregroundStyle(.white)
                }

                VStack(alignment: .leading, spacing: DesignTokens.spacing4) {
                    Text(suggestion.title)
                        .font(DesignTokens.bodyFont(size: 15, weight: .semibold))
                        .foregroundStyle(DesignTokens.textPrimary)
                    Text(suggestion.emotionalAngle)
                        .font(DesignTokens.bodyFont(size: 13))
                        .foregroundStyle(DesignTokens.textSecondary)
                        .lineLimit(2)
                }
            }

            // Preview line
            Text(suggestion.previewLine)
                .font(DesignTokens.displayFont(size: 14, relativeTo: .body))
                .foregroundStyle(DesignTokens.textSecondary)
                .italic()
                .lineLimit(2)
                .lineSpacing(3)
        }
        .padding(DesignTokens.spacing16)
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
        .overlay(
            RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                .stroke(DesignTokens.border, lineWidth: 0.5)
        )
        .elevation(.level2)
    }

    // MARK: - Shimmer / Skeleton

    private var shimmerCard: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing12) {
            HStack(spacing: DesignTokens.spacing12) {
                RoundedRectangle(cornerRadius: 10)
                    .fill(DesignTokens.surfaceMuted)
                    .frame(width: 56, height: 56)
                VStack(alignment: .leading, spacing: DesignTokens.spacing8) {
                    RoundedRectangle(cornerRadius: 4)
                        .fill(DesignTokens.surfaceMuted)
                        .frame(width: 140, height: 14)
                    RoundedRectangle(cornerRadius: 4)
                        .fill(DesignTokens.surfaceMuted)
                        .frame(width: 200, height: 12)
                }
            }
            RoundedRectangle(cornerRadius: 4)
                .fill(DesignTokens.surfaceMuted)
                .frame(height: 12)
            RoundedRectangle(cornerRadius: 4)
                .fill(DesignTokens.surfaceMuted)
                .frame(width: 160, height: 12)
        }
        .padding(DesignTokens.spacing16)
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
        .overlay(
            RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                .stroke(DesignTokens.border, lineWidth: 0.5)
        )
    }
}
