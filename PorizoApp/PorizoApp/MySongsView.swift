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
    @State private var loadError: Error?
    @State private var showingError = false
    @State private var errorMessage = ""

    // Playback state - using AVAudioPlayer instead of AVPlayer for better reliability
    @State private var audioPlayer: AVAudioPlayer?
    @State private var playingTrackId: String?
    @State private var isPlaying = false
    @State private var isLoadingAudio = false

    // Delete confirmation state
    @State private var trackToDelete: Track?
    @State private var showingDeleteConfirmation = false

    var body: some View {
        ZStack {
            DesignTokens.backgroundSubtle.ignoresSafeArea()

            Group {
                if isLoading {
                    loadingView
                } else if loadError != nil {
                    errorStateView
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
        .confirmationDialog(
            "Delete Song?",
            isPresented: $showingDeleteConfirmation,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let track = trackToDelete {
                    deleteTrack(track)
                }
            }
            Button("Cancel", role: .cancel) {
                trackToDelete = nil
            }
        } message: {
            if let track = trackToDelete {
                Text("Are you sure you want to delete \"\(track.title)\"? This action cannot be undone.")
            }
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
        MySongsSkeletonView()
    }

    // MARK: - Error State

    private var errorStateView: some View {
        VStack(spacing: 24) {
            Spacer()

            ZStack {
                Circle()
                    .fill(DesignTokens.warning.opacity(0.15))
                    .frame(width: 120, height: 120)

                Image(systemName: "wifi.exclamationmark")
                    .font(.system(size: 48))
                    .foregroundColor(DesignTokens.warning)
            }

            VStack(spacing: 8) {
                Text("Couldn't Load Songs")
                    .font(.title2.bold())
                    .foregroundColor(DesignTokens.textPrimary)

                Text("Check your connection and try again")
                    .font(.body)
                    .foregroundColor(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)
            }

            Button {
                // Haptic feedback
                let generator = UIImpactFeedbackGenerator(style: .medium)
                generator.impactOccurred()

                loadError = nil
                isLoading = true
                loadTracks()
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "arrow.clockwise")
                    Text("Try Again")
                }
                .font(.headline)
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)
                .padding()
                .background(DesignTokens.rose)
                .cornerRadius(12)
            }
            .padding(.horizontal, 48)

            Spacer()
        }
        .padding()
    }

    // MARK: - Empty State

    private var emptyStateView: some View {
        EmptyStateView(
            type: .noSongs,
            actionTitle: "Create Your First Song",
            action: onCreateNew
        )
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
                        },
                        onDelete: {
                            trackToDelete = track
                            showingDeleteConfirmation = true
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
        // If currently loading, ignore taps to prevent cancellation
        if isLoadingAudio {
            print("[Audio] Ignoring tap - already loading audio")
            return
        }

        // If same track, toggle play/pause
        if playingTrackId == track.id {
            if isPlaying {
                audioPlayer?.pause()
                isPlaying = false
                print("[Audio] Paused playback")
            } else if audioPlayer != nil {
                audioPlayer?.play()
                isPlaying = true
                print("[Audio] Resumed playback")
            }
            return
        }

        // Different track - stop current and load new
        print("[Audio] Starting playback for track: \(track.id)")
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

                // Find the preview URL from versions - ONLY use previewUrl, not fullUrl (which requires auth)
                guard let version = details.versions.first,
                      let urlString = version.previewUrl else {
                    await MainActor.run {
                        errorMessage = "No preview available for this track"
                        showingError = true
                        isLoadingAudio = false
                        playingTrackId = nil
                    }
                    return
                }

                // Transform URL to use actual server base URL
                let transformedUrlString = transformAudioUrl(urlString)
                print("[Audio] Original URL: \(urlString)")
                print("[Audio] Transformed URL: \(transformedUrlString)")

                guard let url = URL(string: transformedUrlString) else {
                    await MainActor.run {
                        errorMessage = "Invalid audio URL"
                        showingError = true
                        isLoadingAudio = false
                        playingTrackId = nil
                    }
                    return
                }

                // PREFLIGHT CHECK: Verify URL is reachable before creating AVPlayer
                print("[Audio] Performing preflight check...")
                var preflight = URLRequest(url: url)
                preflight.httpMethod = "HEAD"
                preflight.timeoutInterval = 5.0

                do {
                    let (_, response) = try await URLSession.shared.data(for: preflight)
                    if let httpResponse = response as? HTTPURLResponse {
                        print("[Audio] Preflight response: \(httpResponse.statusCode)")
                        guard (200...299).contains(httpResponse.statusCode) || httpResponse.statusCode == 206 else {
                            await MainActor.run {
                                let message = "Audio not available (HTTP \(httpResponse.statusCode))"
                                print("[Audio] Preflight failed: \(message)")
                                ToastService.shared.error(message)
                                isLoadingAudio = false
                                playingTrackId = nil
                            }
                            return
                        }
                        print("[Audio] Preflight succeeded - content reachable")
                    }
                } catch {
                    print("[Audio] Preflight error: \(error.localizedDescription)")
                    // Don't fail on preflight error - AVPlayer might still work
                    // Just log it for debugging
                }

                // Download audio data first, then play with AVAudioPlayer
                // This bypasses AVPlayer streaming issues
                print("[Audio] Downloading audio data...")
                let (audioData, response) = try await URLSession.shared.data(from: url)

                guard let httpResponse = response as? HTTPURLResponse,
                      (200...299).contains(httpResponse.statusCode) else {
                    let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
                    throw NSError(domain: "AudioError", code: statusCode,
                                  userInfo: [NSLocalizedDescriptionKey: "Failed to download audio (HTTP \(statusCode))"])
                }

                print("[Audio] Downloaded \(audioData.count) bytes")

                await MainActor.run {
                    // Configure audio session with proper error handling
                    do {
                        let session = AVAudioSession.sharedInstance()
                        try session.setCategory(.playback, mode: .default, options: [])
                        try session.setActive(true)
                        print("[Audio] Audio session configured successfully")
                    } catch {
                        print("[Audio] Audio session error: \(error.localizedDescription)")
                        ToastService.shared.error("Audio session error: \(error.localizedDescription)")
                        isLoadingAudio = false
                        playingTrackId = nil
                        return
                    }

                    // Stop any existing playback
                    audioPlayer?.stop()

                    // Create AVAudioPlayer from downloaded data
                    do {
                        let newPlayer = try AVAudioPlayer(data: audioData)
                        newPlayer.prepareToPlay()
                        audioPlayer = newPlayer

                        print("[Audio] AVAudioPlayer created, starting playback...")
                        if newPlayer.play() {
                            print("[Audio] Playback started successfully!")
                            isPlaying = true
                            isLoadingAudio = false
                        } else {
                            print("[Audio] play() returned false")
                            ToastService.shared.error("Failed to start playback")
                            isLoadingAudio = false
                            playingTrackId = nil
                        }
                    } catch {
                        print("[Audio] AVAudioPlayer error: \(error.localizedDescription)")
                        ToastService.shared.error("Audio error: \(error.localizedDescription)")
                        isLoadingAudio = false
                        playingTrackId = nil
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
        audioPlayer?.stop()
        audioPlayer = nil
        playingTrackId = nil
        isPlaying = false
        isLoadingAudio = false
    }

    // MARK: - Data Loading

    private func loadTracks() {
        Task {
            await refreshTracks()
        }
    }

    private func refreshTracks() async {
        do {
            let response = try await apiClient.getTracks()
            await MainActor.run {
                // Sort by most recent first
                tracks = response.tracks.sorted {
                    $0.createdAt > $1.createdAt
                }
                isLoading = false
                loadError = nil
            }
        } catch {
            await MainActor.run {
                // Show error state (no mock fallback in production)
                loadError = error
                isLoading = false
            }
        }
    }

    private func deleteTrack(_ track: Track) {
        // Stop playback if deleting the playing track
        if playingTrackId == track.id {
            stopPlayback()
        }

        trackToDelete = nil

        // Call delete API
        Task {
            do {
                try await apiClient.deleteTrack(trackId: track.id)

                await MainActor.run {
                    // Remove from local list after successful API call
                    tracks.removeAll { $0.id == track.id }
                    ToastService.shared.success("Song deleted")
                }
            } catch {
                await MainActor.run {
                    ToastService.shared.error("Failed to delete song")
                }
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

    /// Transform audio URL to use the actual server base URL.
    /// Handles localhost, 127.0.0.1, 0.0.0.0, IPv6 loopback, and relative paths.
    private func transformAudioUrl(_ urlString: String) -> String {
        // Handle relative paths (just /preview/...)
        if urlString.hasPrefix("/") {
            return apiClient.baseURL + urlString
        }

        guard let storedUrl = URL(string: urlString) else { return urlString }

        // List of hosts that should be rewritten to apiClient.baseURL
        let localHosts = [
            "localhost",
            "127.0.0.1",
            "0.0.0.0",
            "::1",           // IPv6 loopback
            "[::1]",         // IPv6 loopback in bracket notation
            "[::]"           // IPv6 any address
        ]

        guard let host = storedUrl.host else {
            // No host - might be a relative URL
            let path = storedUrl.path
            return path.isEmpty ? urlString : apiClient.baseURL + path
        }

        // If host is NOT a local address, return unchanged
        if !localHosts.contains(host.lowercased()) {
            return urlString
        }

        // Rewrite local URLs to use apiClient.baseURL
        let path = storedUrl.path
        if path.isEmpty {
            return urlString
        }

        // Include query string if present
        if let query = storedUrl.query {
            return apiClient.baseURL + path + "?" + query
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

    private var accessibilityStatusText: String {
        switch track.status {
        case "draft": return "Draft"
        case "lyrics_approved": return "Lyrics ready"
        case "rendering", "processing": return "Creating"
        case "preview_ready": return "Preview ready"
        case "full_ready": return "Complete"
        default: return track.status
        }
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
                .accessibilityHidden(true)

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
                .accessibilityLabel("Song options")
                .accessibilityHint("Opens menu to play, share, or delete")
            }
            .padding(12)
            .background(DesignTokens.cardBackground)
            .cornerRadius(16)
            .cardShadow()
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(track.title). \(subtitleText). \(accessibilityStatusText)")
        .accessibilityHint(isTappable ? "Double tap to continue editing" : (isPlayable ? "Double tap to play" : ""))
        .accessibilityValue(isPlaying ? "Now playing" : "")
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
