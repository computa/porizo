//
//  MySongsView.swift
//  PorizoApp
//
//  Displays list of user's songs with playback for completed ones.
//  Warm Canvas design system.
//

import SwiftUI
import AVFoundation

private enum LibraryFilter: String, CaseIterable {
    case created = "My Songs"
    case received = "Received"
}

struct MySongsView: View {
    let apiClient: APIClient
    var playerState: PlayerState
    var refreshTrigger: Int = 0
    let onCreateNew: () -> Void
    let onBack: () -> Void
    var onDraftSelected: ((String, Int) -> Void)? = nil  // trackId, versionNum
    var onResumeSelected: ((String, Int, CreateFlowResumeTarget) -> Void)? = nil

    init(apiClient: APIClient, playerState: PlayerState, refreshTrigger: Int = 0, onCreateNew: @escaping () -> Void, onBack: @escaping () -> Void, onDraftSelected: ((String, Int) -> Void)? = nil, onResumeSelected: ((String, Int, CreateFlowResumeTarget) -> Void)? = nil) {
        self.apiClient = apiClient
        self.playerState = playerState
        self.refreshTrigger = refreshTrigger
        self.onCreateNew = onCreateNew
        self.onBack = onBack
        self.onDraftSelected = onDraftSelected
        self.onResumeSelected = onResumeSelected
        _shareController = State(initialValue: ShareController(apiClient: apiClient))
    }

    // Polling service for automatic refresh when tracks are rendering
    @State private var pollingService = RenderPollingService()

    @State private var tracks: [Track] = []
    @State private var selectedFilter: LibraryFilter = .created
    @State private var isLoading = true
    @State private var loadError: Error?
    @State private var showingError = false
    @State private var errorMessage = ""

    // Delete confirmation state
    @State private var trackToDelete: Track?
    @State private var showingDeleteConfirmation = false

    // Haptic trigger
    @State private var hapticTrigger = false

    // Share sheet state - uses sheet(item:) pattern for reliable presentation
    // ShareController persisted in @State to avoid recreation on every sheet re-evaluation
    @State private var trackToShare: Track?
    @State private var shareController: ShareController

    // Cache control - prevent unnecessary refetches on tab switch
    @State private var lastFetchTime: Date?
    private let cacheFreshnessDuration: TimeInterval = 30  // 30 seconds
    @State private var cacheLoaded = false

    // Audio loading task - cancel on new track selection to prevent race conditions
    @State private var audioLoadTask: Task<Void, Never>?

    // Track IDs that were rendering to detect completions for notifications
    @State private var previouslyRenderingTrackIds: Set<String> = []

    // Funnel milestone: fires first_song_completed analytics once per install
    // when the user's first track finishes rendering. Porizo skips preview by
    // design, so full_ready (or legacy "ready") is the success signal.
    @AppStorage("firstSongCompletedEmitted") private var firstSongCompletedEmitted = false

    private var hasReceivedTracks: Bool {
        tracks.contains { $0.isReceived }
    }

    private var filteredTracks: [Track] {
        switch selectedFilter {
        case .created: return tracks.filter { !$0.isReceived }
        case .received: return tracks.filter { $0.isReceived }
        }
    }

