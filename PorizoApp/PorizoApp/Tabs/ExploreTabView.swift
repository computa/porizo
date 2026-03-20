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

    @State private var showFeatureBanner = true
    @State private var recentTracks: [Track] = []
    @State private var isLoadingTracks = false
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
                        // Feature Banner (dismissible)
                        if showFeatureBanner {
                            featureBanner
                                .padding(.bottom, 16)
                        }

                        // Featured Card
                        featuredCard
                            .padding(.bottom, 24)

                        // Quick Create Section
                        quickCreateSection
                            .padding(.bottom, 12)

                        if showsGiftSendEntry {
                            giftSendSection
                                .padding(.bottom, 24)
                        }

                        // Recent Songs (if any)
                        if !recentTracks.isEmpty {
                            recentSongsSection
                                .padding(.bottom, 24)
                        }

                        // Popular Occasions
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

    // MARK: - Feature Banner

    private var featureBanner: some View {
        HStack(spacing: 8) {
            Image(systemName: "arrow.triangle.2.circlepath")
                .font(.system(size: 16))
                .foregroundStyle(DesignTokens.gold)

            Text("Introducing Remixing")
                .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                .foregroundStyle(DesignTokens.textPrimary)

            Text("NEW")
                .font(DesignTokens.bodyFont(size: 10, weight: .semibold))
                .foregroundStyle(DesignTokens.background)
                .padding(.horizontal, 8)
                .padding(.vertical, 2)
                .background(DesignTokens.gold)
                .clipShape(.rect(cornerRadius: 4))

            Spacer()

            Button {
                withAnimation(.easeOut(duration: 0.2)) {
                    showFeatureBanner = false
                }
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 16))
                    .foregroundStyle(DesignTokens.textTertiary)
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("Dismiss banner")
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 8)
        .background(DesignTokens.surfaceMuted)
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
                Text("Create something personal")
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
        VStack(alignment: .leading, spacing: 12) {
            Button {
                hapticImpactTrigger.toggle()
                onCreate()
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 20))

                    Text("Express yourself, for them")
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
            .accessibilityLabel("Express yourself, for them")
            .accessibilityHint("Opens creation menu to make a song or poem")
        }
        .padding(.top, 8)
    }

    private var giftSendSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button {
                hapticImpactTrigger.toggle()
                onSendGift()
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "gift.fill")
                        .font(.system(size: 20))

                    Text("Schedule and send, for them")
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
            .accessibilityLabel("Schedule and send, for them")
            .accessibilityHint("Open gift flow to schedule a song or poem")
        }
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

        // Load and play — fetch track details for preview URL
        playerState.setLoading(track: track)
        Task {
            do {
                let details = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "explorePlayback") {
                    try await apiClient.getTrack(trackId: track.id)
                }

                guard let version = details.versions.first,
                      let urlString = version.previewUrl else {
                    await MainActor.run { playerState.stopPlayback() }
                    return
                }

                let transformedUrl = transformAudioUrl(urlString, baseURL: apiClient.baseURL)
                guard let url = URL(string: transformedUrl) else {
                    await MainActor.run { playerState.stopPlayback() }
                    return
                }

                let (audioData, response) = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "exploreDownloadAudio") {
                    try await URLSession.shared.data(from: url)
                }

                guard let httpResponse = response as? HTTPURLResponse,
                      (200...299).contains(httpResponse.statusCode) else {
                    await MainActor.run { playerState.stopPlayback() }
                    return
                }

                guard playerState.currentTrack?.id == track.id else { return }

                await MainActor.run {
                    playerState.loadAndPlay(data: audioData, track: track, version: version)
                }
            } catch {
                await MainActor.run { playerState.stopPlayback() }
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
