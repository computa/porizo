//
//  ExploreTabView.swift
//  PorizoApp
//
//  Explore tab with featured songs, templates, and occasions.
//  Extracted from MainTabView for better modularity.
//

import SwiftUI

// MARK: - Explore Tab View

struct ExploreTabView: View {
    let apiClient: APIClient
    let onOccasionSelected: (Occasion) -> Void

    var body: some View {
        NavigationStack {
            ZStack {
                DesignTokens.backgroundSubtle.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 28) {
                        // Fresh Hits Section
                        sectionHeader(title: "Fresh Hits", subtitle: "Newest creations")

                        VStack(spacing: 16) {
                            ForEach(sampleFreshHits, id: \.id) { song in
                                FeaturedSongCard(song: song)
                            }
                        }
                        .padding(.horizontal)

                        // Top Songs Section (Ranked)
                        sectionHeader(title: "Top Songs", subtitle: "Most played this week")

                        VStack(spacing: 16) {
                            ForEach(sampleTopSongs, id: \.id) { song in
                                RankedSongCard(song: song)
                            }
                        }
                        .padding(.horizontal)

                        // Popular Occasions
                        sectionHeader(title: "Popular Occasions", subtitle: "Start with an occasion")

                        LazyVGrid(columns: [
                            GridItem(.flexible()),
                            GridItem(.flexible())
                        ], spacing: 16) {
                            ForEach(Occasion.allCases) { occasion in
                                OccasionCard(occasion: occasion) {
                                    onOccasionSelected(occasion)
                                }
                            }
                        }
                        .padding(.horizontal)

                    }
                    .padding(.top, 20)
                    // Bottom padding removed - MainTabView handles spacing
                }
                .refreshable {
                    await refreshContent()
                }
            }
            .navigationTitle("Explore")
        }
    }

    // MARK: - Refresh

    private func refreshContent() async {
        // TODO: Replace with actual API calls when ready
        // For now, simulate a brief refresh delay
        try? await Task.sleep(for: .milliseconds(500))
    }

    private func sectionHeader(title: String, subtitle: String) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.headline)
                    .foregroundColor(DesignTokens.textPrimary)
                Text(subtitle)
                    .font(.caption)
                    .foregroundColor(DesignTokens.textSecondary)
            }
            Spacer()
            Button("See All") {
                // TODO: Navigate to full list
            }
            .font(.caption)
            .foregroundColor(DesignTokens.rose)
        }
        .padding(.horizontal)
    }

    // Sample data for explore
    private var sampleFreshHits: [FeaturedSong] {
        [
            FeaturedSong(id: "fresh-001", title: "Mom's 60th", creator: "James K.", occasion: "birthday", style: "Soul", plays: 234),
            FeaturedSong(id: "fresh-002", title: "Our Story", creator: "Maria S.", occasion: "anniversary", style: "Acoustic", plays: 189),
            FeaturedSong(id: "fresh-003", title: "Thank You Coach", creator: "David R.", occasion: "thank_you", style: "Pop", plays: 156),
            FeaturedSong(id: "fresh-004", title: "Forever Yours", creator: "Michael T.", occasion: "i_love_you", style: "R&B", plays: 198),
        ]
    }

    private var sampleTopSongs: [RankedSongData] {
        [
            RankedSongData(id: "top-001", rank: 1, title: "Happy Birthday Dad", creator: "Sarah J.", occasion: "birthday", style: "Soul", plays: 1247),
            RankedSongData(id: "top-002", rank: 2, title: "10 Year Anniversary", creator: "Chris L.", occasion: "anniversary", style: "Acoustic", plays: 1089),
            RankedSongData(id: "top-003", rank: 3, title: "Graduation Day", creator: "Emma W.", occasion: "graduation", style: "Pop", plays: 967),
        ]
    }
}

// MARK: - Featured Song Data

struct FeaturedSong {
    let id: String
    let title: String
    let creator: String
    let occasion: String  // For occasion-based artwork
    let style: String     // Music style
    let plays: Int
}

struct RankedSongData {
    let id: String
    let rank: Int
    let title: String
    let creator: String
    let occasion: String  // For occasion-based artwork
    let style: String     // Music style
    let plays: Int
}

// MARK: - Featured Song Card

struct FeaturedSongCard: View {
    let song: FeaturedSong

