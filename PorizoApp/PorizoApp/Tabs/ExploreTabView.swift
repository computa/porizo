//
//  ExploreTabView.swift
//  PorizoApp
//
//  Home tab matching v1.pen "06 - Explore" design.
//  Feed-style discovery with featured content and engagement stats.
//

import SwiftUI

// MARK: - Explore Tab View

struct ExploreTabView: View {
    let apiClient: APIClient
    let onOccasionSelected: (Occasion) -> Void
    let onCreate: () -> Void

    @State private var showFeatureBanner = true

    var body: some View {
        ZStack {
            // Background: Deep velvet black
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header: "Explore" in gold Playfair Display
                exploreHeader

                ScrollView {
                    VStack(spacing: 16) {
                        // Feature Banner (dismissible)
                        if showFeatureBanner {
                            featureBanner
                        }

                        // Featured Card
                        featuredCard

                        // Stats Row
                        statsRow

                        // Quick Create Section
                        quickCreateSection

                        // Popular Occasions Grid
                        occasionsSection
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 8)
                    .padding(.bottom, 120) // Space for tab bar
                }
                .refreshable {
                    await refreshContent()
                }
            }
        }
    }

    // MARK: - Header

    private var exploreHeader: some View {
        HStack {
            Text("Explore")
                .font(DesignTokens.displayFont(size: 28))
                .foregroundColor(DesignTokens.gold)

            Spacer()

            // Header actions
            HStack(spacing: 16) {
                Button {
                    // Search action
                } label: {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 20))
                        .foregroundColor(DesignTokens.textPrimary)
                }

                Button {
                    // Notifications
                } label: {
                    Image(systemName: "bell")
                        .font(.system(size: 20))
                        .foregroundColor(DesignTokens.textPrimary)
                }
            }
        }
        .padding(.horizontal, 20)
        .frame(height: 56)
    }

    // MARK: - Feature Banner

    private var featureBanner: some View {
        HStack(spacing: 8) {
            Image(systemName: "arrow.triangle.2.circlepath")
                .font(.system(size: 16))
                .foregroundColor(DesignTokens.gold)

            Text("Introducing Remixing")
                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                .foregroundColor(DesignTokens.textPrimary)

            Text("NEW")
                .font(DesignTokens.bodyFont(size: 10, weight: .semibold))
                .foregroundColor(DesignTokens.background)
                .padding(.horizontal, 8)
                .padding(.vertical, 2)
                .background(DesignTokens.gold)
                .cornerRadius(4)

            Spacer()

            Button {
                withAnimation(.easeOut(duration: 0.2)) {
                    showFeatureBanner = false
                }
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 16))
                    .foregroundColor(DesignTokens.textTertiary)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 8)
        .background(Color(hex: "#1A1A1A"))
    }

    // MARK: - Featured Card (Compact)

    private var featuredCard: some View {
        ZStack(alignment: .bottomLeading) {
            // Background gradient (placeholder for image)
            LinearGradient(
                colors: [
                    DesignTokens.gold.opacity(0.8),
                    DesignTokens.gold.opacity(0.3)
                ],
                startPoint: .topTrailing,
                endPoint: .bottomLeading
            )
            .frame(height: 140)
            .cornerRadius(16)
            .overlay(
                // Decorative waveform pattern
                WaveformVisualizer(barCount: 7, maxHeight: 40, animated: false)
                    .opacity(0.3)
            )

            // Text overlay
            VStack(alignment: .leading, spacing: 2) {
                Text("The")
                    .font(DesignTokens.displayFont(size: 20))
                    .foregroundColor(.white)
                Text("music")
                    .font(DesignTokens.displayFont(size: 20))
                    .foregroundColor(.white)
            }
            .padding(12)
        }
        .frame(height: 140)
    }

    // MARK: - Stats Row (Compact)

    private var statsRow: some View {
        ZStack(alignment: .bottomLeading) {
            // Background gradient
            LinearGradient(
                colors: [
                    Color(hex: "#2A2A2A"),
                    Color(hex: "#1A1A1A")
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: 80)
            .cornerRadius(12)

            // Stats overlay
            HStack(spacing: 16) {
                // Play count
                HStack(spacing: 4) {
                    Image(systemName: "play.fill")
                        .font(.system(size: 11))
                    Text("24K")
                        .font(DesignTokens.bodyFont(size: 11, weight: .medium))
                }
                .foregroundColor(.white)

                // Like count
                HStack(spacing: 4) {
                    Image(systemName: "hand.thumbsup.fill")
                        .font(.system(size: 11))
                    Text("378")
                        .font(DesignTokens.bodyFont(size: 11, weight: .medium))
                }
                .foregroundColor(.white)

                // Comment count
                HStack(spacing: 4) {
                    Image(systemName: "bubble.left.fill")
                        .font(.system(size: 11))
                    Text("9")
                        .font(DesignTokens.bodyFont(size: 11, weight: .medium))
                }
                .foregroundColor(.white)
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 10)
        }
        .frame(height: 80)
    }

    // MARK: - Quick Create Section

    private var quickCreateSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button {
                let generator = UIImpactFeedbackGenerator(style: .medium)
                generator.impactOccurred()
                onCreate()
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 20))

                    Text("Express yourself, for them")
                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                }
                .foregroundColor(DesignTokens.background)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .background(
                    LinearGradient(
                        colors: [DesignTokens.gold, DesignTokens.gold.opacity(0.85)],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
                .cornerRadius(14)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Express yourself, for them")
            .accessibilityHint("Opens creation menu to make a song or poem")
        }
        .padding(.top, 8)
    }

    // MARK: - Occasions Section (Horizontal Chips)

    private var occasionsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Popular Occasions")
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    .foregroundColor(DesignTokens.textPrimary)

                Spacer()

                Button("See All") {
                    // TODO: Show all occasions
                }
                .font(DesignTokens.bodyFont(size: 14))
                .foregroundColor(DesignTokens.gold)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Occasion.allCases) { occasion in
                        occasionChip(occasion)
                    }
                }
            }
        }
        .padding(.top, 8)
    }

    private func occasionChip(_ occasion: Occasion) -> some View {
        Button {
            let generator = UIImpactFeedbackGenerator(style: .light)
            generator.impactOccurred()
            onOccasionSelected(occasion)
        } label: {
            HStack(spacing: 6) {
                Text(occasion.emoji)
                    .font(.system(size: 14))
                Text(occasion.displayName)
                    .font(DesignTokens.bodyFont(size: 14, weight: .medium))
            }
            .foregroundColor(DesignTokens.textPrimary)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(DesignTokens.surface)
            .cornerRadius(22)
            .overlay(
                RoundedRectangle(cornerRadius: 22)
                    .stroke(DesignTokens.borderSubtle, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(occasion.displayName)
        .accessibilityHint("Double tap to create a \(occasion.displayName.lowercased()) song")
    }

    // MARK: - Refresh

    private func refreshContent() async {
        // TODO: Replace with actual API calls when ready
        try? await Task.sleep(for: .milliseconds(500))
    }
}

#Preview {
    ExploreTabView(
        apiClient: APIClient(baseURL: AppConfig.apiBaseURL),
        onOccasionSelected: { _ in },
        onCreate: { }
    )
}
