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
    var playerState: PlayerState
    let onOccasionSelected: (Occasion) -> Void
    let onCreate: () -> Void
    let onSendGift: () -> Void
    let showsGiftSendEntry: Bool
    var onSeeAllSongs: (() -> Void)?

    @AppStorage("hasCompletedFirstSong") private var hasCompletedFirstSong = false
    @State private var recentTracks: [Track] = []
    @State private var isLoadingTracks = false
    @State private var audioLoadTask: Task<Void, Never>?
    @State private var hapticImpactTrigger = false
    @State private var hapticLightTrigger = false

    var body: some View {
        ZStack {
            // Background: Deep velvet black
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header: "Explore" in gold Playfair Display
                exploreHeader

                ScrollView {
                    VStack(spacing: 0) {
                        // Featured Card
                        featuredCard
                            .padding(.bottom, 24)

                        // Quick Create Section
                        quickCreateSection
                            .padding(.bottom, 24)

                        // Recent Songs (if any)
                        if !recentTracks.isEmpty {
                            recentSongsSection
                                .padding(.bottom, 24)
                        }

                        // Popular Occasions
                        occasionsSection

                        // Get Started card for new users
                        if recentTracks.isEmpty && !isLoadingTracks {
                            getStartedCard
                                .padding(.top, 24)
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 8)
                    .padding(.bottom, playerState.currentTrack != nil ? DesignTokens.miniPlayerHeight : 0) // MiniPlayer clearance
                }
                .refreshable {
                    await refreshContent()
                }
            }
        }
        .onAppear {
            if recentTracks.isEmpty {
                loadRecentTracks()
            }
        }
        .sensoryFeedback(.impact(weight: .medium), trigger: hapticImpactTrigger)
    }

    // MARK: - Header

    private var exploreHeader: some View {
        HStack {
            Text("Explore")
                .font(DesignTokens.displayFont(size: 28))
                .foregroundStyle(DesignTokens.gold)

            Spacer()
        }
        .padding(.horizontal, 20)
        .frame(height: 56)
    }

    // MARK: - Featured Card (Variant A)

    private var featuredCard: some View {
        ZStack(alignment: .bottomLeading) {
            // Gold gradient background
            LinearGradient(
                colors: [
                    DesignTokens.gold.opacity(0.7),
                    DesignTokens.goldDark.opacity(0.4)
                ],
                startPoint: .topTrailing,
                endPoint: .bottomLeading
            )
            .frame(height: 160)
            .clipShape(.rect(cornerRadius: 16))

            // Text overlay
            VStack(alignment: .leading, spacing: 4) {
                Text("Every moment")
                    .font(DesignTokens.displayFont(size: 22))
                Text("deserves a song.")
                    .font(DesignTokens.displayFont(size: 22))
                Text(recentTracks.isEmpty ? "Create something personal" : "You've created \(recentTracks.count) song\(recentTracks.count == 1 ? "" : "s")")
                    .font(DesignTokens.bodyFont(size: 13))
                    .opacity(0.7)
            }
            .foregroundStyle(.white)
            .padding(16)
        }
        .frame(height: 160)
    }

    // MARK: - Quick Create Section

    private var quickCreateSection: some View {
        goldCTAButton(
            icon: "sparkles",
            label: "Create for someone special",
            hint: "Opens creation menu to make a song or poem",
            action: onCreate
        )
        .padding(.top, 8)
    }

    private func goldCTAButton(icon: String, label: String, hint: String, action: @escaping () -> Void) -> some View {
        Button {
            hapticImpactTrigger.toggle()
            action()
        } label: {
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 20))
                Text(label)
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
            }
            .foregroundStyle(DesignTokens.background)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(
                LinearGradient(
                    colors: [DesignTokens.gold, DesignTokens.gold.opacity(0.85)],
                    startPoint: .leading,
                    endPoint: .trailing
                )
            )
            .clipShape(.rect(cornerRadius: 14))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityHint(hint)
    }

    // MARK: - Occasions Section (Horizontal Chips)

    private var occasionsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Create for an Occasion")
                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                .foregroundStyle(DesignTokens.textPrimary)

            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    ForEach(Occasion.allCases) { occasion in
                        occasionChip(occasion)
                    }
                }
            }
            .scrollIndicators(.hidden)
            .contentMargins(.trailing, 20)
        }
        .padding(.top, 8)
    }

    private func occasionChip(_ occasion: Occasion) -> some View {
        Button {
            hapticLightTrigger.toggle()
            onOccasionSelected(occasion)
        } label: {
            HStack(spacing: 6) {
                Text(occasion.emoji)
                    .font(.system(size: 14))
                Text(occasion.displayName)
                    .font(DesignTokens.bodyFont(size: 14, weight: .medium))
            }
            .foregroundStyle(DesignTokens.textPrimary)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(DesignTokens.surface)
            .clipShape(.rect(cornerRadius: 22))
            .overlay(
                RoundedRectangle(cornerRadius: 22)
                    .stroke(DesignTokens.borderSubtle, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.impact(weight: .light), trigger: hapticLightTrigger)
        .accessibilityLabel(occasion.displayName)
        .accessibilityHint("Double tap to create a \(occasion.displayName.lowercased()) song")
    }

    // MARK: - Get Started Card (New Users)

    private var getStartedCard: some View {
        HStack(spacing: 12) {
            Image(systemName: "sparkles")
                .font(.system(size: 24))
                .foregroundStyle(DesignTokens.gold)

            VStack(alignment: .leading, spacing: 4) {
                Text("Your first song is free")
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    .foregroundStyle(DesignTokens.textPrimary)

                Text("Pick an occasion above to create a personalized song in under 90 seconds")
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundStyle(DesignTokens.textSecondary)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DesignTokens.surface)
        .clipShape(.rect(cornerRadius: 12))
    }

    // MARK: - Recent Songs Section

    private var recentSongsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Recent")
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    .foregroundStyle(DesignTokens.textPrimary)
                Spacer()
                if let onSeeAllSongs {
                    Button {
                        onSeeAllSongs()
                    } label: {
                        Text("See All")
                            .font(DesignTokens.bodyFont(size: 14))
                            .foregroundStyle(DesignTokens.gold)
                    }
                    .buttonStyle(.plain)
                }
            }

            ForEach(recentTracks.prefix(3), id: \.id) { track in
                SongCard(
                    track: track,
                    isPlaying: playerState.currentTrack?.id == track.id && playerState.isPlaying,
                    isLoadingAudio: playerState.isLoading && playerState.currentTrack?.id == track.id,
                    onPlay: { togglePlayback(for: track) },
                    onTap: { }
                )
            }
        }
    }

    // MARK: - Playback
    // TODO: Extract to shared PlaybackService (see PlayerComponents.swift) — near-duplicate of MySongsView.togglePlayback

    private func togglePlayback(for track: Track) {
        if playerState.isLoading { return }

        if playerState.currentTrack?.id == track.id {
            playerState.togglePlayback()
            return
        }

        // Cancel any in-flight audio download to prevent race conditions
        audioLoadTask?.cancel()

        // Load and play — fetch track details for preview URL
        playerState.setLoading(track: track)
        audioLoadTask = Task { @MainActor [trackId = track.id] in
            do {
                try Task.checkCancellation()

                let details = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "explorePlayback") {
                    try await apiClient.getTrack(trackId: trackId)
                }

                try Task.checkCancellation()

                guard let (version, urlString) = details.latestPlayableVersion() else {
                    ToastService.shared.error("Audio is not available for this track yet")
                    playerState.stopPlayback()
                    return
                }

                let transformedUrl = transformAudioUrl(urlString, baseURL: apiClient.baseURL)
                guard let url = URL(string: transformedUrl) else {
                    ToastService.shared.error("Invalid audio URL")
                    playerState.stopPlayback()
                    return
                }

                try Task.checkCancellation()

                let (audioData, response) = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "exploreDownloadAudio") {
                    try await URLSession.shared.data(from: url)
                }

                try Task.checkCancellation()

                guard !Task.isCancelled, playerState.currentTrack?.id == trackId else { return }

                guard let httpResponse = response as? HTTPURLResponse,
                      (200...299).contains(httpResponse.statusCode) else {
                    let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
                    throw NSError(domain: "AudioError", code: statusCode,
                                  userInfo: [NSLocalizedDescriptionKey: "Failed to download audio (HTTP \(statusCode))"])
                }

                try Task.checkCancellation()

                playerState.loadAndPlay(data: audioData, track: track, version: version)
            } catch is CancellationError {
                // Expected when user taps different track — silently ignore
            } catch {
                ToastService.shared.error("Couldn't play this song")
                playerState.stopPlayback()
            }
        }
    }

    // MARK: - Data Loading

    private func loadRecentTracks() {
        guard !isLoadingTracks else { return }
        isLoadingTracks = true

        Task {
            do {
                let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "exploreRecentTracks") {
                    try await apiClient.getTracks()
                }
                await MainActor.run {
                    let sortedTracks = response.tracks.sorted {
                        ($0.libraryAddedAt ?? $0.createdAt) > ($1.libraryAddedAt ?? $1.createdAt)
                    }
                    let receivedTracks = sortedTracks.filter { $0.isReceived }
                    if receivedTracks.isEmpty {
                        recentTracks = sortedTracks.filter { !$0.isReceived }
                    } else {
                        recentTracks = receivedTracks
                    }
                    isLoadingTracks = false

                    // Existing-user migration: if user has tracks, they've already created a song
                    if !hasCompletedFirstSong && !response.tracks.isEmpty {
                        hasCompletedFirstSong = true
                    }
                }
            } catch {
                await MainActor.run {
                    isLoadingTracks = false
                }
            }
        }
    }

    // MARK: - Refresh

    private func refreshContent() async {
        loadRecentTracks()
        try? await Task.sleep(for: .milliseconds(500))
    }
}

#Preview {
    ExploreTabView(
        apiClient: APIClient(baseURL: AppConfig.apiBaseURL),
        playerState: PlayerState(),
        onOccasionSelected: { _ in },
        onCreate: { },
        onSendGift: { },
        showsGiftSendEntry: true
    )
}
