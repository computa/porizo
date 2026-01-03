//
//  MainTabView.swift
//  PorizoApp
//
//  Main tab bar shell with prominent center Create button.
//  Light mode with rose accent - conveying love and friendship.
//

import SwiftUI

// DesignTokens and Color(hex:) extension are now in DesignTokens.swift

struct MainTabView: View {
    let apiClient: APIClient

    @State private var selectedTab: Tab = .songs
    @State private var showCreateFlow = false
    @State private var preselectedOccasion: Occasion?

    // Track creation state (passed to create flow)
    @State private var currentTrackId: String?
    @State private var currentVersionNum: Int?

    enum Tab: Int, CaseIterable {
        case songs = 0
        case poems = 1
        case create = 2
        case explore = 3
        case settings = 4

        var title: String {
            switch self {
            case .songs: return "Songs"
            case .poems: return "Poems"
            case .create: return "Create"
            case .explore: return "Explore"
            case .settings: return "Settings"
            }
        }

        var icon: String {
            switch self {
            case .songs: return "music.note.list"
            case .poems: return "text.book.closed"
            case .create: return "plus.circle.fill"
            case .explore: return "safari"
            case .settings: return "gearshape"
            }
        }
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            // Light background
            DesignTokens.backgroundSubtle.ignoresSafeArea()

            // Content area
            TabView(selection: $selectedTab) {
                // Songs Tab
                SongsTabView(
                    apiClient: apiClient,
                    onDraftSelected: { trackId, versionNum in
                        currentTrackId = trackId
                        currentVersionNum = versionNum
                        showCreateFlow = true
                    }
                )
                .tag(Tab.songs)

                // Poems Tab
                PoemsTabView(apiClient: apiClient)
                    .tag(Tab.poems)

                // Create Tab (placeholder - actual flow is modal)
                Color.clear
                    .tag(Tab.create)

                // Explore Tab
                ExploreTabView(
                    apiClient: apiClient,
                    onOccasionSelected: { occasion in
                        preselectedOccasion = occasion
                        showCreateFlow = true
                    }
                )
                .tag(Tab.explore)

                // Settings Tab
                SettingsTabView(apiClient: apiClient)
                    .tag(Tab.settings)
            }

