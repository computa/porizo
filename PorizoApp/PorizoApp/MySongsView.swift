//
//  MySongsView.swift
//  PorizoApp
//
//  Displays list of user's songs with playback for completed ones.
//  Light mode design with rose accents and card-based layout.
//

import SwiftUI
import AVFoundation

struct MySongsView: View {
    let apiClient: APIClient
    let onCreateNew: () -> Void
    let onBack: () -> Void
    var onDraftSelected: ((String, Int) -> Void)? = nil  // trackId, versionNum

    @State private var tracks: [Track] = []
    @State private var isLoading = true
    @State private var showingError = false
    @State private var errorMessage = ""

    // Playback state
    @State private var player: AVPlayer?
    @State private var playingTrackId: String?
    @State private var isPlaying = false
    @State private var isLoadingAudio = false

    // Observer token for proper cleanup (prevents memory leak)
    @State private var playbackEndObserver: NSObjectProtocol?

    var body: some View {
        ZStack {
            DesignTokens.backgroundSubtle.ignoresSafeArea()

            Group {
                if isLoading {
                    loadingView
                } else if tracks.isEmpty {
                    emptyStateView
                } else {
                    trackListView
                }
            }
        }
        .navigationTitle("My Songs")
        .navigationBarTitleDisplayMode(.large)
        .alert("Error", isPresented: $showingError) {
            Button("OK") { }
        } message: {
            Text(errorMessage)
        }
        .onAppear {
            loadTracks()
        }
        .onDisappear {
            stopPlayback()
        }
    }

    // MARK: - Loading View

