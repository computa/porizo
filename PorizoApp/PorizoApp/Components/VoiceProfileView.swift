//
//  VoiceProfileView.swift
//  PorizoApp
//
//  Displays existing voice profile info with option to re-enroll.
//  Users can "Try Again" without risking their current profile quality.
//

import SwiftUI

#if os(iOS)

struct VoiceProfileView: View {
    let profile: VoiceProfileStatus
    let onTryAgain: () -> Void
    let onDismiss: () -> Void

    @State private var showTips = false

    private var qualityTier: QualityTier {
        if let score = profile.qualityScore {
            return QualityTier(from: score)
        }
        return .minimal
    }

    var body: some View {
        NavigationStack {
            ZStack {
                DesignTokens.background.ignoresSafeArea()

                VStack(spacing: 24) {
                    Spacer()

                    // Quality badge circle
                    qualityBadge

                    // Profile info
                    profileInfo

                    // Tips section (if not excellent)
                    if qualityTier != .excellent {
                        tipsSection
                    }

                    Spacer()

                    // Try Again button
                    tryAgainButton

                    // Protection note
                    Text("Your current profile is kept unless the new one is better")
                        .font(.system(size: 12))
                        .foregroundStyle(DesignTokens.textTertiary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                        .padding(.bottom, 24)
                }
                .padding(.horizontal, 20)
            }
            .navigationTitle("Voice Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        onDismiss()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 24))
                            .foregroundStyle(DesignTokens.textTertiary)
                    }
                    .accessibilityLabel("Close voice profile")
                }
            }
        }
    }

    // MARK: - Quality Badge

    private var qualityBadge: some View {
        ZStack {
            // Outer glow
            Circle()
                .fill(qualityTier.color.opacity(0.15))
                .frame(width: 140, height: 140)

            // Inner circle
            Circle()
                .fill(qualityTier.color.opacity(0.25))
                .frame(width: 110, height: 110)

            // Score percentage
            VStack(spacing: 2) {
                Text("\(Int(profile.qualityScore ?? 0))%")
                    .font(.system(size: 36, weight: .bold, design: .rounded))
                    .foregroundStyle(qualityTier.color)

                Text(qualityTier.displayName)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(qualityTier.color)
            }
        }
    }

    // MARK: - Profile Info

    private var profileInfo: some View {
        VStack(spacing: 12) {
            // Stars indicator
            HStack(spacing: 4) {
                ForEach(0..<3, id: \.self) { index in
                    Image(systemName: index < qualityTier.ordinal ? "star.fill" : "star")
                        .font(.system(size: 16))
                        .foregroundStyle(index < qualityTier.ordinal ? DesignTokens.gold : DesignTokens.textTertiary)
                }
            }

            // Disclosure text
            Text(qualityTier.completionMessage)
                .font(.system(size: 15))
                .foregroundStyle(DesignTokens.textSecondary)
                .multilineTextAlignment(.center)
                .lineSpacing(4)
                .padding(.horizontal, 24)

            // Created date
            if let createdAt = profile.createdAt {
                Text("Profile created \(formatDate(createdAt))")
                    .font(.system(size: 12))
                    .foregroundStyle(DesignTokens.textTertiary)
            }
        }
    }

    // MARK: - Tips Section

    private var tipsSection: some View {
        VStack(spacing: 12) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    showTips.toggle()
                }
            } label: {
                HStack(spacing: 6) {
                    Text("How can I improve?")
                        .font(.system(size: 14, weight: .medium))
                    Image(systemName: showTips ? "chevron.up" : "chevron.down")
                        .font(.system(size: 12, weight: .semibold))
                }
                .foregroundStyle(DesignTokens.gold)
            }
            .buttonStyle(.plain)

            if showTips {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(qualityTier.improvementTips, id: \.self) { tip in
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: "lightbulb.fill")
                                .font(.system(size: 12))
                                .foregroundStyle(DesignTokens.gold)
                                .padding(.top, 2)

                            Text(tip)
                                .font(.system(size: 13))
                                .foregroundStyle(DesignTokens.textSecondary)
                        }
                    }
                }
                .padding(16)
                .background(DesignTokens.surface)
                .clipShape(.rect(cornerRadius: 12))
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }

    // MARK: - Try Again Button

    private var tryAgainButton: some View {
        Button(action: onTryAgain) {
            HStack(spacing: 8) {
                Image(systemName: "arrow.counterclockwise")
                    .font(.system(size: 16, weight: .semibold))
                Text("Try Again")
                    .font(.system(size: 16, weight: .semibold))
            }
            .foregroundStyle(DesignTokens.background)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(DesignTokens.gold)
            .clipShape(.rect(cornerRadius: 28))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Helpers

    private func formatDate(_ isoString: String) -> String {
        let strategy = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
        if let date = try? Date(isoString, strategy: strategy) {
            return formatRelativeDate(date)
        }
        if let date = try? Date(isoString, strategy: .iso8601) {
            return formatRelativeDate(date)
        }
        return ""
    }

    private func formatRelativeDate(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        return formatter.localizedString(for: date, relativeTo: Date.now)
    }
}

// MARK: - Previews

#Preview("Excellent Profile") {
    VoiceProfileView(
        profile: VoiceProfileStatus(
            profileId: "test-1",
            status: "active",
            qualityScore: 85,
            qualityTier: "excellent",
            createdAt: Date.now.addingTimeInterval(-86400 * 7).formatted(.iso8601)
        ),
        onTryAgain: { },
        onDismiss: { }
    )
}

#Preview("Fair Profile") {
    VoiceProfileView(
        profile: VoiceProfileStatus(
            profileId: "test-2",
            status: "active",
            qualityScore: 59,
            qualityTier: "fair",
            createdAt: Date.now.addingTimeInterval(-86400 * 3).formatted(.iso8601)
        ),
        onTryAgain: { },
        onDismiss: { }
    )
}

#Preview("Basic Profile") {
    VoiceProfileView(
        profile: VoiceProfileStatus(
            profileId: "test-3",
            status: "active",
            qualityScore: 35,
            qualityTier: "basic",
            createdAt: Date.now.addingTimeInterval(-86400).formatted(.iso8601)
        ),
        onTryAgain: { },
        onDismiss: { }
    )
}

#endif
