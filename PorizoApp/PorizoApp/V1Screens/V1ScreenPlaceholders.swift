//
//  V1ScreenPlaceholders.swift
//  PorizoApp
//
//  Lightweight placeholders and previews for v1.pen screens that are not yet
//  wired to backend flows. These are navigation-only surfaces.
//

import SwiftUI

// MARK: - Create Step Placeholder

struct V1CreateStepPlaceholderView: View {
    let title: String
    let subtitle: String
    let primaryPlaceholder: String
    let ctaTitle: String

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                VelvetHeader(title: "Who's this for?", showBackButton: false)

                VStack(spacing: 24) {
                    VStack(spacing: 8) {
                        Text(title)
                            .font(DesignTokens.displayFont(size: 26, weight: .semibold))
                            .foregroundColor(DesignTokens.textPrimary)
                            .multilineTextAlignment(.center)

                        Text(subtitle)
                            .font(DesignTokens.bodyFont(size: 14))
                            .foregroundColor(DesignTokens.textSecondary)
                    }
                    .padding(.top, 12)

                    VStack(spacing: 12) {
                        TextField(primaryPlaceholder, text: .constant(""))
                            .textFieldStyle(.plain)
                            .padding(16)
                            .background(DesignTokens.surface)
                            .cornerRadius(14)
                            .foregroundColor(DesignTokens.textPrimary)
                    }

                    Spacer()

                    VelvetButton(ctaTitle, style: .primary, action: {})
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 32)
            }
        }
    }
}

// MARK: - Settings Sheet (v1.pen 13)

struct V1SettingsSheetView: View {
    var body: some View {
        ZStack(alignment: .bottom) {
            Color.black.opacity(0.6)
                .ignoresSafeArea()

            VStack(spacing: 16) {
                Capsule()
                    .fill(DesignTokens.textTertiary)
                    .frame(width: 40, height: 4)
                    .padding(.top, 8)

                VStack(spacing: 12) {
                    sheetRow(icon: "person.crop.circle", title: "Profile")
                    sheetRow(icon: "wand.and.stars", title: "Voice Enrollment")
                    sheetRow(icon: "creditcard", title: "Manage Subscription")
                    sheetRow(icon: "questionmark.circle", title: "Help & Support")
                    sheetRow(icon: "arrow.right.square", title: "Sign Out")
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            }
            .frame(maxWidth: .infinity)
            .background(DesignTokens.surface)
            .clipShape(RoundedCorners(radius: 24, corners: [.topLeft, .topRight]))
        }
    }

    private func sheetRow(icon: String, title: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 18))
                .foregroundColor(DesignTokens.textPrimary)
                .frame(width: 24)

            Text(title)
                .font(DesignTokens.bodyFont(size: 16))
                .foregroundColor(DesignTokens.textPrimary)

            Spacer()
        }
        .padding(.vertical, 8)
    }
}

// MARK: - Share Song (v1.pen 17)

struct V1ShareSongView: View {
    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                HStack {
                    VelvetIconButton(icon: "xmark", action: {})
                    Spacer()
                    Text("Share Song")
                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        .foregroundColor(DesignTokens.textPrimary)
                    Spacer()
                    Color.clear.frame(width: 44, height: 44)
                }
                .padding(.horizontal, 16)
                .frame(height: 56)

                VStack(spacing: 24) {
                    VStack(spacing: 8) {
                        Image(systemName: "gift.fill")
                            .font(.system(size: 40))
                            .foregroundColor(DesignTokens.gold)
                        Text("Send this song to Chioma")
                            .font(DesignTokens.displayFont(size: 22, weight: .semibold))
                            .foregroundColor(DesignTokens.textPrimary)
                            .multilineTextAlignment(.center)
                    }

                    VStack(spacing: 12) {
                        Text("Share Link")
                            .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                            .foregroundColor(DesignTokens.textSecondary)
                            .frame(maxWidth: .infinity, alignment: .leading)

                        HStack {
                            Text("porizo.co/s/abcd1234")
                                .font(DesignTokens.bodyFont(size: 14))
                                .foregroundColor(DesignTokens.textPrimary)
                                .lineLimit(1)
                            Spacer()
                            Image(systemName: "doc.on.doc")
                                .foregroundColor(DesignTokens.gold)
                        }
                        .padding(16)
                        .background(DesignTokens.surface)
                        .cornerRadius(12)
                    }

                    VelvetButton("Share Link", icon: "square.and.arrow.up", style: .primary, action: {})
                    VelvetButton("Copy Link", icon: "link", style: .secondary, action: {})
                }
                .padding(.horizontal, 20)
                .padding(.top, 16)

                Spacer()
            }
        }
    }
}

// MARK: - Now Playing Preview (v1.pen 19)

struct V1NowPlayingPreviewView: View {
    @StateObject private var playerState = PlayerState()

    var body: some View {
        NowPlayingView(
            playerState: playerState,
            onDismiss: {},
            onPlayPause: {},
            onSeek: { _ in }
        )
        .onAppear {
            playerState.currentTrack = V1NowPlayingPreviewView.sampleTrack
            playerState.currentVersion = V1NowPlayingPreviewView.sampleVersion
            playerState.duration = 185
            playerState.currentTime = 42
            playerState.isPlaying = true
        }
    }