    private var loadingView: some View {
        VStack(spacing: 16) {
            ProgressView()
                .tint(DesignTokens.rose)
            Text("Loading songs...")
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

                Image(systemName: "music.note.list")
                    .font(.system(size: 48))
                    .foregroundColor(DesignTokens.rose)
            }

            VStack(spacing: 8) {
                Text("No Songs Yet")
                    .font(.title2.bold())
                    .foregroundColor(DesignTokens.textPrimary)

                Text("Create your first personalized song\nand share it with someone special")
                    .font(.body)
                    .foregroundColor(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)
            }

            // CTA Button - solid rose (no gradient per design guide)
            Button {
                onCreateNew()
            } label: {
                HStack {
                    Image(systemName: "wand.and.stars")
                    Text("Create Your First Song")
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

    // MARK: - Track List

    private var trackListView: some View {
        ScrollView {
            LazyVStack(spacing: 16) {
                ForEach(tracks, id: \.id) { track in
                    SongCard(
                        track: track,
                        isPlaying: playingTrackId == track.id && isPlaying,
                        isLoadingAudio: isLoadingAudio && playingTrackId == track.id,
                        onPlay: { togglePlayback(for: track) },
                        onTap: {
                            if isDraftOrLyricsApproved(track: track) {
                                handleDraftTap(track: track)
                            }
                        }
                    )
                }
            }
            .padding()
            .padding(.bottom, 100) // Tab bar clearance
        }
        .refreshable {
            await refreshTracks()
        }
    }

    private func isDraftOrLyricsApproved(track: Track) -> Bool {
        track.status == "draft" || track.status == "lyrics_approved"
    }

    private func handleDraftTap(track: Track) {
        Task {
            do {
                // Fetch track details to get version number
                let details = try await apiClient.getTrack(trackId: track.id)
                let versionNum = details.versions.first?.versionNum ?? 1

                await MainActor.run {
                    onDraftSelected?(track.id, versionNum)
                }
            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    showingError = true
                }
            }
        }
    }

    // MARK: - Playback

    private func togglePlayback(for track: Track) {
        // If same track, toggle play/pause
        if playingTrackId == track.id {
            if isPlaying {
                player?.pause()
                isPlaying = false
            } else {
                player?.play()
                isPlaying = true
            }
            return
        }

        // Different track - stop current and load new
        stopPlayback()
        loadAndPlay(track: track)
    }

    private func loadAndPlay(track: Track) {
        isLoadingAudio = true
        playingTrackId = track.id

        Task {
            do {
                // Fetch track details to get preview URL
                let details = try await apiClient.getTrack(trackId: track.id)

                // Find the preview URL from versions
                guard let version = details.versions.first,
                      let urlString = version.previewUrl ?? version.fullUrl else {
                    await MainActor.run {
                        errorMessage = "No audio available for this track"
                        showingError = true
                        isLoadingAudio = false
                        playingTrackId = nil
                    }
                    return
                }

                // Transform URL to use actual server base URL
                let transformedUrlString = transformAudioUrl(urlString)
                guard let url = URL(string: transformedUrlString) else {
                    await MainActor.run {
                        errorMessage = "Invalid audio URL"
                        showingError = true
                        isLoadingAudio = false
                        playingTrackId = nil
                    }
                    return
                }

                await MainActor.run {
                    // Configure audio session
                    do {
                        try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
                        try AVAudioSession.sharedInstance().setActive(true)
                    } catch {
                        print("Audio session error: \(error)")
                    }

                    // Create player and start
                    let playerItem = AVPlayerItem(url: url)
                    player = AVPlayer(playerItem: playerItem)
                    player?.play()
                    isPlaying = true
                    isLoadingAudio = false

                    // Observe playback end (store token for cleanup)
                    playbackEndObserver = NotificationCenter.default.addObserver(
                        forName: .AVPlayerItemDidPlayToEndTime,
                        object: playerItem,
                        queue: .main
                    ) { _ in
                        isPlaying = false
                    }
                }

            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    showingError = true
                    isLoadingAudio = false
                    playingTrackId = nil
                }
            }
        }
    }

    private func stopPlayback() {
        player?.pause()
        player = nil
        playingTrackId = nil
        isPlaying = false
        isLoadingAudio = false
        // Remove observer to prevent memory leak
        if let observer = playbackEndObserver {
            NotificationCenter.default.removeObserver(observer)
            playbackEndObserver = nil
        }
    }

    // MARK: - Data Loading

    private func loadTracks() {
        Task {
            await refreshTracks()
        }
    }

    private func refreshTracks() async {
        // TESTING: Use mock data directly
        #if DEBUG
        await MainActor.run {
            tracks = Self.mockTracks
            isLoading = false
        }
        return
        #endif

        do {
            let response = try await apiClient.getTracks()
            await MainActor.run {
                // Sort by most recent first
                tracks = response.tracks.sorted {
                    $0.createdAt > $1.createdAt
                }
                isLoading = false
            }
        } catch {
            // Use mock data when API is unavailable
            await MainActor.run {
                tracks = Self.mockTracks
                isLoading = false
            }
        }
    }

    // MARK: - Mock Data for Testing

    private static let mockTracks: [Track] = [
        Track(
            id: "mock-1",
            userId: "test-user",
            title: "Happy Birthday Mom",
            occasion: "birthday",
            recipientName: "Mom",
            style: "soul",
            durationTarget: 60,
            voiceMode: "ai_voice",
            message: "A heartfelt birthday song for the best mom ever",
            status: "preview_ready",
            latestVersion: 1,
            shareTokenId: nil,
            createdAt: "2025-01-02T10:30:00Z",
            updatedAt: "2025-01-02T10:35:00Z"
        ),
        Track(
            id: "mock-2",
            userId: "test-user",
            title: "Our Anniversary",
            occasion: "anniversary",
            recipientName: "Sarah",
            style: "acoustic",
            durationTarget: 90,
            voiceMode: "your_voice",
            message: "Celebrating 5 wonderful years together",
            status: "full_ready",
            latestVersion: 2,
            shareTokenId: "share-123",
            createdAt: "2025-01-01T14:00:00Z",
            updatedAt: "2025-01-01T14:30:00Z"
        ),
        Track(
            id: "mock-3",
            userId: "test-user",
            title: "Thank You Coach",
            occasion: "thank_you",
            recipientName: "Coach Martinez",
            style: "pop",
            durationTarget: 45,
            voiceMode: "ai_voice",
            message: "For all the encouragement and support",
            status: "rendering",
            latestVersion: 1,
            shareTokenId: nil,
            createdAt: "2025-01-03T08:00:00Z",
            updatedAt: "2025-01-03T08:00:00Z"
        ),
        Track(
            id: "mock-4",
            userId: "test-user",
            title: "Love Song for Jamie",
            occasion: "i_love_you",
            recipientName: "Jamie",
            style: "rnb",
            durationTarget: 75,
            voiceMode: "ai_voice",
            message: "Just because I love you",
            status: "draft",
            latestVersion: 1,
            shareTokenId: nil,
            createdAt: "2025-01-03T12:00:00Z",
            updatedAt: "2025-01-03T12:00:00Z"
        )
    ]

    private func transformAudioUrl(_ urlString: String) -> String {
        guard let storedUrl = URL(string: urlString),
              let path = storedUrl.path.isEmpty ? nil : storedUrl.path else {
            return urlString
        }
        return apiClient.baseURL + path
    }
}

// MARK: - Song Card (New Design: 100pt height, square image, 3-dot menu)

struct SongCard: View {
    let track: Track
    let isPlaying: Bool
    let isLoadingAudio: Bool
    let onPlay: () -> Void
    let onTap: () -> Void
    var onShare: (() -> Void)? = nil
    var onDelete: (() -> Void)? = nil

