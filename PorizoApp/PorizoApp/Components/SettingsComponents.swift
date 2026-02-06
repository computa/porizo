//
//  SettingsComponents.swift
//  PorizoApp
//
//  Reusable components for the Settings view following competitor app patterns.
//  Uses DesignTokens consistently for colors, spacing, and shadows.
//

import SwiftUI

// MARK: - Settings Section

/// A grouped container for settings rows with optional header.
/// White background, 16pt radius, level1 shadow.
struct SettingsSection<Content: View>: View {
    let header: String?
    @ViewBuilder let content: () -> Content

    init(header: String? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.header = header
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing8) {
            // Section header (uppercase, muted)
            if let header = header {
                Text(header.uppercased())
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundColor(DesignTokens.textTertiary)
                    .padding(.horizontal, DesignTokens.spacing4)
            }

            // Content container
            VStack(spacing: 0) {
                content()
            }
            .background(DesignTokens.surface)
            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusLarge))
            .elevation(.level1)
        }
    }
}

// MARK: - Settings Row

/// Standard settings row with icon, label, optional value, and optional chevron.
/// 56pt height, icon in 32x32 rounded square.
struct SettingsRow: View {
    let icon: String
    var iconBackground: Color = DesignTokens.gold.opacity(0.15)
    var iconColor: Color = DesignTokens.gold
    let title: String
    var subtitle: String? = nil
    var value: String? = nil
    var isDestructive: Bool = false
    var showChevron: Bool = true
    var showDivider: Bool = true
    var action: (() -> Void)? = nil

    var body: some View {
        Button(action: { action?() }) {
            HStack(spacing: DesignTokens.spacing12) {
                // Icon container (32x32, 8pt radius)
                ZStack {
                    RoundedRectangle(cornerRadius: DesignTokens.spacing8)
                        .fill(isDestructive ? DesignTokens.error.opacity(0.1) : iconBackground)
                        .frame(width: 32, height: 32)

                    Image(systemName: icon)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundColor(isDestructive ? DesignTokens.error : iconColor)
                }

                // Title and subtitle
                VStack(alignment: .leading, spacing: DesignTokens.spacing2) {
                    Text(title)
                        .font(.body)
                        .foregroundColor(isDestructive ? DesignTokens.error : DesignTokens.textPrimary)

                    if let subtitle = subtitle {
                        Text(subtitle)
                            .font(.caption)
                            .foregroundColor(DesignTokens.textSecondary)
                    }
                }

                Spacer()

                // Value (if any)
                if let value = value {
                    Text(value)
                        .font(.subheadline)
                        .foregroundColor(DesignTokens.textSecondary)
                }

                // Chevron
                if showChevron && !isDestructive {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(DesignTokens.textTertiary)
                }
            }
            .frame(height: 56)
            .padding(.horizontal, DesignTokens.spacing16)
            .contentShape(Rectangle())
        }
        .buttonStyle(SettingsRowButtonStyle())
        .overlay(alignment: .bottom) {
            if showDivider {
                Divider()
                    .padding(.leading, 60) // Icon width + spacing + padding
            }
        }
    }
}

// MARK: - Settings Row Button Style

/// Custom button style for settings rows with subtle press feedback.
struct SettingsRowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? DesignTokens.surface : Color.clear)
    }
}

// MARK: - Settings Link Row

/// Settings row that wraps a Link for external URLs.
struct SettingsLinkRow: View {
    let icon: String
    var iconBackground: Color = DesignTokens.gold.opacity(0.15)
    var iconColor: Color = DesignTokens.gold
    let title: String
    let url: URL
    var showDivider: Bool = true