            // Custom Tab Bar
            customTabBar
        }
        .fullScreenCover(isPresented: $showCreateFlow) {
            CreateFlowView(
                apiClient: apiClient,
                preselectedOccasion: preselectedOccasion,
                resumeTrackId: currentTrackId,
                resumeVersionNum: currentVersionNum,
                onComplete: { trackId, versionNum in
                    currentTrackId = trackId
                    currentVersionNum = versionNum
                    showCreateFlow = false
                    preselectedOccasion = nil
                    selectedTab = .songs
                },
                onCancel: {
                    showCreateFlow = false
                    preselectedOccasion = nil
                    currentTrackId = nil
                    currentVersionNum = nil
                }
            )
        }
        .onChange(of: selectedTab) { _, newTab in
            if newTab == .create {
                currentTrackId = nil
                currentVersionNum = nil
                preselectedOccasion = nil
                showCreateFlow = true
                // Reset to previous tab since Create is a modal
                selectedTab = .songs
            }
        }
    }

    // MARK: - Custom Tab Bar

    private var customTabBar: some View {
        HStack(spacing: 0) {
            ForEach(Tab.allCases, id: \.rawValue) { tab in
                if tab == .create {
                    // Prominent center button
                    createButton
                } else {
                    tabButton(for: tab)
                }
            }
        }
        .padding(.horizontal, 8)
        .padding(.top, 8)
        .padding(.bottom, 24) // Safe area
        .background(
            DesignTokens.cardBackground
                .shadow(color: Color.black.opacity(0.05), radius: 8, y: -4)
                .ignoresSafeArea()
        )
    }

    private func tabButton(for tab: Tab) -> some View {
        Button {
            selectedTab = tab
        } label: {
            VStack(spacing: 4) {
                Image(systemName: tab.icon)
                    .font(.system(size: 22))
                Text(tab.title)
                    .font(.caption2)
            }
            .foregroundColor(selectedTab == tab ? DesignTokens.rose : DesignTokens.textSecondary)
            .frame(maxWidth: .infinity)
        }
    }

    private var createButton: some View {
        Button {
            currentTrackId = nil
            currentVersionNum = nil
            preselectedOccasion = nil
            showCreateFlow = true
        } label: {
            ZStack {
                // Solid rose circle (no gradient per design guide)
                Circle()
                    .fill(DesignTokens.rose)
                    .frame(width: 56, height: 56)
                    .shadow(color: DesignTokens.rose.opacity(0.3), radius: 8, y: 4)

                Image(systemName: "plus")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundColor(.white)
            }
            .offset(y: -16) // Raise above tab bar
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Songs Tab View

struct SongsTabView: View {
    let apiClient: APIClient
    var onDraftSelected: ((String, Int) -> Void)?

    var body: some View {
        NavigationStack {
            MySongsView(
                apiClient: apiClient,
                onCreateNew: { },
                onBack: { },
                onDraftSelected: onDraftSelected
            )
        }
    }
}

// MARK: - Poems Tab View

struct PoemsTabView: View {
    let apiClient: APIClient
    var onCreatePoem: (() -> Void)?

    @State private var poems: [Poem] = []
    @State private var isLoading = true
    @State private var selectedPoem: Poem?
    @State private var showPoemDetail = false

    // Sample data for preview (until API is ready)
    private let samplePoems: [Poem] = [
        Poem(
            id: "poem-001",
            userId: "user-001",
            title: "For My Mother",
            recipientName: "Mom",
            occasion: "thank_you",
            tone: "heartfelt",
            status: "complete",
            verses: [
                "Through every storm, you held my hand,",
                "When I was lost, you helped me stand.",
                "Your love, a beacon shining bright,",
                "Has guided me through darkest night.",
                "",
                "No words could ever fully say,",
                "How much you mean to me each day.",
                "But Mom, I hope that you can see,",
                "The world you've given, just by being free."
            ],
            createdAt: "2024-01-15T14:00:00Z",
            updatedAt: "2024-01-15T14:00:00Z"
        ),
        Poem(
            id: "poem-002",
            userId: "user-001",
            title: "Our Five Years",
            recipientName: "Sarah",
            occasion: "anniversary",
            tone: "heartfelt",
            status: "complete",
            verses: [
                "Five years ago, we took a chance,",
                "Two hearts that dared to join the dance.",
                "Through laughter, tears, and everything between,",
                "You're still the best I've ever seen.",
                "",
                "Sarah, my love, my partner, my friend,",
                "I'll choose you over and over again.",
                "Here's to five more, and fifty more after,",
                "A lifetime of love, joy, and laughter."
            ],
            createdAt: "2024-01-12T19:30:00Z",
            updatedAt: "2024-01-12T19:30:00Z"
        )
    ]

    var body: some View {
        NavigationStack {
            ZStack {
                DesignTokens.backgroundSubtle.ignoresSafeArea()

                Group {
                    if isLoading {
                        loadingView
                    } else if poems.isEmpty {
                        emptyStateView
                    } else {
                        poemListView
                    }
                }
            }
            .navigationTitle("My Poems")
            .refreshable {
                await loadPoems()
            }
            .sheet(isPresented: $showPoemDetail) {
                if let poem = selectedPoem {
                    PoemDetailView(poem: poem)
                }
            }
        }
        .onAppear {
            // Use sample data until API is ready
            poems = samplePoems
            isLoading = false
        }
    }

    // MARK: - Loading View

    private var loadingView: some View {
        VStack(spacing: 16) {
            ProgressView()
                .tint(DesignTokens.rose)
            Text("Loading poems...")
                .foregroundColor(DesignTokens.textSecondary)
        }
    }

    // MARK: - Empty State

    private var emptyStateView: some View {
        VStack(spacing: 24) {
            Spacer()

            // Icon with rose theme
            ZStack {
                Circle()
                    .fill(DesignTokens.roseMuted)
                    .frame(width: 120, height: 120)

                Image(systemName: "text.book.closed.fill")
                    .font(.system(size: 48))
                    .foregroundColor(DesignTokens.rose)
            }

            VStack(spacing: 8) {
                Text("No Poems Yet")
                    .font(.title2.bold())
                    .foregroundColor(DesignTokens.textPrimary)

                Text("Express your feelings through\nbeautifully crafted words")
                    .font(.body)
                    .foregroundColor(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)
            }

            // CTA Button - solid rose (no gradient per design guide)
            Button {
                onCreatePoem?()
            } label: {
                HStack {
                    Image(systemName: "plus.circle.fill")
                    Text("Create Your First Poem")
                }
                .font(.headline)
                .foregroundColor(.white)
                .padding(.horizontal, 24)
                .padding(.vertical, 14)
                .background(DesignTokens.rose)
                .cornerRadius(25)
            }

            Spacer()
        }
        .padding()
    }

    // MARK: - Poem List

    private var poemListView: some View {
        ScrollView {
            LazyVStack(spacing: 16) {
                ForEach(poems) { poem in
                    PoemCard(poem: poem) {
                        selectedPoem = poem
                        showPoemDetail = true
                    }
                }
            }
            .padding()
            .padding(.bottom, 100) // Tab bar clearance
        }
    }

    // MARK: - Load Poems

    private func loadPoems() async {
        // TODO: Replace with actual API call when ready
        poems = samplePoems
    }
}

// MARK: - Poem Card (Light UI)

struct PoemCard: View {
    let poem: Poem
    let onTap: () -> Void

    var body: some View {
        Button {
            onTap()
        } label: {
            VStack(alignment: .leading, spacing: 12) {
                // Header
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(poem.title)
                            .font(.headline)
                            .foregroundColor(DesignTokens.textPrimary)

                        HStack(spacing: 8) {
                            // Occasion badge
                            if let occasion = Occasion(rawValue: poem.occasion) {
                                HStack(spacing: 4) {
                                    Text(occasion.emoji)
                                        .font(.caption)
                                    Text(occasion.displayName)
                                        .font(.caption)
                                        .foregroundColor(DesignTokens.textSecondary)
                                }
                            }

                            Text("•")
                                .foregroundColor(DesignTokens.textTertiary)

                            // Recipient
                            Text("For \(poem.recipientName)")
                                .font(.caption)
                                .foregroundColor(DesignTokens.textSecondary)
                        }
                    }

                    Spacer()

                    // Status indicator
                    statusBadge
                }

                // Preview lines
                Text(poem.previewLines + "...")
                    .font(.subheadline)
                    .foregroundColor(DesignTokens.textSecondary)
                    .lineLimit(2)
                    .italic()

                // Footer
                HStack {
                    Text(formattedDate)
                        .font(.caption2)
                        .foregroundColor(DesignTokens.textTertiary)

                    Spacer()

                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundColor(DesignTokens.textSecondary)
                }
            }
            .padding()
            .background(DesignTokens.cardBackground)
            .cornerRadius(16)
            .shadow(color: Color.black.opacity(0.05), radius: 4, y: 2)
        }
        .buttonStyle(.plain)
    }

    private var statusBadge: some View {
        Group {
            if poem.status == "complete" {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundColor(DesignTokens.success)
            } else {
                Text("Draft")
                    .font(.caption2)
                    .foregroundColor(DesignTokens.warning)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(DesignTokens.warning.opacity(0.1))
                    .cornerRadius(8)
            }
        }
    }

    // Static formatters for performance
    private static let isoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        return formatter
    }()

    private static let displayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        return formatter
    }()

    private var formattedDate: String {
        if let date = Self.isoFormatter.date(from: poem.createdAt) {
            return Self.displayFormatter.string(from: date)
        }
        return poem.createdAt
    }
}