    private var isPlayable: Bool {
        track.status == "preview_ready" || track.status == "full_ready"
    }

    private var isTappable: Bool {
        track.status == "draft" || track.status == "lyrics_approved"
    }

    var body: some View {
        Button {
            if isTappable {
                onTap()
            } else if isPlayable {
                onPlay()
            }
        } label: {
            HStack(spacing: 12) {
                // Square artwork (100pt)
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
                    Text(track.title)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundColor(DesignTokens.textPrimary)
                        .lineLimit(1)

                    // Subtitle - "Style • For Recipient • Occasion"
                    Text(subtitleText)
                        .font(.system(size: 14))
                        .foregroundColor(DesignTokens.textSecondary)
                        .lineLimit(2)

                    // Status indicator (subtle)
                    if track.status == "rendering" || track.status == "processing" {
                        HStack(spacing: 4) {
                            ProgressView()
                                .scaleEffect(0.7)
                                .tint(DesignTokens.rose)
                            Text("Creating...")
                                .font(.caption)
                                .foregroundColor(DesignTokens.textTertiary)
                        }
                    }
                }

                Spacer()

                // Three-dot menu
                Menu {
                    if isPlayable {
                        Button {
                            onPlay()
                        } label: {
                            Label(isPlaying ? "Pause" : "Play", systemImage: isPlaying ? "pause.fill" : "play.fill")
                        }
                    }

                    if let share = onShare {
                        Button {
                            share()
                        } label: {
                            Label("Share", systemImage: "square.and.arrow.up")
                        }
                    }

                    Divider()

                    if let delete = onDelete {
                        Button(role: .destructive) {
                            delete()
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
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
        .buttonStyle(.plain)
    }

    // Subtitle format: "Style • For Recipient • Occasion"
    private var subtitleText: String {
        var parts: [String] = []

        // Style
        if let style = track.style {
            parts.append(MusicStyle(rawValue: style)?.displayName ?? style.capitalized)
        }

        // Recipient
        if let recipient = track.recipientName, !recipient.isEmpty {
            parts.append("For \(recipient)")
        }

        // Occasion
        if let occasion = track.occasion,
           let occ = Occasion(rawValue: occasion) {
            parts.append(occ.displayName)
        }

        return parts.joined(separator: " • ")
    }

    // Occasion-based icon
    private var occasionIcon: String {
        switch track.occasion {
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
        switch track.occasion {
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

#Preview {
    NavigationStack {
        MySongsView(
            apiClient: APIClient(baseURL: "http://localhost:3000"),
            onCreateNew: { },
            onBack: { }
        )
    }
}