    var body: some View {
        HStack(spacing: 12) {
            // Square artwork (100pt) with occasion-based gradient
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(occasionGradient)
                    .frame(width: 100, height: 100)

                // Occasion-based icon
                Image(systemName: occasionIcon)
                    .font(.system(size: 40))
                    .foregroundColor(.white.opacity(0.9))
            }

            // Title and subtitle
            VStack(alignment: .leading, spacing: 6) {
                // Title - bold, prominent
                Text(song.title)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundColor(DesignTokens.textPrimary)
                    .lineLimit(1)

                // Subtitle - "Style • By Creator"
                Text("\(song.style) • By \(song.creator)")
                    .font(.system(size: 14))
                    .foregroundColor(DesignTokens.textSecondary)
                    .lineLimit(1)

                // Play count
                HStack(spacing: 4) {
                    Image(systemName: "play.fill")
                        .font(.caption2)
                    Text("\(song.plays) plays")
                        .font(.caption)
                }
                .foregroundColor(DesignTokens.textTertiary)
            }

            Spacer()

            // Three-dot menu
            Menu {
                Button {
                    // Play action
                } label: {
                    Label("Play", systemImage: "play.fill")
                }

                Button {
                    // Share action
                } label: {
                    Label("Share", systemImage: "square.and.arrow.up")
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(DesignTokens.textSecondary)
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
            }
        }
        .padding(12)
        .background(DesignTokens.cardBackground)
        .cornerRadius(16)
        .cardShadow()
    }

    // Occasion-based icon
    private var occasionIcon: String {
        switch song.occasion {
        case "birthday": return "birthday.cake.fill"
        case "anniversary": return "heart.circle.fill"
        case "thank_you": return "hands.clap.fill"
        case "i_love_you": return "heart.fill"
        case "wedding": return "bell.fill"
        case "graduation": return "graduationcap.fill"
        case "friendship": return "person.2.fill"
        case "encouragement": return "star.fill"
        case "apology": return "hand.raised.fill"
        case "get_well": return "cross.case.fill"
        default: return "music.note"
        }
    }

