//
//  EnrollmentCompletionView.swift
//  PorizoApp
//
//  Shows the quality tier result after voice enrollment completion.
//

import SwiftUI

#if os(iOS)

struct EnrollmentCompletionView: View {
    let qualityTier: QualityTier
    let onContinue: () -> Void

    @State private var showDetails = false
    @State private var animateIcon = false

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            // Animated success icon
            ZStack {
                Circle()
                    .fill(qualityTier.color.opacity(0.15))
                    .frame(width: 140, height: 140)

                Circle()
                    .fill(qualityTier.color.opacity(0.25))
                    .frame(width: 110, height: 110)

                Image(systemName: qualityTier.iconName)
                    .font(.system(size: 48, weight: .semibold))
                    .foregroundColor(qualityTier.color)
                    .scaleEffect(animateIcon ? 1.0 : 0.5)
                    .opacity(animateIcon ? 1.0 : 0.0)
            }
            .onAppear {
                withAnimation(.spring(response: 0.6, dampingFraction: 0.6)) {
                    animateIcon = true
                }
            }

            // Title
            VStack(spacing: 8) {
                Text("Voice Setup Complete!")
                    .font(.custom("PlayfairDisplay-Regular", size: 26))
                    .foregroundColor(DesignTokens.textPrimary)

                Text("Quality: \(qualityTier.displayName)")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundColor(qualityTier.color)
            }

            // Quality tier badge
            qualityTierBadge

            // Description
            Text(qualityTier.completionMessage)
                .font(.system(size: 15))
                .foregroundColor(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)
                .lineSpacing(4)
                .padding(.horizontal, 32)

            // Details disclosure
            if qualityTier != .excellent {
                detailsSection
            }

            Spacer()

            // Continue button
            Button(action: onContinue) {
                Text("Continue")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(DesignTokens.background)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(DesignTokens.gold)
                    .cornerRadius(28)
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
        .background(DesignTokens.background.ignoresSafeArea())
    }

    private var qualityTierBadge: some View {
        HStack(spacing: 8) {
            ForEach(QualityTier.allCases, id: \.self) { tier in
                Circle()
                    .fill(tier.ordinal <= qualityTier.ordinal ? qualityTier.color : DesignTokens.border)
                    .frame(width: 10, height: 10)
            }
        }
        .padding(.vertical, 8)
    }

    private var detailsSection: some View {
        VStack(spacing: 12) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    showDetails.toggle()
                }
            } label: {
                HStack(spacing: 6) {
                    Text("How can I improve?")
                        .font(.system(size: 14, weight: .medium))
                    Image(systemName: showDetails ? "chevron.up" : "chevron.down")
                        .font(.system(size: 12, weight: .semibold))
                }
                .foregroundColor(DesignTokens.gold)
            }
            .buttonStyle(.plain)

            if showDetails {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(qualityTier.improvementTips, id: \.self) { tip in
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: "lightbulb.fill")
                                .font(.system(size: 12))
                                .foregroundColor(DesignTokens.gold)
                                .padding(.top, 2)

                            Text(tip)
                                .font(.system(size: 13))
                                .foregroundColor(DesignTokens.textSecondary)
                        }
                    }
                }
                .padding(16)
                .background(DesignTokens.surface)
                .cornerRadius(12)
                .padding(.horizontal, 24)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }
}

// MARK: - Previews
// Note: QualityTier is now defined in Models.swift

#Preview("Excellent Tier") {
    EnrollmentCompletionView(qualityTier: .excellent) { }
}

#Preview("Good Tier") {
    EnrollmentCompletionView(qualityTier: .good) { }
}

#Preview("Fair Tier") {
    EnrollmentCompletionView(qualityTier: .fair) { }
}

#Preview("Basic Tier") {
    EnrollmentCompletionView(qualityTier: .basic) { }
}

#Preview("Minimal Tier") {
    EnrollmentCompletionView(qualityTier: .minimal) { }
}

#endif