    private static let sampleTrack = Track(
        id: "track_preview",
        userId: "user_preview",
        title: "Song for Chioma",
        occasion: "celebration",
        recipientName: "Chioma",
        style: "soul",
        durationTarget: 180,
        voiceMode: "ai_voice",
        message: "Thank you for your strength",
        status: "ready",
        latestVersion: 1,
        shareTokenId: nil,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01"
    )

    private static let sampleVersion = TrackVersion(
        id: "version_preview",
        trackId: "track_preview",
        versionNum: 1,
        status: "ready",
        renderType: "preview",
        lyricsStatus: "approved",
        lyricsJson: nil,
        previewUrl: nil,
        fullUrl: nil,
        previewJobId: nil,
        fullJobId: nil,
        moderationStatus: nil,
        moderationReason: nil,
        createdAt: "2026-01-01",
        completedAt: "2026-01-01"
    )
}

// MARK: - Compare Plans (v1.pen 15)

struct V1ComparePlansView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var storeKit: StoreKitManager

    private let goldLabel = Color(hex: "#D4A574")
    private let checkGreen = Color(hex: "#4ADE80")

    var body: some View {
        ZStack {
            Color(hex: "#0A0A0A").ignoresSafeArea()

            VStack(spacing: 0) {
                headerBar

                ScrollView(showsIndicators: false) {
                    VStack(spacing: 0) {
                        Text("Compare all plan features")
                            .font(.system(size: 20, weight: .semibold))
                            .foregroundColor(.white)
                            .padding(.top, 20)
                            .padding(.bottom, 24)

                        VStack(spacing: 0) {
                            tableHeaderRow
                            featureRow(label: "Number of songs", free: "10/day", pro: "500/month", premier: "2,500/month", isEven: true)
                            featureRow(label: "Our most advanced\nmodel, v5", free: nil, pro: true, premier: true, isEven: false)
                            featureRow(label: "Commercial use", free: nil, pro: true, premier: true, isEven: true)
                            featureRow(label: "Pro features like\nPersonas & Remaster", free: nil, pro: true, premier: true, isEven: false)
                            featureRow(label: "Audio upload", free: "Up to 1 min", pro: "Up to 8 min", premier: "Up to 8 min", isEven: true)
                            featureRow(label: "Creation queue", free: "Shared", pro: "Priority", premier: "Priority", isEven: false)
                        }
                        .padding(.horizontal, 16)

                        footerSection
                    }
                }
            }
        }
    }

    private var headerBar: some View {
        HStack {
            Button("Close") { dismiss() }
                .foregroundColor(DesignTokens.textPrimary)
            Spacer()
            Text("Compare Plans")
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(.white)
            Spacer()
            Color.clear.frame(width: 44, height: 44)
        }
        .padding(.horizontal, 16)
        .frame(height: 56)
    }

    private var tableHeaderRow: some View {
        HStack {
            Text("Features")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(.white.opacity(0.8))
                .frame(maxWidth: .infinity, alignment: .leading)
            Text("Free")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(.white.opacity(0.8))
                .frame(width: 60)
            Text("Pro")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(goldLabel)
                .frame(width: 60)
            Text("Premier")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(goldLabel)
                .frame(width: 70)
        }
        .padding(.vertical, 10)
        .background(Color(hex: "#161616"))
        .cornerRadius(8)
    }

    private func featureRow(label: String, free: String?, pro: Any, premier: Any, isEven: Bool) -> some View {
        HStack(alignment: .top) {
            Text(label)
                .font(.system(size: 13))
                .foregroundColor(.white)
                .frame(maxWidth: .infinity, alignment: .leading)
            cellValue(free)
                .frame(width: 60)
            cellValue(pro)
                .frame(width: 60)
            cellValue(premier)
                .frame(width: 70)
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 8)
        .background(isEven ? Color(hex: "#121212") : Color(hex: "#0A0A0A"))
    }

    private func cellValue(_ value: Any?) -> some View {
        if let boolValue = value as? Bool {
            return AnyView(Image(systemName: boolValue ? "checkmark" : "xmark").foregroundColor(boolValue ? checkGreen : .red))
        }
        if let text = value as? String {
            return AnyView(Text(text).font(.system(size: 12)).foregroundColor(.white.opacity(0.8)))
        }
        return AnyView(Text("—").font(.system(size: 12)).foregroundColor(.white.opacity(0.4)))
    }

    private var footerSection: some View {
        VStack(spacing: 12) {
            Text("Upgrade anytime from Settings")
                .font(.system(size: 13))
                .foregroundColor(.white.opacity(0.7))
            Button("See Plans") { dismiss() }
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(.black)
                .padding(.vertical, 12)
                .frame(maxWidth: .infinity)
                .background(DesignTokens.gold)
                .cornerRadius(12)
        }
        .padding(.horizontal, 16)
        .padding(.top, 24)
        .padding(.bottom, 32)
    }
}