    // Occasion-based gradient background
    private var occasionGradient: LinearGradient {
        let colors: [Color]
        switch song.occasion {
        case "birthday":
            colors = [Color(hex: "#ec4899"), Color(hex: "#f472b6")]
        case "anniversary":
            colors = [Color(hex: "#f43f5e"), Color(hex: "#fb7185")]
        case "thank_you":
            colors = [Color(hex: "#f59e0b"), Color(hex: "#fbbf24")]
        case "i_love_you":
            colors = [Color(hex: "#ef4444"), Color(hex: "#f87171")]
        case "wedding":
            colors = [Color(hex: "#a855f7"), Color(hex: "#c084fc")]
        case "graduation":
            colors = [Color(hex: "#3b82f6"), Color(hex: "#60a5fa")]
        case "friendship":
            colors = [Color(hex: "#06b6d4"), Color(hex: "#22d3ee")]
        case "encouragement":
            colors = [Color(hex: "#10b981"), Color(hex: "#34d399")]
        default:
            colors = [DesignTokens.rose, DesignTokens.roseLight]
        }
        return LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

// MARK: - Ranked Song Card

struct RankedSongCard: View {
    let song: RankedSongData

    var body: some View {
        HStack(spacing: 12) {
            // Rank number (overlaid on card)
            Text("\(song.rank)")
                .font(.system(size: 24, weight: .bold))
                .foregroundColor(rankColor)
                .frame(width: 28)

            // Square artwork (100pt) with occasion-based gradient
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(occasionGradient)
                    .frame(width: 100, height: 100)

                // Occasion-based icon
                Image(systemName: occasionIcon)
                    .font(.system(size: 40))
                    .foregroundColor(.white.opacity(0.9))
            }

            // Title and subtitle
            VStack(alignment: .leading, spacing: 6) {
                // Title - bold, prominent
                Text(song.title)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundColor(DesignTokens.textPrimary)
                    .lineLimit(1)

                // Subtitle - "Style • By Creator"
                Text("\(song.style) • By \(song.creator)")
                    .font(.system(size: 14))
                    .foregroundColor(DesignTokens.textSecondary)
                    .lineLimit(1)

                // Play count
                HStack(spacing: 4) {
                    Image(systemName: "play.fill")
                        .font(.caption2)
                    Text("\(song.plays) plays")
                        .font(.caption)
                }
                .foregroundColor(DesignTokens.textTertiary)
            }

            Spacer()

            // Three-dot menu
            Menu {
                Button {
                    // Play action
                } label: {
                    Label("Play", systemImage: "play.fill")
                }

                Button {
                    // Share action
                } label: {
                    Label("Share", systemImage: "square.and.arrow.up")
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(DesignTokens.textSecondary)
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
            }
        }
        .padding(12)
        .background(DesignTokens.cardBackground)
        .cornerRadius(16)
        .cardShadow()
    }

    private var rankColor: Color {
        switch song.rank {
        case 1: return Color(hex: "#fbbf24")  // Gold
        case 2: return Color(hex: "#9ca3af")  // Silver
        case 3: return Color(hex: "#d97706")  // Bronze
        default: return DesignTokens.textSecondary
        }
    }

    // Occasion-based icon
    private var occasionIcon: String {
        switch song.occasion {
        case "birthday": return "birthday.cake.fill"
        case "anniversary": return "heart.circle.fill"
        case "thank_you": return "hands.clap.fill"
        case "i_love_you": return "heart.fill"
        case "wedding": return "bell.fill"
        case "graduation": return "graduationcap.fill"
        case "friendship": return "person.2.fill"
        case "encouragement": return "star.fill"
        case "apology": return "hand.raised.fill"
        case "get_well": return "cross.case.fill"
        default: return "music.note"
        }
    }

    // Occasion-based gradient background
    private var occasionGradient: LinearGradient {
        let colors: [Color]
        switch song.occasion {
        case "birthday":
            colors = [Color(hex: "#ec4899"), Color(hex: "#f472b6")]
        case "anniversary":
            colors = [Color(hex: "#f43f5e"), Color(hex: "#fb7185")]
        case "thank_you":
            colors = [Color(hex: "#f59e0b"), Color(hex: "#fbbf24")]
        case "i_love_you":
            colors = [Color(hex: "#ef4444"), Color(hex: "#f87171")]
        case "wedding":
            colors = [Color(hex: "#a855f7"), Color(hex: "#c084fc")]
        case "graduation":
            colors = [Color(hex: "#3b82f6"), Color(hex: "#60a5fa")]
        case "friendship":
            colors = [Color(hex: "#06b6d4"), Color(hex: "#22d3ee")]
        case "encouragement":
            colors = [Color(hex: "#10b981"), Color(hex: "#34d399")]
        default:
            colors = [DesignTokens.rose, DesignTokens.roseLight]
        }
        return LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

// MARK: - Template Card

struct TemplateCard: View {
    let title: String
    let occasion: String
    let style: String
    let emoji: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Cover with rose-muted background
            RoundedRectangle(cornerRadius: 10)
                .fill(DesignTokens.roseMuted)
                .frame(height: 80)
                .overlay(
                    Text(emoji)
                        .font(.system(size: 32))
                )

            // Title
            Text(title)
                .font(.subheadline.bold())
                .foregroundColor(DesignTokens.textPrimary)
                .lineLimit(2)

            // Style badge
            Text(style)
                .font(.caption2)
                .foregroundColor(.white)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(DesignTokens.rose)
                .cornerRadius(4)

            Spacer()

            // Use button
            Button {
                // TODO: Launch create flow with template
            } label: {
                Text("Use Template")
                    .font(.caption.bold())
                    .foregroundColor(DesignTokens.rose)
            }
        }
        .frame(width: 150, height: 200)
        .padding()
        .background(DesignTokens.cardBackground)
        .cornerRadius(16)
        .subtleShadow()
    }
}

// MARK: - Occasion Card

struct OccasionCard: View {
    let occasion: Occasion
    let onTap: () -> Void

    var body: some View {
        Button {
            let generator = UIImpactFeedbackGenerator(style: .light)
            generator.impactOccurred()
            onTap()
        } label: {
            VStack(spacing: 12) {
                Text(occasion.emoji)
                    .font(.system(size: 36))
                    .accessibilityHidden(true)

                Text(occasion.displayName)
                    .font(.subheadline.weight(.medium))
                    .foregroundColor(DesignTokens.textPrimary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 24)
            .background(DesignTokens.cardBackground)
            .cornerRadius(16)
            .subtleShadow()
        }
        .buttonStyle(.plain)
        .accessibilityLabel(occasion.displayName)
        .accessibilityHint("Double tap to create a \(occasion.displayName.lowercased()) song")
    }
}

// MARK: - Inspiration Card

struct InspirationCard: View {
    let title: String
    let subtitle: String
    let color: Color
    let icon: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundColor(color)

            Text(title)
                .font(.subheadline.bold())
                .foregroundColor(DesignTokens.textPrimary)

            Text(subtitle)
                .font(.caption)
                .foregroundColor(DesignTokens.textSecondary)
        }
        .frame(width: 140)
        .padding()
        .background(DesignTokens.cardBackground)
        .cornerRadius(16)
        .subtleShadow()
    }
}

#Preview {
    ExploreTabView(
        apiClient: APIClient(baseURL: "http://localhost:3000"),
        onOccasionSelected: { _ in }
    )
}