// MARK: - Poem Detail View (Light UI)

struct PoemDetailView: View {
    let poem: Poem
    @Environment(\.dismiss) private var dismiss
    @State private var showCopiedToast = false

    /// Formatted poem text for sharing
    private var shareableText: String {
        """
        \(poem.title)
        For \(poem.recipientName)

        \(poem.verses.joined(separator: "\n"))

        Created with Porizo
        """
    }

    var body: some View {
        NavigationStack {
            ZStack {
                DesignTokens.background.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 32) {
                        // Header
                        VStack(spacing: 8) {
                            Text("For \(poem.recipientName)")
                                .font(.subheadline)
                                .foregroundColor(DesignTokens.textSecondary)

                            Text(poem.title)
                                .font(.title.bold())
                                .foregroundColor(DesignTokens.textPrimary)

                            if let occasion = Occasion(rawValue: poem.occasion) {
                                HStack(spacing: 4) {
                                    Text(occasion.emoji)
                                    Text(occasion.displayName)
                                }
                                .font(.caption)
                                .foregroundColor(DesignTokens.textSecondary)
                            }
                        }
                        .padding(.top, 20)

                        // Poem content
                        VStack(alignment: .center, spacing: 8) {
                            ForEach(Array(poem.verses.enumerated()), id: \.offset) { _, line in
                                if line.isEmpty {
                                    Spacer()
                                        .frame(height: 16)
                                } else {
                                    Text(line)
                                        .font(.system(.body, design: .serif))
                                        .italic()
                                        .multilineTextAlignment(.center)
                                        .foregroundColor(DesignTokens.textPrimary)
                                }
                            }
                        }
                        .padding(.horizontal, 24)

                        // Action buttons
                        VStack(spacing: 12) {
                            // Share button - solid rose
                            ShareLink(item: shareableText) {
                                HStack {
                                    Image(systemName: "square.and.arrow.up")
                                    Text("Share Poem")
                                }
                                .font(.headline)
                                .foregroundColor(.white)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 16)
                                .background(DesignTokens.rose)
                                .cornerRadius(14)
                            }

                            // Copy text button
                            Button {
                                UIPasteboard.general.string = poem.verses.joined(separator: "\n")
                                showCopiedToast = true
                                DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                                    showCopiedToast = false
                                }
                            } label: {
                                HStack {
                                    Image(systemName: showCopiedToast ? "checkmark" : "doc.on.doc")
                                    Text(showCopiedToast ? "Copied!" : "Copy Text")
                                }
                                .font(.subheadline.weight(.medium))
                                .foregroundColor(DesignTokens.textPrimary)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .background(DesignTokens.cardBackground)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 14)
                                        .stroke(DesignTokens.cardBorder, lineWidth: 1)
                                )
                                .cornerRadius(14)
                            }

