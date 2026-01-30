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

// MARK: - Quality Tier Model

enum QualityTier: String, CaseIterable {
    case excellent
    case good
    case fair
    case basic
    case minimal

    var displayName: String {
        switch self {
        case .excellent: return "Excellent"
        case .good: return "Good"
        case .fair: return "Fair"
        case .basic: return "Basic"
        case .minimal: return "Minimal"
        }
    }

    var ordinal: Int {
        switch self {
        case .excellent: return 4
        case .good: return 3
        case .fair: return 2
        case .basic: return 1
        case .minimal: return 0
        }
    }

    var color: Color {
        switch self {
        case .excellent: return .green
        case .good: return Color(red: 0.4, green: 0.8, blue: 0.4)
        case .fair: return .yellow
        case .basic: return .orange
        case .minimal: return Color.orange.opacity(0.8)
        }
    }

    var iconName: String {
        switch self {
        case .excellent: return "star.circle.fill"
        case .good: return "checkmark.circle.fill"
        case .fair: return "checkmark.circle"
        case .basic: return "exclamationmark.circle"
        case .minimal: return "exclamationmark.triangle"
        }
    }

    var completionMessage: String {
        switch self {
        case .excellent:
            return "Your voice profile is ready for the best possible song quality. Songs will sound natural and expressive."
        case .good:
            return "Your voice profile is ready. Songs will sound great with clear vocal quality."
        case .fair:
            return "Your voice profile is ready. Some background noise may affect vocal clarity."
        case .basic:
            return "Your voice profile is ready with basic quality. Re-record in a quieter space for better results."
        case .minimal:
            return "Your voice profile can be used, but quality may be limited. Consider re-recording for better songs."
        }
    }

    var improvementTips: [String] {
        switch self {
        case .excellent:
            return []
        case .good:
            return [
                "Speak a bit closer to your phone for even clearer audio",
                "Try a room with soft furnishings to reduce echo"
            ]
        case .fair:
            return [
                "Find a quieter environment away from traffic or appliances",
                "Hold your phone 6-8 inches from your mouth",
                "Close windows and doors to reduce background noise"
            ]
        case .basic, .minimal:
            return [
                "Record in a quiet room with the door closed",
                "Turn off fans, AC, and other noisy appliances",
                "Speak clearly at a natural volume",
                "Hold your phone steady, 6-8 inches from your mouth",
                "Try recording at a different time when it's quieter"
            ]
        }
    }

    init(from score: Double) {
        switch score {
        case 80...: self = .excellent
        case 60..<80: self = .good
        case 40..<60: self = .fair
        case 20..<40: self = .basic
        default: self = .minimal
        }
    }

    init(from backendTier: String) {
        self = QualityTier(rawValue: backendTier.lowercased()) ?? .minimal
    }
}

// MARK: - Previews

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
