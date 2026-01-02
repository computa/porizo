//
//  MainTabView.swift
//  PorizoApp
//
//  Main tab bar shell with prominent center Create button.
//

import SwiftUI

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
            Rectangle()
                .fill(.ultraThinMaterial)
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
            .foregroundColor(selectedTab == tab ? .accentColor : .secondary)
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
                Circle()
                    .fill(Color.accentColor)
                    .frame(width: 56, height: 56)
                    .shadow(color: .accentColor.opacity(0.3), radius: 8, y: 4)

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
            Group {
                if isLoading {
                    loadingView
                } else if poems.isEmpty {
                    emptyStateView
                } else {
                    poemListView
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
            Text("Loading poems...")
                .foregroundColor(.secondary)
        }
    }

    // MARK: - Empty State

    private var emptyStateView: some View {
        VStack(spacing: 24) {
            Spacer()

            // Icon with violet theme (design token: secondary)
            ZStack {
                Circle()
                    .fill(Color.purple.opacity(0.1))
                    .frame(width: 120, height: 120)

                Image(systemName: "text.book.closed.fill")
                    .font(.system(size: 48))
                    .foregroundColor(.purple)
            }

            VStack(spacing: 8) {
                Text("No Poems Yet")
                    .font(.title2.bold())

                Text("Express your feelings through\nbeautifully crafted words")
                    .font(.body)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
            }

            // CTA Button - rose theme (design token: primary)
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
                .background(Color.pink)
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
        // poems = try? await apiClient.getPoems()
        poems = samplePoems
    }
}

// MARK: - Poem Card

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
                            .foregroundColor(.primary)

                        HStack(spacing: 8) {
                            // Occasion badge
                            if let occasion = Occasion(rawValue: poem.occasion) {
                                HStack(spacing: 4) {
                                    Text(occasion.emoji)
                                        .font(.caption)
                                    Text(occasion.displayName)
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                            }

                            Text("•")
                                .foregroundColor(.secondary)

                            // Recipient
                            Text("For \(poem.recipientName)")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }

                    Spacer()

                    // Status indicator
                    statusBadge
                }

                // Preview lines
                Text(poem.previewLines + "...")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .lineLimit(2)
                    .italic()

                // Footer
                HStack {
                    Text(formattedDate)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)

                    Spacer()

                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            .padding()
            .background(Color(.secondarySystemBackground))
            .cornerRadius(16)
        }
        .buttonStyle(.plain)
    }

    private var statusBadge: some View {
        Group {
            if poem.status == "complete" {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundColor(.green)
            } else {
                Text("Draft")
                    .font(.caption2)
                    .foregroundColor(.orange)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.orange.opacity(0.1))
                    .cornerRadius(8)
            }
        }
    }

    // Static formatters for performance (avoid creating on every render)
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