                            // Create variation button
                            Button {
                                // TODO: Navigate to create flow with pre-filled context
                            } label: {
                                HStack {
                                    Image(systemName: "arrow.triangle.branch")
                                    Text("Create Variation")
                                }
                                .font(.subheadline.weight(.medium))
                                .foregroundColor(DesignTokens.rose)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .background(DesignTokens.roseMuted)
                                .cornerRadius(14)
                            }
                        }
                        .padding(.horizontal)
                        .padding(.bottom, 40)
                    }
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") {
                        dismiss()
                    }
                    .foregroundColor(DesignTokens.rose)
                }
            }
        }
    }
}

// MARK: - Explore Tab View (Light UI with Sections)

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

                        // Templates Section
                        sectionHeader(title: "Templates", subtitle: "Quick-start your creation")

                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 12) {
                                TemplateCard(
                                    title: "50th Birthday for Mom",
                                    occasion: "Birthday",
                                    style: "Soul",
                                    emoji: "🎂"
                                )
                                TemplateCard(
                                    title: "First Anniversary",
                                    occasion: "Anniversary",
                                    style: "Acoustic",
                                    emoji: "💕"
                                )
                                TemplateCard(
                                    title: "Thank You to Teacher",
                                    occasion: "Thank You",
                                    style: "Folk",
                                    emoji: "🙏"
                                )
                                TemplateCard(
                                    title: "Graduation Celebration",
                                    occasion: "Graduation",
                                    style: "Pop",
                                    emoji: "🎓"
                                )
                            }
                            .padding(.horizontal)
                        }
                    }
                    .padding(.top, 20)
                    .padding(.bottom, 100) // Space for tab bar
                }
            }
            .navigationTitle("Explore")
        }
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

// MARK: - Featured Song Card (Redesigned to match SongCard)

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
        .shadow(color: Color.black.opacity(0.04), radius: 8, y: 2)
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

// MARK: - Ranked Song Card (Redesigned to match SongCard with rank)

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
        .shadow(color: Color.black.opacity(0.04), radius: 8, y: 2)
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

// MARK: - Template Card (Light UI)

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
        .shadow(color: Color.black.opacity(0.05), radius: 4, y: 2)
    }
}

// MARK: - Occasion Card (Light UI)

struct OccasionCard: View {
    let occasion: Occasion
    let onTap: () -> Void