    var body: some View {
        ZStack {
            // Background: Warm parchment (header provided by SongsTabView)
            DesignTokens.background.ignoresSafeArea()

            Group {
                if isLoading {
                    loadingView
                } else if loadError != nil {
                    errorStateView
                } else if tracks.isEmpty {
                    emptyStateView
                } else {
                    VStack(spacing: 0) {
                        libraryFilterPicker
                        if filteredTracks.isEmpty && selectedFilter == .received {
                            receivedEmptyStateView
                        } else if filteredTracks.isEmpty && selectedFilter == .created {
                            emptyStateView
                        } else {
                            trackListView
                        }
                    }
                }
            }
            .padding(.bottom, playerState.currentTrack != nil ? DesignTokens.miniPlayerHeight : 0)
        }
        // No navigation title - SongsTabView provides custom header
        .sensoryFeedback(.impact(weight: .medium), trigger: hapticTrigger)
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
                Text("Remove \"\(track.title)\" from your library?")
            }
        }
        .sheet(item: $trackToShare) { track in
            SharePostcardView(
                recipientName: track.recipientName ?? "Recipient",
                occasion: track.occasion,
                shareURL: track.shareUrl,
                claimPIN: track.claimPin,
                onSend: {
                    // Fast path: pre-generated URL available
                    if let urlString = track.shareUrl,
                       let claimPin = track.claimPin,
                       let url = URL(string: urlString) {
                        presentShareSheetFromMySongs(track: track, url: url, claimPin: claimPin)
                        return
                    }
                    // Slow path: generate on-demand
                    ToastService.shared.show("Creating share link...", type: .info)
                    shareController.generateShareLink(trackId: track.id, versionNum: track.latestVersion)
                    Task { @MainActor in
                        var shareURL: String?
                        for _ in 0..<40 {
                            try? await Task.sleep(for: .milliseconds(250))
                            if let url = shareController.shareURLString {
                                shareURL = url
                                break
                            }
                        }
                        guard let urlString = shareURL,
                              let claimPin = shareController.claimPin,
                              let url = URL(string: urlString) else {
                            ToastService.shared.show("Could not create share link. Try again.", type: .error)
                            return
                        }
                        presentShareSheetFromMySongs(track: track, url: url, claimPin: claimPin)
                    }
                },
                onSaveToPhotos: {},
                onCopyLink: {
                    if let url = track.shareUrl {
                        UIPasteboard.general.string = url
                        ToastService.shared.show("Link copied!", type: .success)
                    } else {
                        ToastService.shared.show("Link not ready yet. Tap Send first.", type: .warning)
                    }
                },
                onSkip: { trackToShare = nil }
            )
        }
        .onAppear {
            // Only refetch if cache is stale or empty
            if shouldRefresh() {
                loadTracks()
            }
        }
        .onDisappear {
            pollingService.stopPolling()
        }
        .onChange(of: refreshTrigger) { oldValue, newValue in
            // Force refresh when trigger increments (e.g., after track creation)
            if newValue > oldValue {
                Task {
                    await refreshTracks()
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .trackRenderCompleted)) { notification in
            // Refresh tracks when a render completes (e.g., from push notification or background download)
            Task { await refreshTracks() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .appReturnedToForeground)) { _ in
            // Refresh tracks when app returns from background to catch completed renders
            Task { await refreshTracks() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .songLibraryDidChange)) { _ in
            // Refresh tracks when a song is claimed via share link
            Task { await refreshTracks() }
        }
        .onChange(of: tracks) { _, newTracks in
            // Track which are currently rendering
            let currentlyRendering = Set(newTracks.filter {
                $0.status == "rendering" || $0.status == "processing"
            }.map { $0.id })

            // Find tracks that just completed (were rendering, now not in rendering set)
            let justCompletedIds = previouslyRenderingTrackIds.subtracting(currentlyRendering)

            for trackId in justCompletedIds {
                // Check if track completed successfully
                if let track = newTracks.first(where: { $0.id == trackId }),
                   track.status == "ready" || track.status == "preview_ready" || track.status == "full_ready" {
                    Task {
                        await LocalNotificationService.shared.showRenderComplete(
                            trackId: track.id,
                            trackTitle: track.title
                        )
                    }

                    // Funnel milestone — fires once per install on the user's
                    // first finished song. Porizo skips preview by design, so
                    // only count full_ready / legacy "ready" (not preview_ready).
                    if !firstSongCompletedEmitted,
                       track.status == "ready" || track.status == "full_ready" {
                        AnalyticsService.shared.log(
                            .firstSongCompleted,
                            properties: [
                                "trackId": track.id,
                                "status": track.status,
                            ]
                        )
                        firstSongCompletedEmitted = true
                    }
                }
            }

            // Update tracking set for next comparison
            previouslyRenderingTrackIds = currentlyRendering

            // Auto-poll when any track is rendering
            let hasRenderingTrack = !currentlyRendering.isEmpty

            if hasRenderingTrack && !pollingService.isPolling {
                pollingService.startPolling(interval: 5.0) {
                    Task { [weak apiClient] in
                        guard let client = apiClient else { return }
                        do {
                            let response = try await client.getTracks()
                            await MainActor.run {
                                tracks = response.tracks.sorted { $0.createdAt > $1.createdAt }
                                lastFetchTime = Date.now
                                LocalCache.shared.saveTracks(tracks)
                            }
                        } catch {
                            print("[MySongsView] Polling error (will retry): \(error.localizedDescription)")
                        }
                    }
                }
            } else if !hasRenderingTrack && pollingService.isPolling {
                pollingService.stopPolling()
            }
        }
    }

    private func presentShareSheetFromMySongs(track: Track, url: URL, claimPin: String) {
        let message = ShareMessageContent.activityMessage(
            shareURL: url.absoluteString,
            claimPin: claimPin,
            recipientName: track.recipientName,
            occasion: track.occasion
        )
        let activityVC = UIActivityViewController(activityItems: [message], applicationActivities: nil)
        activityVC.completionWithItemsHandler = { _, completed, _, _ in
            guard completed else { return }
            Task { @MainActor in
                ReviewManager.shared.recordSuccessfulShare()
            }
        }
        if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
           let root = windowScene.windows.first?.rootViewController {
            var topVC = root
            while let presented = topVC.presentedViewController { topVC = presented }
            activityVC.popoverPresentationController?.sourceView = topVC.view
            topVC.present(activityVC, animated: true)
        }
    }

    /// Check if we should refresh data based on cache freshness
    private func shouldRefresh() -> Bool {
        // Always fetch if no tracks loaded yet
        guard !tracks.isEmpty else { return true }

        // Refresh if never fetched or cache is stale
        guard let lastFetch = lastFetchTime else { return true }

        // Always refresh if any track is rendering (status can change any moment)
        let hasRenderingTrack = tracks.contains { $0.status == "rendering" || $0.status == "processing" }
        if hasRenderingTrack {
            return true
        }

        return Date.now.timeIntervalSince(lastFetch) > cacheFreshnessDuration
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
                    .foregroundStyle(DesignTokens.warning)
            }

            VStack(spacing: 8) {
                Text("Couldn't Load Songs")
                    .font(.title2.bold())
                    .foregroundStyle(DesignTokens.textPrimary)

                Text("Check your connection and try again")
                    .font(.body)
                    .foregroundStyle(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)
            }

            Button {
                hapticTrigger.toggle()
                loadError = nil
                isLoading = true
                loadTracks()
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "arrow.clockwise")
                    Text("Try Again")
                }
                .font(.headline)
                .foregroundStyle(DesignTokens.background)
                .frame(maxWidth: .infinity)
                .padding()
                .background(DesignTokens.gold)
                .clipShape(.rect(cornerRadius: 12))
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

    // MARK: - Library Filter Picker

    private var libraryFilterPicker: some View {
        Picker("Filter", selection: $selectedFilter) {
            ForEach(LibraryFilter.allCases, id: \.self) { filter in
                Text(filter.rawValue).tag(filter)
            }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, 20)
        .padding(.vertical, 8)
        .tint(DesignTokens.gold)
    }

    // MARK: - Received Empty State

    private var receivedEmptyStateView: some View {
        VStack(spacing: 16) {
            Spacer()

            ZStack {
                Circle()
                    .fill(DesignTokens.gold.opacity(0.12))
                    .frame(width: 100, height: 100)

                Image(systemName: "envelope.open")
                    .font(.system(size: 40))
                    .foregroundStyle(DesignTokens.gold)
            }

            VStack(spacing: 6) {
                Text("No received songs yet")
                    .font(DesignTokens.bodyFont(size: 18, weight: .semibold))
                    .foregroundStyle(DesignTokens.textPrimary)

                Text("Songs shared with you will appear here")
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)
            }

            Spacer()
        }
        .padding()
    }

    // MARK: - Track List

    private var trackListView: some View {
        ScrollView {
            // Low Power Mode banner
            if pollingService.isLowPowerModeActive {
                HStack(spacing: 8) {
                    Image(systemName: "bolt.slash.fill")
                        .font(.system(size: 13))
                    Text("Song creation updates paused \u{2014} Low Power Mode is on")
                        .font(DesignTokens.bodyFont(size: 13))
                }
                .foregroundStyle(DesignTokens.warning)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(DesignTokens.warning.opacity(0.1))
                .clipShape(.rect(cornerRadius: 10))
                .padding(.horizontal, 20)
                .padding(.bottom, 8)
            }

            // Song count + sort indicator
            HStack {
                Text("\(filteredTracks.count) songs")
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundStyle(DesignTokens.textTertiary)
                Spacer()
                HStack(spacing: 4) {
                    Image(systemName: "arrow.up.arrow.down")
                        .font(.system(size: 12))
                    Text("Recent")
                        .font(DesignTokens.bodyFont(size: 13))
                }
                .foregroundStyle(DesignTokens.textSecondary)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 8)

            LazyVStack(spacing: 12) {
                ForEach(filteredTracks, id: \.id) { track in
                    SongCard(
                        track: track,
                        isPlaying: playerState.currentTrack?.id == track.id && playerState.isPlaying,
                        isLoadingAudio: playerState.isLoading && playerState.currentTrack?.id == track.id,
                        onPlay: { togglePlayback(for: track) },
                        onTap: {
                            if isDraftOrLyricsApproved(track: track) {
                                handleDraftTap(track: track)
                            }
                        },
                        onShare: (track.status == "ready" || track.status == "preview_ready" || track.status == "full_ready") && (track.canShare ?? true) ? {
                            trackToShare = track
                        } : nil,
                        onDelete: {
                            trackToDelete = track
                            showingDeleteConfirmation = true
                        },
                        onResume: resumeAction(for: track)
                    )
                }
            }
            .padding(.horizontal, 20)
        }
        .refreshable {
            await refreshTracks()
        }
    }

    private func isDraftOrLyricsApproved(track: Track) -> Bool {
        track.status == "draft" || track.status == "lyrics_approved"
    }

    private func canResume(track: Track) -> Bool {
        guard !track.isReceived, track.canEdit ?? true else { return false }
        return ["draft", "lyrics_approved", "rendering", "processing", "failed", "error"].contains(track.status)
    }

    private func resumeAction(for track: Track) -> (() -> Void)? {
        guard canResume(track: track), onResumeSelected != nil else {
            return nil
        }
        return {
            handleResumeSelection(track: track)
        }
    }

    private func handleDraftTap(track: Track) {
        Task {
            do {
                // Fetch track details to get version number
                let details = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "getTrackForDraft") {
                    try await apiClient.getTrack(trackId: track.id)
                }
                let versionNum = latestVersion(in: details)?.versionNum ?? track.latestVersion

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

    private func handleResumeSelection(track: Track) {
        Task {
            do {
                let details = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "getTrackForResume") {
                    try await apiClient.getTrack(trackId: track.id)
                }

                let latestVersion = latestVersion(in: details)
                let versionNum = latestVersion?.versionNum ?? track.latestVersion
                let resumeTarget = resumeTarget(for: latestVersion)

                await MainActor.run {
                    onResumeSelected?(track.id, versionNum, resumeTarget)
                }
            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    showingError = true
                }
            }
        }
    }

    private func latestVersion(in details: GetTrackResponse) -> TrackVersion? {
        details.versions.max { lhs, rhs in
            lhs.versionNum < rhs.versionNum
        }
    }

    private func resumeTarget(for version: TrackVersion?) -> CreateFlowResumeTarget {
        guard version?.lyricsStatus == "approved" else {
            return .lyricsReview
        }
        return .trackPlayer
    }

    // MARK: - Playback

    private func togglePlayback(for track: Track) {
        // If currently loading, ignore taps
        if playerState.isLoading {
            print("[Audio] Ignoring tap - already loading audio")
            return
        }

        // If same track, toggle play/pause
        if playerState.currentTrack?.id == track.id {
            playerState.togglePlayback()
            return
        }

        // Different track - load and play
        print("[Audio] Starting playback for track: \(track.id)")
        loadAndPlay(track: track)
    }

    private func loadAndPlay(track: Track) {
        // Cancel any in-flight audio download to prevent race conditions
        audioLoadTask?.cancel()

        // Set loading state
        playerState.setLoading(track: track)

        // Capture track.id at task creation to prevent race conditions
        // (the track parameter could change while async work is in flight)
        audioLoadTask = Task { @MainActor [trackId = track.id] in
            do {
                // Check cancellation before network call
                try Task.checkCancellation()

                // Fetch track details to get preview URL and lyrics
                let details = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "getTrackForPlayback") {
                    try await apiClient.getTrack(trackId: trackId)
                }

                // Check cancellation after API call
                try Task.checkCancellation()

                guard let (version, urlString) = details.latestPlayableVersion(), !urlString.isEmpty else {
                    errorMessage = "Audio is not available for this track yet"
                    showingError = true
                    playerState.stopPlayback()
                    return
                }

                // Transform URL to use actual server base URL
                let transformedUrlString = transformAudioUrl(urlString, baseURL: apiClient.baseURL)
                print("[Audio] Original URL: \(urlString)")
                print("[Audio] Transformed URL: \(transformedUrlString)")
                LocalCache.shared.savePlayableAudioURL(transformedUrlString, for: trackId)

                guard let url = URL(string: transformedUrlString) else {
                    errorMessage = "Invalid audio URL"
                    showingError = true
                    playerState.stopPlayback()
                    return
                }

                // Check cancellation before download
                try Task.checkCancellation()

                // Download audio data with background protection
                print("[Audio] Downloading audio data...")
                let (audioData, response) = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "downloadAudio") {
                    try await URLSession.shared.data(from: url)
                }

                // Check cancellation after download
                try Task.checkCancellation()

                // Verify this is still the track we want to play (task-local trackId vs current state)
                guard !Task.isCancelled, playerState.currentTrack?.id == trackId else {
                    print("[Audio] Track changed during download, skipping playback")
                    return
                }

                guard let httpResponse = response as? HTTPURLResponse,
                      (200...299).contains(httpResponse.statusCode) else {
                    let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
                    throw NSError(domain: "AudioError", code: statusCode,
                                  userInfo: [NSLocalizedDescriptionKey: "Failed to download audio (HTTP \(statusCode))"])
                }

                print("[Audio] Downloaded \(audioData.count) bytes")

                // Final cancellation check before playback
                try Task.checkCancellation()

                // Pass to PlayerState to handle playback
                playerState.loadAndPlay(data: audioData, track: track, version: version)

            } catch is CancellationError {
                // Expected when user taps different track - silently ignore
                print("[Audio] Load cancelled - user selected different track")
            } catch {
                errorMessage = error.localizedDescription
                showingError = true
                playerState.stopPlayback()
            }
        }
    }

    // MARK: - Data Loading

    private func loadTracks() {
        Task {
            await loadCachedTracks()
            await refreshTracks()
        }
    }

    private func refreshTracks() async {
        do {
            let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "refreshTracks") {
                try await apiClient.getTracks()
            }
            await MainActor.run {
                // Sort by most recent first
                tracks = response.tracks.sorted {
                    $0.createdAt > $1.createdAt
                }
                isLoading = false
                loadError = nil
                lastFetchTime = Date.now  // Update cache timestamp
                LocalCache.shared.saveTracks(tracks)
            }
        } catch {
            await MainActor.run {
                // If we already have cached data, keep list visible and suppress error state
                if tracks.isEmpty {
                    loadError = error
                } else {
                    loadError = nil
                }
                isLoading = false
            }
        }
    }

    private func loadCachedTracks() async {
        guard !cacheLoaded else { return }
        cacheLoaded = true
        if let cached = LocalCache.shared.loadTracks() {
            await MainActor.run {
                tracks = cached.data.sorted { $0.createdAt > $1.createdAt }
                isLoading = false
                loadError = nil
                lastFetchTime = cached.savedAt
            }
        }
    }

    private func deleteTrack(_ track: Track) {
        // Stop playback if deleting the playing track
        if playerState.currentTrack?.id == track.id {
            playerState.stopPlayback()
        }

        trackToDelete = nil

        // Call delete API
        Task {
            do {
                try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "deleteTrack") {
                    try await apiClient.deleteTrack(trackId: track.id)
                }

                await MainActor.run {
                    // Remove from local list after successful API call
                    tracks.removeAll { $0.id == track.id }
                    ToastService.shared.success("Removed from library")
                }
            } catch {
                await MainActor.run {
                    ToastService.shared.error("Failed to remove from library")
                }
            }
        }
    }

}