    var body: some View {
        Link(destination: url) {
            HStack(spacing: DesignTokens.spacing12) {
                // Icon container
                ZStack {
                    RoundedRectangle(cornerRadius: DesignTokens.spacing8)
                        .fill(iconBackground)
                        .frame(width: 32, height: 32)

                    Image(systemName: icon)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundColor(iconColor)
                }

                Text(title)
                    .font(.body)
                    .foregroundColor(DesignTokens.textPrimary)

                Spacer()

                Image(systemName: "arrow.up.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(DesignTokens.textTertiary)
            }
            .frame(height: 56)
            .padding(.horizontal, DesignTokens.spacing16)
            .contentShape(Rectangle())
        }
        .overlay(alignment: .bottom) {
            if showDivider {
                Divider()
                    .padding(.leading, 60)
            }
        }
    }
}

// MARK: - Voice Banner

/// Promotional banner for voice enrollment feature.
/// Rose gradient background with prominent CTA.
struct VoiceBanner: View {
    let hasProfile: Bool
    let qualityScore: Double?
    let isLoading: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: DesignTokens.spacing16) {
                // Icon
                ZStack {
                    Circle()
                        .fill(Color.white.opacity(0.2))
                        .frame(width: 48, height: 48)

                    if isLoading {
                        ProgressView()
                            .tint(.white)
                    } else {
                        Image(systemName: hasProfile ? "waveform.circle.fill" : "mic.fill")
                            .font(.system(size: 24))
                            .foregroundColor(.white)
                    }
                }

                // Text content
                VStack(alignment: .leading, spacing: DesignTokens.spacing4) {
                    if hasProfile {
                        HStack(spacing: DesignTokens.spacing4) {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.caption)
                            Text("Voice Profile Active")
                                .font(.headline)
                        }
                        .foregroundColor(.white)

                        if let score = qualityScore {
                            Text("Quality: \(Int(score))%")
                                .font(.caption)
                                .foregroundColor(.white.opacity(0.8))
                        }
                    } else {
                        Text("Your Voice")
                            .font(.headline)
                            .foregroundColor(.white)

                        Text("Add your voice to songs")
                            .font(.subheadline)
                            .foregroundColor(.white.opacity(0.8))
                    }
                }

                Spacer()

                // CTA
                if !hasProfile && !isLoading {
                    Text("Set Up")
                        .font(.subheadline.bold())
                        .foregroundColor(DesignTokens.gold)
                        .padding(.horizontal, DesignTokens.spacing12)
                        .padding(.vertical, DesignTokens.spacing8)
                        .background(Color.white)
                        .clipShape(Capsule())
                } else if hasProfile {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.white.opacity(0.6))
                }
            }
            .padding(DesignTokens.spacing16)
            .background(
                LinearGradient(
                    colors: [DesignTokens.gold, DesignTokens.gold],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusLarge))
            .elevation(.level2)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Account Avatar

/// User avatar with initials for settings.
struct AccountAvatar: View {
    let initials: String
    var size: CGFloat = 44

    var body: some View {
        ZStack {
            Circle()
                .fill(DesignTokens.gold.opacity(0.15))
                .frame(width: size, height: size)

            Text(initials)
                .font(.system(size: size * 0.4, weight: .semibold))
                .foregroundColor(DesignTokens.gold)
        }
    }
}

// MARK: - App Version Footer

/// Footer showing app version and tagline.
struct AppVersionFooter: View {
    var body: some View {
        VStack(spacing: DesignTokens.spacing4) {
            Text("Version \(appVersion)")
                .font(.caption)
                .foregroundColor(DesignTokens.textTertiary)

            HStack(spacing: DesignTokens.spacing4) {
                Text("Made with")
                Image(systemName: "heart.fill")
                    .font(.caption)
                    .foregroundColor(DesignTokens.gold)
                Text("in Perth")
            }
            .font(.caption)
            .foregroundColor(DesignTokens.textTertiary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, DesignTokens.spacing16)
    }

    private var appVersion: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "\(version) (\(build))"
    }
}

// MARK: - Preview

#Preview("Settings Section") {
    ScrollView {
        VStack(spacing: DesignTokens.spacing28) {
            SettingsSection(header: "Account") {
                SettingsRow(
                    icon: "person.fill",
                    title: "Profile",
                    subtitle: "john@example.com"
                )
                SettingsRow(
                    icon: "creditcard.fill",
                    title: "Subscription",
                    value: "Pro",
                    showDivider: false
                )
            }

            SettingsSection(header: "Support") {
                SettingsRow(
                    icon: "questionmark.circle.fill",
                    title: "Help Center"
                )
                SettingsRow(
                    icon: "envelope.fill",
                    title: "Contact Us",
                    showDivider: false
                )
            }

            SettingsSection {
                SettingsRow(
                    icon: "rectangle.portrait.and.arrow.right",
                    title: "Sign Out",
                    isDestructive: true,
                    showChevron: false
                )
                SettingsRow(
                    icon: "trash.fill",
                    title: "Delete Account",
                    isDestructive: true,
                    showDivider: false
                )
            }
        }
        .padding(DesignTokens.spacing16)
    }
    .background(DesignTokens.surface)
}

#Preview("Voice Banner - Not Enrolled") {
    VoiceBanner(
        hasProfile: false,
        qualityScore: nil,
        isLoading: false,
        onTap: {}
    )
    .padding()
}

#Preview("Voice Banner - Enrolled") {
    VoiceBanner(
        hasProfile: true,
        qualityScore: 85,
        isLoading: false,
        onTap: {}
    )
    .padding()
}