    var body: some View {
        Button {
            onTap()
        } label: {
            VStack(spacing: 12) {
                Text(occasion.emoji)
                    .font(.system(size: 36))

                Text(occasion.displayName)
                    .font(.subheadline.weight(.medium))
                    .foregroundColor(DesignTokens.textPrimary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 24)
            .background(DesignTokens.cardBackground)
            .cornerRadius(16)
            .shadow(color: Color.black.opacity(0.05), radius: 4, y: 2)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Inspiration Card (Light UI)

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
        .shadow(color: Color.black.opacity(0.05), radius: 4, y: 2)
    }
}

// MARK: - Settings Tab View (Light UI with Voice as Optional)

struct SettingsTabView: View {
    let apiClient: APIClient
    @State private var showVoiceEnrollment = false
    @State private var voiceProfileStatus: VoiceProfileStatus?
    @State private var isLoadingProfile = true

    var body: some View {
        NavigationStack {
            ZStack {
                DesignTokens.backgroundSubtle.ignoresSafeArea()

                List {
                    // Your Voice Section (Optional, with NEW badge)
                    Section {
                        // Promo card if not enrolled
                        if voiceProfileStatus?.hasProfile != true {
                            VStack(alignment: .leading, spacing: 12) {
                                HStack {
                                    Text("Your Voice")
                                        .font(.headline)
                                        .foregroundColor(DesignTokens.textPrimary)

                                    Text("NEW")
                                        .font(.caption2.bold())
                                        .foregroundColor(.white)
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 2)
                                        .background(DesignTokens.rose)
                                        .cornerRadius(4)
                                }

                                Text("Make songs sound like you singing")
                                    .font(.subheadline)
                                    .foregroundColor(DesignTokens.textSecondary)

                                Button {
                                    showVoiceEnrollment = true
                                } label: {
                                    Text("Set Up Voice")
                                        .font(.subheadline.bold())
                                        .foregroundColor(.white)
                                        .padding(.horizontal, 16)
                                        .padding(.vertical, 10)
                                        .background(DesignTokens.rose)
                                        .cornerRadius(20)
                                }
                            }
                            .padding()
                            .listRowBackground(DesignTokens.cardBackground)
                            .listRowInsets(EdgeInsets())
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(DesignTokens.roseLight, lineWidth: 1)
                                    .padding(1)
                            )
                        } else {
                            // Voice profile active
                            Button {
                                showVoiceEnrollment = true
                            } label: {
                                HStack {
                                    Image(systemName: "waveform.circle.fill")
                                        .font(.title2)
                                        .foregroundColor(DesignTokens.rose)

                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("Voice Profile")
                                            .foregroundColor(DesignTokens.textPrimary)

                                        HStack(spacing: 4) {
                                            Image(systemName: "checkmark.circle.fill")
                                                .font(.caption)
                                                .foregroundColor(DesignTokens.success)
                                            if let score = voiceProfileStatus?.qualityScore {
                                                Text("Quality: \(Int(score))%")
                                                    .font(.caption)
                                                    .foregroundColor(DesignTokens.textSecondary)
                                            } else {
                                                Text("Active")
                                                    .font(.caption)
                                                    .foregroundColor(DesignTokens.textSecondary)
                                            }
                                        }
                                    }

                                    Spacer()

                                    Image(systemName: "chevron.right")
                                        .foregroundColor(DesignTokens.textSecondary)
                                }
                            }
                            .listRowBackground(DesignTokens.cardBackground)
                        }
                    } header: {
                        HStack {
                            Text("Your Voice")
                            Text("NEW")
                                .font(.caption2.bold())
                                .foregroundColor(.white)
                                .padding(.horizontal, 4)
                                .padding(.vertical, 1)
                                .background(DesignTokens.rose)
                                .cornerRadius(3)
                        }
                    } footer: {
                        Text("Optional: Record your voice to create songs that sound like you singing.")
                            .foregroundColor(DesignTokens.textTertiary)
                    }

                    // Account Section
                    Section("Account") {
                        HStack {
                            Label("Profile", systemImage: "person.circle")
                                .foregroundColor(DesignTokens.textPrimary)
                            Spacer()
                            Text("Coming soon")
                                .foregroundColor(DesignTokens.textTertiary)
                                .font(.caption)
                        }
                        .listRowBackground(DesignTokens.cardBackground)

                        HStack {
                            Label("Notifications", systemImage: "bell")
                                .foregroundColor(DesignTokens.textPrimary)
                            Spacer()
                            Text("Coming soon")
                                .foregroundColor(DesignTokens.textTertiary)
                                .font(.caption)
                        }
                        .listRowBackground(DesignTokens.cardBackground)
                    }

                    // Support Section
                    Section("Support") {
                        Link(destination: URL(string: "https://porizo.com/help")!) {
                            Label("Help Center", systemImage: "questionmark.circle")
                                .foregroundColor(DesignTokens.textPrimary)
                        }
                        .listRowBackground(DesignTokens.cardBackground)

                        Link(destination: URL(string: "mailto:support@porizo.com")!) {
                            Label("Contact Us", systemImage: "envelope")
                                .foregroundColor(DesignTokens.textPrimary)
                        }
                        .listRowBackground(DesignTokens.cardBackground)

                        Link(destination: URL(string: "https://porizo.com/privacy")!) {
                            Label("Privacy Policy", systemImage: "hand.raised")
                                .foregroundColor(DesignTokens.textPrimary)
                        }
                        .listRowBackground(DesignTokens.cardBackground)

                        Link(destination: URL(string: "https://porizo.com/terms")!) {
                            Label("Terms of Service", systemImage: "doc.text")
                                .foregroundColor(DesignTokens.textPrimary)
                        }
                        .listRowBackground(DesignTokens.cardBackground)
                    }

                    // App Info
                    Section {
                        HStack {
                            Text("Version")
                                .foregroundColor(DesignTokens.textPrimary)
                            Spacer()
                            Text(appVersion)
                                .foregroundColor(DesignTokens.textSecondary)
                        }
                        .listRowBackground(DesignTokens.cardBackground)
                    }
                }
                .scrollContentBackground(.hidden)
            }
            .navigationTitle("Settings")
            .sheet(isPresented: $showVoiceEnrollment) {
                EnrollmentFlowView(
                    apiClient: apiClient,
                    onComplete: {
                        showVoiceEnrollment = false
                        loadVoiceProfile()
                    }
                )
            }
            .onAppear {
                loadVoiceProfile()
            }
        }
    }

    private var appVersion: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "\(version) (\(build))"
    }

    private func loadVoiceProfile() {
        Task { @MainActor in
            isLoadingProfile = true
            do {
                let status = try await apiClient.getVoiceProfile()
                voiceProfileStatus = status
                isLoadingProfile = false
            } catch {
                isLoadingProfile = false
            }
        }
    }
}

