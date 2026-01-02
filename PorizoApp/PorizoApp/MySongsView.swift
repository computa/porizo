//
//  MySongsView.swift
//  PorizoApp
//
//  Displays list of user's songs with playback for completed ones.
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

    var body: some View {
        NavigationView {
            Group {
                if isLoading {
                    ProgressView("Loading songs...")
                } else if tracks.isEmpty {
                    emptyStateView
                } else {
                    trackListView
                }
            }
            .navigationTitle("My Songs")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Back") {
                        stopPlayback()
                        onBack()
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        stopPlayback()
                        onCreateNew()
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
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
    }

    // MARK: - Empty State

    private var emptyStateView: some View {
        VStack(spacing: 24) {
            Spacer()

            Image(systemName: "music.note.list")
                .font(.system(size: 60))
                .foregroundColor(.secondary)

            Text("No Songs Yet")
                .font(.headline)

            Text("Create your first personalized song!")
                .font(.subheadline)
                .foregroundColor(.secondary)

            Button {
                onCreateNew()
            } label: {
                Label("Create Song", systemImage: "wand.and.stars")
            }
            .buttonStyle(.borderedProminent)

            Spacer()
        }
    }

    // MARK: - Track List

    private var trackListView: some View {
        List {
            ForEach(tracks, id: \.id) { track in
                trackRow(track: track)
            }
        }
        .refreshable {
            await refreshTracks()
        }
    }

    private func trackRow(track: Track) -> some View {
        let isTappable = isDraftOrLyricsApproved(track: track)

        return HStack(spacing: 16) {
            // Play button for completed tracks
            if isPlayable(track: track) {
                Button {
                    togglePlayback(for: track)
                } label: {
                    if isLoadingAudio && playingTrackId == track.id {
                        ProgressView()
                            .frame(width: 44, height: 44)
                    } else {
                        Image(systemName: playingTrackId == track.id && isPlaying ? "pause.circle.fill" : "play.circle.fill")
                            .font(.system(size: 44))
                            .foregroundColor(.blue)
                    }
                }
                .buttonStyle(.plain)
            } else {
                // Status icon for non-playable tracks
                Image(systemName: statusIcon(for: track))
                    .font(.system(size: 32))
                    .foregroundColor(statusColor(for: track))
                    .frame(width: 44, height: 44)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(track.title)
                    .font(.headline)
                    .lineLimit(1)

                HStack {
                    if let occasion = track.occasion {
                        Text(occasion.replacingOccurrences(of: "_", with: " ").capitalized)
                            .font(.caption)
                            .foregroundColor(.blue)

                        Text("•")
                            .foregroundColor(.secondary)
                    }

                    Text(statusText(for: track))
                        .font(.caption)
                        .foregroundColor(statusColor(for: track))
                }
            }

            Spacer()

            // Chevron indicator for tappable rows
            if isTappable {
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.vertical, 8)
        .contentShape(Rectangle())
        .onTapGesture {
            if isTappable {
                handleDraftTap(track: track)
            }
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

    // MARK: - Status Helpers

    private func isPlayable(track: Track) -> Bool {
        track.status == "preview_ready" || track.status == "full_ready"
    }

    private func statusIcon(for track: Track) -> String {
        switch track.status {
        case "preview_ready", "full_ready":
            return "checkmark.circle.fill"
        case "rendering", "processing":
            return "clock.fill"
        case "failed":
            return "exclamationmark.circle.fill"
        default:
            return "music.note"
        }
    }

    private func statusColor(for track: Track) -> Color {
        switch track.status {
        case "preview_ready", "full_ready":
            return .green
        case "rendering", "processing":
            return .orange
        case "failed":
            return .red
        default:
            return .secondary
        }
    }

    private func statusText(for track: Track) -> String {
        switch track.status {
        case "preview_ready":
            return "Preview Ready"
        case "full_ready":
            return "Complete"
        case "rendering", "processing":
            return "Rendering..."
        case "failed":
            return "Failed"
        case "lyrics_approved":
            return "Lyrics Approved"
        case "draft":
            return "Draft"
        default:
            return track.status.capitalized
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
                // Server stores localhost:3000 but we need the actual server IP
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

                    print("DEBUG: Playing audio from URL: \(url)")

                    // Create player and start
                    let playerItem = AVPlayerItem(url: url)
                    player = AVPlayer(playerItem: playerItem)


                    // Observe player errors
                    NotificationCenter.default.addObserver(
                        forName: .AVPlayerItemFailedToPlayToEndTime,
                        object: playerItem,
                        queue: .main
                    ) { notification in
                        if let error = notification.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error {
                            print("DEBUG: Playback failed: \(error)")
                        }
                    }

                    player?.play()
                    isPlaying = true
                    isLoadingAudio = false

                    // Check player status after a short delay
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                        print("DEBUG: Player status: \(player?.status.rawValue ?? -1)")
                        print("DEBUG: Player item status: \(playerItem.status.rawValue)")
                        if let error = playerItem.error {
                            print("DEBUG: Player item error: \(error)")
                        }
                        print("DEBUG: Current time: \(player?.currentTime().seconds ?? 0)")
                    }

                    // Observe playback end
                    NotificationCenter.default.addObserver(
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
            }
        } catch {
            await MainActor.run {
                errorMessage = error.localizedDescription
                showingError = true
                isLoading = false
            }
        }
    }

    /// Transform audio URL to use the actual server base URL
    /// The server stores URLs with localhost:3000, but we need the actual server IP
    private func transformAudioUrl(_ urlString: String) -> String {
        // Extract the path from the stored URL
        guard let storedUrl = URL(string: urlString),
              let path = storedUrl.path.isEmpty ? nil : storedUrl.path else {
            return urlString
        }

        // Use the API client's base URL as the new host
        return apiClient.baseURL + path
    }
}

#Preview {
    MySongsView(
        apiClient: APIClient(baseURL: "http://localhost:3000"),
        onCreateNew: { },
        onBack: { }
    )
}
