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

    // MARK: - Featured Card

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
            .frame(height: 200)
            .cornerRadius(16)
            .overlay(
                // Decorative waveform pattern
                WaveformVisualizer(barCount: 7, maxHeight: 60, animated: false)
                    .opacity(0.3)
            )

            // Text overlay
            VStack(alignment: .leading, spacing: 4) {
                Text("The")
                    .font(DesignTokens.displayFont(size: 24))
                    .foregroundColor(.white)
                Text("music")
                    .font(DesignTokens.displayFont(size: 24))
                    .foregroundColor(.white)
            }
            .padding(16)
        }
        .frame(height: 200)
    }

    // MARK: - Stats Row

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
            .frame(height: 120)
            .cornerRadius(12)

            // Stats overlay
            HStack(spacing: 16) {
                // Play count
                HStack(spacing: 4) {
                    Image(systemName: "play.fill")
                        .font(.system(size: 12))
                    Text("24K")
                        .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                }
                .foregroundColor(.white)

                // Like count
                HStack(spacing: 4) {
                    Image(systemName: "hand.thumbsup.fill")
                        .font(.system(size: 12))
                    Text("378")
                        .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                }
                .foregroundColor(.white)

                // Comment count
                HStack(spacing: 4) {
                    Image(systemName: "bubble.left.fill")
                        .font(.system(size: 12))
                    Text("9")
                        .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                }
                .foregroundColor(.white)
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 12)
        }
        .frame(height: 120)
    }

    // MARK: - Quick Create Section

    private var quickCreateSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Create Something")
                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                .foregroundColor(DesignTokens.textPrimary)

            HStack(spacing: 12) {
                // Song button
                quickCreateButton(
                    icon: "music.note",
                    label: "New Song",
                    color: DesignTokens.gold
                ) {
                    onOccasionSelected(.birthday) // Default occasion
                }

                // Poem button
                quickCreateButton(
                    icon: "scroll",
                    label: "New Poem",
                    color: Color(hex: "#A855F7")
                ) {
                    // TODO: Navigate to poem creation
                }
            }
        }
        .padding(.top, 8)
    }

    private func quickCreateButton(icon: String, label: String, color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 24))
                    .foregroundColor(color)

                Text(label)
                    .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                    .foregroundColor(DesignTokens.textPrimary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 20)
            .background(DesignTokens.surface)
            .cornerRadius(12)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(DesignTokens.borderSubtle, lineWidth: 1)
            )
        }
    }

    // MARK: - Occasions Section

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

            LazyVGrid(columns: [
                GridItem(.flexible()),
                GridItem(.flexible())
            ], spacing: 12) {
                ForEach(Occasion.allCases.prefix(4)) { occasion in
                    OccasionCard(occasion: occasion) {
                        onOccasionSelected(occasion)
                    }
                }
            }
        }
        .padding(.top, 8)
    }

    // MARK: - Refresh

    private func refreshContent() async {
        // TODO: Replace with actual API calls when ready
        try? await Task.sleep(for: .milliseconds(500))
    }
}

// MARK: - Occasion Card (Velvet Style)

struct OccasionCard: View {
    let occasion: Occasion
    let onTap: () -> Void

    var body: some View {
        Button {
            let generator = UIImpactFeedbackGenerator(style: .light)
            generator.impactOccurred()
            onTap()
        } label: {
            VStack(spacing: 8) {
                Text(occasion.emoji)
                    .font(.system(size: 28))
                    .accessibilityHidden(true)

                Text(occasion.displayName)
                    .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                    .foregroundColor(DesignTokens.textPrimary)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 20)
            .background(DesignTokens.surface)
            .cornerRadius(12)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(DesignTokens.borderSubtle, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(occasion.displayName)
        .accessibilityHint("Double tap to create a \(occasion.displayName.lowercased()) song")
    }
}

#Preview {
    ExploreTabView(
        apiClient: APIClient(baseURL: AppConfig.apiBaseURL),
        onOccasionSelected: { _ in }
    )
}