// MARK: - Create Flow (Light UI)

struct CreateFlowView: View {
    let apiClient: APIClient
    var preselectedOccasion: Occasion?
    var resumeTrackId: String?
    var resumeVersionNum: Int?
    let onComplete: (String, Int) -> Void
    let onCancel: () -> Void

    @State private var flowState: CreateFlowState = .typeSelection
    @State private var selectedType: CreationType?
    @State private var storyContext: StoryContext?
    @State private var currentTrackId: String?
    @State private var currentVersionNum: Int?

    enum CreateFlowState {
        case typeSelection
        case storyWizard
        case creatingTrack
        case lyricsReview
        case trackPlayer
    }

    enum CreationType {
        case song
        case poem
    }

    var body: some View {
        NavigationStack {
            ZStack {
                DesignTokens.background.ignoresSafeArea()

                Group {
                    switch flowState {
                    case .typeSelection:
                        typeSelectionView

                    case .storyWizard:
                        NewStoryWizardView(
                            apiClient: apiClient,
                            onComplete: { context in
                                storyContext = context
                                flowState = .creatingTrack
                            },
                            onCancel: {
                                flowState = .typeSelection
                            }
                        )

                    case .creatingTrack:
                        if let context = storyContext {
                            CreatingTrackView(
                                apiClient: apiClient,
                                storyContext: context,
                                onTrackCreated: { trackId, versionNum in
                                    currentTrackId = trackId
                                    currentVersionNum = versionNum
                                    flowState = .lyricsReview
                                },
                                onError: { _ in
                                    // Handle error
                                    flowState = .typeSelection
                                }
                            )
                        }

                    case .lyricsReview:
                        if let trackId = currentTrackId, let versionNum = currentVersionNum {
                            LyricsReviewView(
                                apiClient: apiClient,
                                trackId: trackId,
                                versionNum: versionNum,
                                onApproved: {
                                    flowState = .trackPlayer
                                },
                                onBack: {
                                    flowState = .storyWizard
                                }
                            )
                        }

                    case .trackPlayer:
                        if let trackId = currentTrackId, let versionNum = currentVersionNum {
                            TrackPlayerView(
                                apiClient: apiClient,
                                trackId: trackId,
                                versionNum: versionNum,
                                onDone: {
                                    onComplete(trackId, versionNum)
                                },
                                onNewSong: {
                                    flowState = .typeSelection
                                }
                            )
                        }
                    }
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if flowState == .typeSelection {
                        Button("Cancel") {
                            onCancel()
                        }
                        .foregroundColor(DesignTokens.rose)
                    }
                }
            }
        }
        .onAppear {
            // Handle resume flow from draft
            if let trackId = resumeTrackId, let versionNum = resumeVersionNum {
                currentTrackId = trackId
                currentVersionNum = versionNum
                flowState = .lyricsReview
            }
            // Handle preselected occasion from Explore
            else if preselectedOccasion != nil {
                selectedType = .song
                flowState = .storyWizard
            }
        }
    }