// MARK: - Song Card

struct SongCard: View {
    let track: Track
    let isPlaying: Bool
    let isLoadingAudio: Bool
    let onPlay: () -> Void
    let onTap: () -> Void
    var onShare: (() -> Void)? = nil
    var onDelete: (() -> Void)? = nil
    var onResume: (() -> Void)? = nil

    @Environment(StyleStore.self) private var styleStore

    private var isPlayable: Bool {
        track.status == "ready" || track.status == "preview_ready" || track.status == "full_ready"
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
        case "ready", "full_ready": return "Complete"
        case "failed", "error": return "Failed"
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
            VStack(spacing: 0) {
                HStack(spacing: 14) {
                    // Larger artwork (80pt) with occasion gradient
                    SongCoverView(track: track, size: 80)
                        .accessibilityHidden(true)

                    // Content column
                    VStack(alignment: .leading, spacing: 4) {
                        // Title
                        Text(track.title)
                            .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                            .foregroundStyle(DesignTokens.textPrimary)
                            .lineLimit(1)

                        // Subtitle
                        Text(subtitleText)
                            .font(DesignTokens.bodyFont(size: 13))
                            .foregroundStyle(DesignTokens.textSecondary)
                            .lineLimit(1)

                        // Status badge row
                        HStack(spacing: 8) {
                            statusBadge

                            Spacer()

                            // Play button for playable tracks
                            if isPlayable {
                                Button {
                                    onPlay()
                                } label: {
                                    if isLoadingAudio {
                                        ProgressView()
                                            .scaleEffect(0.8)
                                            .tint(DesignTokens.gold)
                                            .frame(width: 36, height: 36)
                                    } else {
                                        Image(systemName: isPlaying ? "pause.circle.fill" : "play.circle.fill")
                                            .font(.system(size: 36))
                                            .foregroundStyle(DesignTokens.gold)
                                    }
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel(isPlaying ? "Pause" : "Play")
                            }

                            // Vertical ellipsis menu
                            Menu {
                                if let resume = onResume {
                                    Button {
                                        resume()
                                    } label: {
                                        Label(resumeActionTitle, systemImage: "arrow.clockwise")
                                    }
                                }

                                if isPlayable {
                                    Button {
                                        onPlay()
                                    } label: {
                                        Label(isPlaying ? "Pause" : "Play", systemImage: isPlaying ? "pause.fill" : "play.fill")
                                    }
                                }

                                if let share = onShare {
                                    if onResume != nil || isPlayable {
                                        Divider()
                                    }
                                    Button {
                                        share()
                                    } label: {
                                        Label("Share", systemImage: "square.and.arrow.up")
                                    }
                                }

                                if let delete = onDelete {
                                    Divider()
                                    Button(role: .destructive) {
                                        delete()
                                    } label: {
                                        Label("Delete", systemImage: "trash")
                                    }
                                }
                            } label: {
                                Image(systemName: "ellipsis")
                                    .rotationEffect(.degrees(90))
                                    .font(.system(size: 18))
                                    .foregroundStyle(DesignTokens.textTertiary)
                                    .frame(width: 28, height: 28)
                                    .contentShape(Rectangle())
                            }
                            .accessibilityLabel("Song options")
                            .accessibilityHint("Opens menu to play, share, or delete")
                        }
                    }
                }
                .padding(14)
            }
            .background(DesignTokens.surface)
            .clipShape(.rect(cornerRadius: DesignTokens.radiusLarge))
            .overlay(
                RoundedRectangle(cornerRadius: DesignTokens.radiusLarge)
                    .stroke(DesignTokens.border, lineWidth: 0.5)
            )
            .elevation(.level1)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(track.title). \(subtitleText). \(accessibilityStatusText)")
        .accessibilityHint(isTappable ? "Double tap to continue editing" : (isPlayable ? "Double tap to play" : ""))
        .accessibilityValue(isPlaying ? "Now playing" : "")
    }

    private var resumeActionTitle: String {
        switch track.status {
        case "lyrics_approved", "rendering", "processing":
            return "Try Again"
        case "failed", "error":
            return "Retry"
        default:
            return "Continue"
        }
    }

    // MARK: - Status Badge (v1.pen design)

    @ViewBuilder
    private var statusBadge: some View {
        switch track.status {
        case "ready", "preview_ready", "full_ready":
            // Green "Ready" badge
            Text("Ready")
                .font(DesignTokens.bodyFont(size: 11, weight: .medium))
                .foregroundStyle(DesignTokens.statusSuccess)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(DesignTokens.statusSuccessBg)
                .clipShape(.rect(cornerRadius: 10))

        case "rendering", "processing":
            // Gold "Creating" badge with spinner
            HStack(spacing: 4) {
                ProgressView()
                    .scaleEffect(0.6)
                    .tint(DesignTokens.gold)
                Text("Creating")
                    .font(DesignTokens.bodyFont(size: 11, weight: .medium))
                    .foregroundStyle(DesignTokens.gold)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(DesignTokens.gold.opacity(0.15))
            .clipShape(.rect(cornerRadius: 10))

        case "draft":
            // Gray "Draft" badge
            Text("Draft")
                .font(DesignTokens.bodyFont(size: 11, weight: .medium))
                .foregroundStyle(DesignTokens.textTertiary)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(DesignTokens.surface)
                .clipShape(.rect(cornerRadius: 10))

        case "lyrics_approved":
            // Blue "Lyrics Ready" badge
            Text("Lyrics Ready")
                .font(DesignTokens.bodyFont(size: 11, weight: .medium))
                .foregroundStyle(DesignTokens.statusInfo)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(DesignTokens.statusInfoBg)
                .clipShape(.rect(cornerRadius: 10))

        case "failed", "error":
            // Red "Failed" badge with retry
            HStack(spacing: 4) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 10))
                Text("Failed")
                    .font(DesignTokens.bodyFont(size: 11, weight: .medium))
            }
            .foregroundStyle(DesignTokens.error)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(DesignTokens.error.opacity(0.12))
            .clipShape(.rect(cornerRadius: 10))

        default:
            EmptyView()
        }
    }

    // Subtitle format: "Style • Recipient • Occasion"
    private var subtitleText: String {
        var parts: [String] = []

        // Style
        if let style = track.style {
            parts.append(styleStore.displayName(for: style))
        }

        // Recipient
        if let recipient = track.recipientName, !recipient.isEmpty {
            parts.append(recipient)
        }

        // Occasion
        if let occasion = track.occasion,
           let occ = Occasion(rawValue: occasion) {
            parts.append(occ.displayName)
        }

        return parts.joined(separator: " • ")
    }
}

#Preview {
    NavigationStack {
        MySongsView(
            apiClient: APIClient(baseURL: AppConfig.apiBaseURL),
            playerState: PlayerState(),
            onCreateNew: { },
            onBack: { }
        )
    }
}
