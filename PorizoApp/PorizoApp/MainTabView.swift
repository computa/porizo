//
//  MainTabView.swift
//  PorizoApp
//
//  Main tab bar shell with prominent center Create button.
//  Light mode with rose accent - conveying love and friendship.
//
//  Tab views and flows are extracted to separate files:
//  - Tabs/SongsTabView.swift
//  - Tabs/PoemsTabView.swift
//  - Tabs/ExploreTabView.swift
//  - Tabs/SettingsTabView.swift
//  - Flows/CreateFlowView.swift
//

import SwiftUI

// DesignTokens and Color(hex:) extension are in DesignTokens.swift

struct MainTabView: View {
    let apiClient: APIClient

    @State private var selectedTab: Tab = .songs
    @State private var showCreateFlow = false
    @State private var preselectedOccasion: Occasion?

    // Track creation state (passed to create flow)
    @State private var currentTrackId: String?
    @State private var currentVersionNum: Int?

    // Poem variation state - when set, CreateFlow pre-populates with this poem's context
    @State private var variationSourcePoem: Poem?

    // Global player state (shared across all tabs)
    @StateObject private var playerState = PlayerState()
    @State private var showNowPlaying = false

    // Track list refresh trigger - incremented when new track created
    @State private var trackListRefreshTrigger = 0

    // StoreKit manager for subscriptions
    @StateObject private var storeKitManager: StoreKitManager

    init(apiClient: APIClient) {
        self.apiClient = apiClient
        self._storeKitManager = StateObject(wrappedValue: StoreKitManager(apiClient: apiClient))
    }

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
            DesignTokens.backgroundSubtle.ignoresSafeArea()

            // Content area (manual switching - no TabView to avoid black bar bug)
            Group {
                switch selectedTab {
                case .songs:
                    SongsTabView(
                        apiClient: apiClient,
                        playerState: playerState,
                        refreshTrigger: trackListRefreshTrigger,
                        onCreateNew: {
                            currentTrackId = nil
                            currentVersionNum = nil
                            preselectedOccasion = nil
                            showCreateFlow = true
                        },
                        onDraftSelected: { trackId, versionNum in
                            currentTrackId = trackId
                            currentVersionNum = versionNum
                            showCreateFlow = true
                        }
                    )
                case .poems:
                    PoemsTabView(
                        apiClient: apiClient,
                        onCreatePoem: { startCreateFlow(variationFrom: nil) },
                        onCreateVariation: { poem in startCreateFlow(variationFrom: poem) }
                    )
                case .create:
                    Color.clear // Placeholder - Create is a modal
                case .explore:
                    ExploreTabView(
                        apiClient: apiClient,
                        onOccasionSelected: { occasion in
                            preselectedOccasion = occasion
                            showCreateFlow = true
                        }
                    )
                case .settings:
                    SettingsTabView(apiClient: apiClient, storeKit: storeKitManager)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(DesignTokens.backgroundSubtle)

            // Mini Player Bar (shown only when playing)
            if playerState.currentTrack != nil {
                MiniPlayerBar(
                    playerState: playerState,
                    onTap: { showNowPlaying = true },
                    onPlayPause: { playerState.togglePlayback() },
                    onClose: { playerState.stopPlayback() }
                )
                .padding(.bottom, 100) // Good clearance above tab bar
            }

            // Custom Tab Bar
            customTabBar
        }
        .background(DesignTokens.backgroundSubtle)
        .ignoresSafeArea(edges: .bottom)
        .fullScreenCover(isPresented: $showCreateFlow) {
            CreateFlowView(
                apiClient: apiClient,
                preselectedOccasion: preselectedOccasion,
                resumeTrackId: currentTrackId,
                resumeVersionNum: currentVersionNum,
                variationSourcePoem: variationSourcePoem,
                onComplete: { trackId, versionNum in
                    currentTrackId = trackId
                    currentVersionNum = versionNum
                    showCreateFlow = false
                    preselectedOccasion = nil
                    variationSourcePoem = nil
                    trackListRefreshTrigger += 1  // Force MySongsView to refresh
                    selectedTab = .songs
                },
                onCancel: {
                    showCreateFlow = false
                    preselectedOccasion = nil
                    variationSourcePoem = nil
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
        .fullScreenCover(isPresented: $showNowPlaying) {
            NowPlayingView(
                playerState: playerState,
                onDismiss: { showNowPlaying = false },
                onPlayPause: { playerState.togglePlayback() },
                onSeek: { time in playerState.seekTo(time: time) }
            )
        }
        .onAppear {
            // Lazy load StoreKit products and subscription state
            // This runs AFTER the UI is visible, not during init
            Task {
                await storeKitManager.initializeAsync()
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
                    .fontWeight(selectedTab == tab ? .semibold : .regular)
            }
            .foregroundColor(selectedTab == tab ? DesignTokens.rose : DesignTokens.textSecondary)
            .frame(maxWidth: .infinity)
        }
        .accessibilityLabel(tab.title)
        .accessibilityHint(selectedTab == tab ? "Currently selected" : "Double tap to switch to \(tab.title)")
        .accessibilityAddTraits(selectedTab == tab ? .isSelected : [])
    }

    /// Resets state and shows the create flow, optionally with a source poem for variation
    private func startCreateFlow(variationFrom poem: Poem?) {
        currentTrackId = nil
        currentVersionNum = nil
        preselectedOccasion = nil
        variationSourcePoem = poem
        showCreateFlow = true
    }

    private var createButton: some View {
        Button {
            startCreateFlow(variationFrom: nil)
        } label: {
            ZStack {
                // Solid rose circle (no gradient per design guide)
                Circle()
                    .fill(DesignTokens.rose)
                    .frame(width: 56, height: 56)
                    .accentShadow()

                Image(systemName: "plus")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundColor(.white)
                    .accessibilityHidden(true)
            }
            .offset(y: -16) // Raise above tab bar
        }
        .frame(maxWidth: .infinity)
        .accessibilityLabel("Create new song")
        .accessibilityHint("Double tap to start creating a new song")
    }
}

#Preview {
    MainTabView(apiClient: APIClient(baseURL: AppConfig.apiBaseURL))
}