    private var typeSelectionView: some View {
        VStack(spacing: 32) {
            // Header
            VStack(spacing: 8) {
                Text("What would you like to create?")
                    .font(.title2.bold())
                    .foregroundColor(DesignTokens.textPrimary)
                Text("Express your feelings through music or words")
                    .foregroundColor(DesignTokens.textSecondary)
            }
            .padding(.top, 40)

            // Options
            VStack(spacing: 16) {
                // Song option
                Button {
                    selectedType = .song
                    flowState = .storyWizard
                } label: {
                    HStack(spacing: 16) {
                        ZStack {
                            Circle()
                                .fill(DesignTokens.roseMuted)
                                .frame(width: 60, height: 60)

                            Image(systemName: "music.note")
                                .font(.system(size: 28))
                                .foregroundColor(DesignTokens.rose)
                        }

                        VStack(alignment: .leading, spacing: 4) {
                            Text("Personalized Song")
                                .font(.headline)
                                .foregroundColor(DesignTokens.textPrimary)
                            Text("A custom song created just for them")
                                .font(.subheadline)
                                .foregroundColor(DesignTokens.textSecondary)
                        }

                        Spacer()

                        Image(systemName: "chevron.right")
                            .foregroundColor(DesignTokens.textSecondary)
                    }
                    .padding()
                    .background(DesignTokens.cardBackground)
                    .cornerRadius(16)
                    .shadow(color: Color.black.opacity(0.05), radius: 4, y: 2)
                }
                .buttonStyle(.plain)

                // Poem option
                Button {
                    // TODO: Implement poem flow
                } label: {
                    HStack(spacing: 16) {
                        ZStack {
                            Circle()
                                .fill(DesignTokens.backgroundSubtle)
                                .frame(width: 60, height: 60)

                            Image(systemName: "text.book.closed")
                                .font(.system(size: 28))
                                .foregroundColor(DesignTokens.textTertiary)
                        }

                        VStack(alignment: .leading, spacing: 4) {
                            Text("Custom Poem")
                                .font(.headline)
                                .foregroundColor(DesignTokens.textPrimary)
                            Text("Heartfelt words crafted for them")
                                .font(.subheadline)
                                .foregroundColor(DesignTokens.textSecondary)
                        }

                        Spacer()

                        Text("Coming Soon")
                            .font(.caption)
                            .foregroundColor(DesignTokens.textTertiary)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(DesignTokens.backgroundSubtle)
                            .cornerRadius(8)
                    }
                    .padding()
                    .background(DesignTokens.cardBackground)
                    .cornerRadius(16)
                    .shadow(color: Color.black.opacity(0.02), radius: 4, y: 2)
                    .opacity(0.6)
                }
                .buttonStyle(.plain)
                .disabled(true)
            }
            .padding(.horizontal)

            Spacer()
        }
        .navigationTitle("Create")
        .navigationBarTitleDisplayMode(.inline)
    }
}

#Preview {
    MainTabView(apiClient: APIClient(baseURL: "http://localhost:3000"))
}
