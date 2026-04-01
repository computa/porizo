//
//  SharePostcardView.swift
//  PorizoApp
//
//  Postcard share screen with social media preview mockups.
//  Shows what the shared link will look like on iMessage, WhatsApp,
//  and Instagram DM — giving users confidence before sending.
//

import SwiftUI

struct SharePostcardView: View {
    let recipientName: String
    let occasion: String?
    let onSend: () -> Void
    let onSaveToPhotos: () -> Void
    let onCopyLink: () -> Void
    let onSkip: () -> Void

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // MARK: - Navigation Bar

                navigationBar

                // MARK: - Scrollable Content

                ScrollView(showsIndicators: false) {
                    VStack(spacing: DesignTokens.spacing20) {
                        postcardCard
                        sectionHeader
                        iMessagePreview
                        whatsAppPreview
                        instagramDMPreview
                        ctaSection
                    }
                    .padding(.horizontal, DesignTokens.spacing20)
                    .padding(.bottom, 32)
                }
            }
        }
    }

    // MARK: - Navigation Bar

    private var navigationBar: some View {
        HStack {
            Button(action: onSkip) {
                ZStack {
                    Circle()
                        .fill(Color.black.opacity(0.05))
                        .frame(width: 44, height: 44)

                    Image(systemName: "arrow.left")
                        .font(.system(size: 18))
                        .foregroundStyle(DesignTokens.textPrimary)
                }
            }
            .accessibilityLabel("Go back")

            Spacer()

            Text("Your Song")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(DesignTokens.textPrimary)

            Spacer()

            // Spacer to balance the back button
            Color.clear
                .frame(width: 44, height: 44)
        }
        .padding(.horizontal, DesignTokens.spacing20)
        .padding(.vertical, DesignTokens.spacing12)
    }

    // MARK: - Postcard Card

    private var postcardCard: some View {
        ZStack(alignment: .bottomTrailing) {
            VStack(alignment: .leading, spacing: 0) {
                // "For {name}" in Fraunces
                Text("For \(recipientName)")
                    .font(DesignTokens.displayFont(size: 28))
                    .foregroundStyle(.white)

                // Waveform bars
                waveformBars
                    .padding(.top, DesignTokens.spacing16)

                // Occasion subtitle
                if let subtitle = occasion.flatMap({ Occasion(rawValue: $0)?.greeting }) {
                    Text(subtitle)
                        .font(DesignTokens.bodyFont(size: 16))
                        .foregroundStyle(.white.opacity(0.9))
                        .padding(.top, DesignTokens.spacing12)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(32)

            // "porizo" attribution
            Text("porizo")
                .font(DesignTokens.bodyFont(size: 11))
                .foregroundStyle(.white.opacity(0.5))
                .padding(.trailing, 16)
                .padding(.bottom, 12)
        }
        .background(
            LinearGradient(
                colors: [DesignTokens.gold, DesignTokens.roseGold],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    // MARK: - Waveform Bars

    private var waveformBars: some View {
        HStack(spacing: 4) {
            ForEach(barHeights, id: \.offset) { item in
                RoundedRectangle(cornerRadius: 2)
                    .fill(.white)
                    .frame(width: 4, height: item.element)
            }
        }
        .frame(height: 28)
        .accessibilityHidden(true)
    }

    /// Bar heights matching the prototype: 8, 14, 20, 24, 20, 14, 8
    private var barHeights: [(offset: Int, element: CGFloat)] {
        let heights: [CGFloat] = [8, 14, 20, 24, 20, 14, 8]
        return Array(heights.enumerated())
    }

    // MARK: - Section Header

    private var sectionHeader: some View {
        Text("HOW IT LOOKS WHEN SHARED")
            .font(DesignTokens.bodyFont(size: 13, weight: .semibold))
            .foregroundStyle(DesignTokens.textSecondary)
            .tracking(0.5)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, DesignTokens.spacing4)
    }

    // MARK: - iMessage Preview

    private var iMessagePreview: some View {
        socialPreviewCard(platform: "iMessage") {
            VStack(alignment: .trailing, spacing: 0) {
                // Blue bubble with sender text
                Text("I made you something special \u{1F382}")
                    .font(.system(size: 14))
                    .foregroundStyle(Color(hex: "#1A1A1A"))
                    .padding(12)
                    .background(Color(hex: "#E8F0FE"))
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                    .frame(maxWidth: 260, alignment: .trailing)
                    .padding(.bottom, DesignTokens.spacing8)

                // Rich link card
                VStack(spacing: 0) {
                    // Coral-amber gradient header
                    richLinkGradientHeader(
                        title: "For \(recipientName)",
                        subtitle: occasion.flatMap { Occasion(rawValue: $0)?.greeting },
                        showMiniWaveform: true,
                        height: 120
                    )

                    // Link details
                    VStack(alignment: .leading, spacing: 2) {
                        Text("A song made just for you")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Color(hex: "#1A1A1A"))
                        Text("porizo.app")
                            .font(.system(size: 11))
                            .foregroundStyle(Color(hex: "#999999"))
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                }
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(Color(hex: "#E0E0E0"), lineWidth: 1)
                )
                .frame(maxWidth: 260, alignment: .trailing)
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
    }

    // MARK: - WhatsApp Preview

    private var whatsAppPreview: some View {
        socialPreviewCard(platform: "WhatsApp") {
            VStack(alignment: .trailing, spacing: 0) {
                // Green bubble
                VStack(alignment: .leading, spacing: 0) {
                    // Link card inside bubble
                    HStack(alignment: .top, spacing: 10) {
                        // Thumbnail
                        ZStack {
                            RoundedRectangle(cornerRadius: 6)
                                .fill(
                                    LinearGradient(
                                        colors: [DesignTokens.gold, DesignTokens.roseGold],
                                        startPoint: .topLeading,
                                        endPoint: .bottomTrailing
                                    )
                                )
                                .frame(width: 56, height: 56)

                            VStack(spacing: 0) {
                                Text("For")
                                    .font(DesignTokens.displayFont(size: 11))
                                    .foregroundStyle(.white)
                                Text(recipientName)
                                    .font(DesignTokens.displayFont(size: 11))
                                    .foregroundStyle(.white)
                            }
                            .lineSpacing(0)
                        }

                        // Text content
                        VStack(alignment: .leading, spacing: 2) {
                            Text("A song made just for you")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Color(hex: "#1A1A1A"))
                                .lineLimit(2)

                            Text("Someone special created a personalized \(occasionWord) song for \(recipientName)")
                                .font(.system(size: 11))
                                .foregroundStyle(Color(hex: "#666666"))
                                .lineLimit(2)

                            Text("porizo.app")
                                .font(.system(size: 10))
                                .foregroundStyle(Color(hex: "#999999"))
                                .padding(.top, 2)
                        }
                    }
                    .padding(8)
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .overlay(
                        RoundedRectangle(cornerRadius: 6)
                            .stroke(Color(hex: "#E8E8E8"), lineWidth: 1)
                    )

                    // Message text
                    Text("Listen to this! \u{1F3B5}\u{1F495}")
                        .font(.system(size: 13))
                        .foregroundStyle(Color(hex: "#303030"))
                        .padding(.horizontal, 4)
                        .padding(.top, 6)
                        .padding(.bottom, 2)

                    // Timestamp
                    Text("10:42 AM \u{2713}\u{2713}")
                        .font(.system(size: 10))
                        .foregroundStyle(Color(hex: "#667781"))
                        .frame(maxWidth: .infinity, alignment: .trailing)
                        .padding(.horizontal, 4)
                        .padding(.bottom, 2)
                }
                .padding(6)
                .background(Color(hex: "#DCF8C6"))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .frame(maxWidth: 270, alignment: .trailing)
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
    }

    // MARK: - Instagram DM Preview

    private var instagramDMPreview: some View {
        socialPreviewCard(platform: "Instagram DM") {
            VStack(alignment: .trailing, spacing: 4) {
                // IG gradient bubble with message
                Text("I made you something \u{1F495}")
                    .font(.system(size: 13))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(
                        LinearGradient(
                            colors: [
                                Color(hex: "#405DE6"),
                                Color(hex: "#833AB4"),
                                Color(hex: "#C13584")
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 18))
                    .frame(maxWidth: 240, alignment: .trailing)

                // Dark card with coral-amber header
                VStack(spacing: 0) {
                    // Gradient header
                    richLinkGradientHeader(
                        title: "For \(recipientName)",
                        subtitle: occasion.flatMap { Occasion(rawValue: $0)?.songLabel },
                        showMiniWaveform: false,
                        height: 100
                    )

                    // Link details on dark background
                    VStack(alignment: .leading, spacing: 1) {
                        Text("A song made just for you")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(.white)
                        Text("porizo.app")
                            .font(.system(size: 10))
                            .foregroundStyle(Color(hex: "#8E8E8E"))
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .background(Color(hex: "#262626"))
                }
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .frame(maxWidth: 220, alignment: .trailing)
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
    }

    // MARK: - CTAs

    private var ctaSection: some View {
        VStack(spacing: DesignTokens.spacing12) {
            // Primary: "Send this postcard"
            Button(action: onSend) {
                Text("Send this postcard")
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(DesignTokens.gold)
                    .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
            }
            .accessibilityLabel("Send this postcard to \(recipientName)")

            // Secondary row: "Save to Photos" | "Copy Link"
            HStack(spacing: DesignTokens.spacing12) {
                Button(action: onSaveToPhotos) {
                    Text("Save to Photos")
                        .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                        .foregroundStyle(DesignTokens.goldDark)
                }
                .accessibilityLabel("Save postcard to Photos")

                Text("\u{2022}")
                    .foregroundStyle(DesignTokens.textTertiary)

                Button(action: onCopyLink) {
                    Text("Copy Link")
                        .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                        .foregroundStyle(DesignTokens.goldDark)
                }
                .accessibilityLabel("Copy share link")
            }
            .padding(.vertical, DesignTokens.spacing4)

            // Tertiary: "Skip sharing"
            Button(action: onSkip) {
                Text("Skip sharing")
                    .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                    .foregroundStyle(DesignTokens.textSecondary)
            }
            .accessibilityLabel("Skip sharing and go home")
        }
        .padding(.top, DesignTokens.spacing4)
    }

    // MARK: - Reusable Components

    /// Wraps a social preview in a white card with platform label.
    private func socialPreviewCard<Content: View>(
        platform: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacing8) {
            Text(platform)
                .font(.system(size: 11))
                .foregroundStyle(DesignTokens.textTertiary)

            content()
        }
        .padding(14)
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(DesignTokens.border, lineWidth: 1)
        )
    }

    /// Coral-to-amber gradient header used inside rich link cards.
    private func richLinkGradientHeader(
        title: String,
        subtitle: String?,
        showMiniWaveform: Bool,
        height: CGFloat
    ) -> some View {
        VStack(spacing: 4) {
            Text(title)
                .font(DesignTokens.displayFont(size: height > 100 ? 18 : 16))
                .foregroundStyle(.white)
                .shadow(color: .black.opacity(0.15), radius: 8, y: 1)

            if let subtitle = subtitle {
                Text(subtitle)
                    .font(.system(size: height > 100 ? 12 : 11))
                    .foregroundStyle(.white.opacity(height > 100 ? 0.8 : 0.7))
            }

            if showMiniWaveform {
                miniWaveform
                    .padding(.top, 2)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: height)
        .background(
            LinearGradient(
                colors: [DesignTokens.gold, DesignTokens.roseGold],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
    }

    /// Small waveform for rich link card headers.
    private var miniWaveform: some View {
        let heights: [CGFloat] = [8, 12, 6, 14, 8]
        return HStack(spacing: 2) {
            ForEach(Array(heights.enumerated()), id: \.offset) { item in
                RoundedRectangle(cornerRadius: 1)
                    .fill(.white.opacity(0.5))
                    .frame(width: 2, height: item.element)
            }
        }
    }



    /// Lowercase occasion type for natural sentence construction (e.g., "birthday", "anniversary").
    private var occasionWord: String {
        guard let occasion = occasion?.lowercased() else { return "personal" }
        switch occasion {
        case "birthday": return "birthday"
        case "anniversary": return "anniversary"
        case "thank_you": return "thank you"
        case "i_love_you": return "love"
        case "wedding": return "wedding"
        case "graduation": return "graduation"
        case "friendship": return "friendship"
        case "encouragement": return "encouragement"
        case "advice": return "advice"
        case "bereavement": return "memorial"
        case "apology": return "apology"
        case "get_well": return "get well"
        case "celebration": return "celebration"
        default: return "personal"
        }
    }
}

// MARK: - Preview

#Preview("Birthday") {
    SharePostcardView(
        recipientName: "Sarah",
        occasion: "birthday",
        onSend: {},
        onSaveToPhotos: {},
        onCopyLink: {},
        onSkip: {}
    )
}

#Preview("No Occasion") {
    SharePostcardView(
        recipientName: "Mom",
        occasion: nil,
        onSend: {},
        onSaveToPhotos: {},
        onCopyLink: {},
        onSkip: {}
    )
}

#Preview("Long Name") {
    SharePostcardView(
        recipientName: "Alexandra",
        occasion: "anniversary",
        onSend: {},
        onSaveToPhotos: {},
        onCopyLink: {},
        onSkip: {}
    )
}