// MARK: - Poem Detail View

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

        Created with Porizō
        """
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 32) {
                    // Header
                    VStack(spacing: 8) {
                        Text("For \(poem.recipientName)")
                            .font(.subheadline)
                            .foregroundColor(.secondary)

                        Text(poem.title)
                            .font(.title.bold())

                        if let occasion = Occasion(rawValue: poem.occasion) {
                            HStack(spacing: 4) {
                                Text(occasion.emoji)
                                Text(occasion.displayName)
                            }
                            .font(.caption)
                            .foregroundColor(.secondary)
                        }
                    }
                    .padding(.top, 20)

                    // Poem content with elegant typography
                    VStack(alignment: .center, spacing: 8) {
                        ForEach(Array(poem.verses.enumerated()), id: \.offset) { index, line in
                            if line.isEmpty {
                                // Stanza break
                                Spacer()
                                    .frame(height: 16)
                            } else {
                                Text(line)
                                    .font(.system(.body, design: .serif))
                                    .italic()
                                    .multilineTextAlignment(.center)
                                    .foregroundColor(.primary)
                            }
                        }
                    }
                    .padding(.horizontal, 24)

                    // Action buttons
                    VStack(spacing: 12) {
                        // Share button - primary (rose) using ShareLink
                        ShareLink(item: shareableText) {
                            HStack {
                                Image(systemName: "square.and.arrow.up")
                                Text("Share Poem")
                            }
                            .font(.headline)
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(Color.pink)
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
                            .foregroundColor(.primary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(Color(.secondarySystemBackground))
                            .cornerRadius(14)
                        }

                        // Create variation button - secondary (violet)
                        Button {
                            // TODO: Navigate to create flow with pre-filled context
                        } label: {
                            HStack {
                                Image(systemName: "arrow.triangle.branch")
                                Text("Create Variation")
                            }
                            .font(.subheadline.weight(.medium))
                            .foregroundColor(.purple)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(Color.purple.opacity(0.1))
                            .cornerRadius(14)
                        }
                    }
                    .padding(.horizontal)
                    .padding(.bottom, 40)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }
}

// MARK: - Explore Tab View

struct ExploreTabView: View {
    let apiClient: APIClient
    let onOccasionSelected: (Occasion) -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 28) {
                    // Header
                    VStack(spacing: 8) {
                        Text("What's the occasion?")
                            .font(.title2.bold())
                        Text("Find inspiration for your next creation")
                            .foregroundColor(.secondary)
                    }
                    .padding(.top, 20)

                    // Occasion categories
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

                    // Inspiration section
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Need inspiration?")
                            .font(.headline)
                            .padding(.horizontal)

                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 12) {
                                InspirationCard(
                                    title: "Surprise your partner",
                                    subtitle: "An unexpected love song",
                                    color: .pink,
                                    icon: "heart.fill"
                                )
                                InspirationCard(
                                    title: "Thank a mentor",
                                    subtitle: "Show your gratitude",
                                    color: .orange,
                                    icon: "star.fill"
                                )
                                InspirationCard(
                                    title: "Celebrate a friend",
                                    subtitle: "For their special day",
                                    color: .blue,
                                    icon: "gift.fill"
                                )
                                InspirationCard(
                                    title: "Comfort someone",
                                    subtitle: "Words of encouragement",
                                    color: .green,
                                    icon: "sun.max.fill"
                                )
                                InspirationCard(
                                    title: "Say sorry",
                                    subtitle: "A heartfelt apology",
                                    color: .purple,
                                    icon: "hands.sparkles.fill"
                                )
                            }
                            .padding(.horizontal)
                        }
                    }

                    // Popular Templates section
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text("Popular Templates")
                                .font(.headline)
                            Spacer()
                            Button("See All") {
                                // TODO: Navigate to full templates list
                            }
                            .font(.subheadline)
                            .foregroundColor(.pink)
                        }
                        .padding(.horizontal)

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

                    // Trending Styles section
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text("Trending Styles")
                                .font(.headline)
                            Spacer()
                            Image(systemName: "flame.fill")
                                .foregroundColor(.orange)
                        }
                        .padding(.horizontal)

                        VStack(spacing: 12) {
                            TrendingStyleRow(
                                name: "Acoustic",
                                description: "Intimate, heartfelt guitar-driven songs",
                                popularity: 95,
                                color: .brown
                            )
                            TrendingStyleRow(
                                name: "Afrobeats",
                                description: "High-energy rhythms perfect for celebrations",
                                popularity: 92,
                                color: .orange
                            )
                            TrendingStyleRow(
                                name: "Bossa Nova",
                                description: "Smooth, romantic Brazilian jazz",
                                popularity: 78,
                                color: .teal
                            )
                        }
                        .padding(.horizontal)
                    }
                }
                .padding(.bottom, 100) // Space for tab bar
            }
            .navigationTitle("Explore")
        }
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
            // Emoji header
            Text(emoji)
                .font(.system(size: 32))

            // Title
            Text(title)
                .font(.subheadline.bold())
                .foregroundColor(.primary)
                .lineLimit(2)

            // Metadata
            HStack(spacing: 4) {
                Text(style)
                    .font(.caption2)
                    .foregroundColor(.white)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color.pink.opacity(0.8))
                    .cornerRadius(4)
            }

            Spacer()

            // Use button
            Button {
                // TODO: Launch create flow with template
            } label: {
                Text("Use Template")
                    .font(.caption.bold())
                    .foregroundColor(.pink)
            }
        }
        .frame(width: 150, height: 160)
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(16)
    }
}

// MARK: - Trending Style Row

struct TrendingStyleRow: View {
    let name: String
    let description: String
    let popularity: Int
    let color: Color

    var body: some View {
        HStack(spacing: 12) {
            // Style icon
            ZStack {
                Circle()
                    .fill(color.opacity(0.15))
                    .frame(width: 44, height: 44)

                Image(systemName: "music.note")
                    .foregroundColor(color)
            }

            // Info
            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                    .font(.subheadline.bold())

                Text(description)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            }

            Spacer()

            // Popularity bar
            VStack(alignment: .trailing, spacing: 2) {
                Text("\(popularity)%")
                    .font(.caption2.bold())
                    .foregroundColor(color)

                // Mini progress bar
                GeometryReader { geometry in
                    ZStack(alignment: .leading) {
                        Capsule()
                            .fill(Color(.systemGray5))
                            .frame(height: 4)

                        Capsule()
                            .fill(color)
                            .frame(width: CGFloat(popularity) / 100 * geometry.size.width, height: 4)
                    }
                }
                .frame(width: 50, height: 4)
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }
}

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
                    .foregroundColor(.primary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 24)
            .background(occasionColor.opacity(0.1))
            .cornerRadius(16)
        }
        .buttonStyle(.plain)
    }

    private var occasionColor: Color {
        switch occasion {
        case .birthday: return .pink
        case .anniversary: return .red
        case .thankYou: return .orange
        case .iLoveYou: return .red
        case .wedding: return .purple
        case .graduation: return .blue
        case .celebration: return .yellow
        case .apology: return .purple
        case .encouragement: return .green
        case .custom: return .gray
        }
    }
}

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
                .foregroundColor(.primary)

            Text(subtitle)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .frame(width: 140)
        .padding()
        .background(color.opacity(0.1))
        .cornerRadius(16)
    }
}

// MARK: - Settings Tab View

struct SettingsTabView: View {
    let apiClient: APIClient
    @State private var showVoiceEnrollment = false
    @State private var voiceProfileStatus: VoiceProfileStatus?
    @State private var isLoadingProfile = true

    var body: some View {
        NavigationStack {
            List {
                // Voice Section
                Section {
                    Button {
                        showVoiceEnrollment = true
                    } label: {
                        HStack {
                            Image(systemName: "waveform.circle.fill")
                                .font(.title2)
                                .foregroundColor(.accentColor)

                            VStack(alignment: .leading, spacing: 2) {
                                Text("Voice Profile")
                                    .foregroundColor(.primary)

                                if isLoadingProfile {
                                    Text("Loading...")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                } else if let status = voiceProfileStatus, status.hasProfile {
                                    HStack(spacing: 4) {
                                        Image(systemName: "checkmark.circle.fill")
                                            .font(.caption)
                                            .foregroundColor(.green)
                                        if let score = status.qualityScore {
                                            Text("Quality: \(Int(score))%")
                                                .font(.caption)
                                                .foregroundColor(.secondary)
                                        } else {
                                            Text("Active")
                                                .font(.caption)
                                                .foregroundColor(.secondary)
                                        }
                                    }
                                } else {
                                    Text("Not enrolled")
                                        .font(.caption)
                                        .foregroundColor(.orange)
                                }
                            }

                            Spacer()

                            Image(systemName: "chevron.right")
                                .foregroundColor(.secondary)
                        }
                    }
                    .foregroundColor(.primary)
                } header: {
                    Text("Voice")
                } footer: {
                    Text("Your voice profile allows songs to sound like you singing.")
                }

                // Account Section
                Section("Account") {
                    HStack {
                        Label("Profile", systemImage: "person.circle")
                        Spacer()
                        Text("Coming soon")
                            .foregroundColor(.secondary)
                            .font(.caption)
                    }

                    HStack {
                        Label("Notifications", systemImage: "bell")
                        Spacer()
                        Text("Coming soon")
                            .foregroundColor(.secondary)
                            .font(.caption)
                    }
                }

                // Support Section
                // Note: Force-unwrap is safe here - these are compile-time constant URLs
                Section("Support") {
                    Link(destination: URL(string: "https://porizo.com/help")!) {
                        Label("Help Center", systemImage: "questionmark.circle")
                    }

                    Link(destination: URL(string: "mailto:support@porizo.com")!) {
                        Label("Contact Us", systemImage: "envelope")
                    }

                    Link(destination: URL(string: "https://porizo.com/privacy")!) {
                        Label("Privacy Policy", systemImage: "hand.raised")
                    }

                    Link(destination: URL(string: "https://porizo.com/terms")!) {
                        Label("Terms of Service", systemImage: "doc.text")
                    }
                }

                // App Info
                Section {
                    HStack {
                        Text("Version")
                        Spacer()
                        Text(appVersion)
                            .foregroundColor(.secondary)
                    }
                }
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

// MARK: - Create Flow

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
            Group {
                switch flowState {
                case .typeSelection:
                    typeSelectionView

                case .storyWizard:
                    StoryWizardView(
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
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if flowState == .typeSelection {
                        Button("Cancel") {
                            onCancel()
                        }
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
                Text("Express your feelings through music or words")
                    .foregroundColor(.secondary)
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
                                .fill(Color.accentColor.opacity(0.1))
                                .frame(width: 60, height: 60)

                            Image(systemName: "music.note")
                                .font(.system(size: 28))
                                .foregroundColor(.accentColor)
                        }

                        VStack(alignment: .leading, spacing: 4) {
                            Text("Personalized Song")
                                .font(.headline)
                                .foregroundColor(.primary)
                            Text("A custom song with your voice")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                        }

                        Spacer()

                        Image(systemName: "chevron.right")
                            .foregroundColor(.secondary)
                    }
                    .padding()
                    .background(Color(.secondarySystemBackground))
                    .cornerRadius(16)
                }
                .buttonStyle(.plain)

                // Poem option
                Button {
                    // TODO: Implement poem flow
                } label: {
                    HStack(spacing: 16) {
                        ZStack {
                            Circle()
                                .fill(Color.purple.opacity(0.1))
                                .frame(width: 60, height: 60)

                            Image(systemName: "text.book.closed")
                                .font(.system(size: 28))
                                .foregroundColor(.purple)
                        }

                        VStack(alignment: .leading, spacing: 4) {
                            Text("Custom Poem")
                                .font(.headline)
                                .foregroundColor(.primary)
                            Text("Heartfelt words crafted for them")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                        }

                        Spacer()

                        Text("Coming Soon")
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Color(.tertiarySystemBackground))
                            .cornerRadius(8)
                    }
                    .padding()
                    .background(Color(.secondarySystemBackground))
                    .cornerRadius(16)
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
