//
//  MainTabView.swift
//  PorizoApp
//
//  Main tab bar matching v1.pen Velvet & Gold design system.
//  4-tab layout: Home, Songs, Poems, Profile
//  Create flows triggered from individual screens via FAB or headers.
//
//  Tab views and flows are extracted to separate files:
//  - Tabs/SongsTabView.swift
//  - Tabs/PoemsTabView.swift
//  - Tabs/ExploreTabView.swift (Home content)
//  - Tabs/SettingsTabView.swift (Profile)
//  - Flows/WarmCanvasFlowView.swift
//

import SwiftUI

// DesignTokens and Color(hex:) extension are in DesignTokens.swift

struct MainTabView: View {
    let apiClient: APIClient
    var pendingRecipientName: String? = nil
    var pendingOccasion: Occasion? = nil
    var pendingType: CreateFlowKind? = nil
    var onConsumePendingCreateContext: (() -> Void)? = nil

    @State private var selectedTab: Tab = {
        // Debug: allow setting initial tab via launch argument
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if args.contains("--tab-songs") { return .songs }
        if args.contains("--tab-poems") { return .poems }
        if args.contains("--tab-profile") { return .profile }
        #endif
        return .home
    }()
    @State private var createFlowLaunch: CreateFlowLaunch?
    @State private var showGiftFlow = false
    // Upgrade gating lives inside WarmCanvasFlowView

    // Global player state (shared across all tabs)
    @State private var playerState = PlayerState()
    @State private var showNowPlaying = false
    @State private var hasConsumedPendingCreateContext = false

    // Track list refresh trigger - incremented when new track created
    @State private var trackListRefreshTrigger = 0

    // StoreKit manager for subscriptions
    @State private var storeKitManager: StoreKitManager

    init(
        apiClient: APIClient,
        pendingRecipientName: String? = nil,
        pendingOccasion: Occasion? = nil,
        pendingType: CreateFlowKind? = nil,
        onConsumePendingCreateContext: (() -> Void)? = nil
    ) {
        self.apiClient = apiClient
        self.pendingRecipientName = pendingRecipientName
        self.pendingOccasion = pendingOccasion
        self.pendingType = pendingType
        self.onConsumePendingCreateContext = onConsumePendingCreateContext
        self._storeKitManager = State(wrappedValue: StoreKitManager(apiClient: apiClient))
    }

    // MARK: - Tab Definition (v1.pen: 4 tabs)

    enum Tab: Int, CaseIterable {
        case home = 0
        case songs = 1
        case poems = 2
        case profile = 3

        var title: String {
            switch self {
            case .home: return "Home"
            case .songs: return "Songs"
            case .poems: return "Poems"
            case .profile: return "Settings"
            }
        }

        var icon: String {
            switch self {
            case .home: return "house"
            case .songs: return "music.note"
            case .poems: return "scroll"
            case .profile: return "gearshape"
            }
        }
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            // Background: Deep velvet black
            DesignTokens.background.ignoresSafeArea()

            // Content area (manual switching - no TabView to avoid black bar bug)
            Group {
                switch selectedTab {
                case .home:
                    ExploreTabView(
                        apiClient: apiClient,
                        playerState: playerState,
                        onOccasionSelected: { occasion in
                            presentCreateFlow(preselectedOccasion: occasion)
                        },
                        onCreate: {
                            presentCreateFlow()  // No preselectedType - goes to type selection
                        },
                        onSendGift: {
                            guard AppConfig.enableGiftPurchaseUI else { return }
                            showGiftFlow = true
                        },
                        showsGiftSendEntry: AppConfig.enableGiftPurchaseUI,
                        onSeeAllSongs: {
                            selectedTab = .songs
                        }
                    )
                case .songs:
                    SongsTabView(
                        apiClient: apiClient,
                        playerState: playerState,
                        refreshTrigger: trackListRefreshTrigger,
                        onCreateNew: {
                            presentCreateFlow()
                        },
                        onDraftSelected: { trackId, versionNum in
                            presentCreateFlow(resumeTrackId: trackId, resumeVersionNum: versionNum)
                        },
                        onResumeSelected: { trackId, versionNum, resumeTarget in
                            presentCreateFlow(
                                resumeTrackId: trackId,
                                resumeVersionNum: versionNum,
                                resumeTarget: resumeTarget
                            )
                        }
                    )
                case .poems:
                    PoemsTabView(
                        apiClient: apiClient,
                        onCreatePoem: { startCreateFlow(variationFrom: nil, forceType: .poem) },
                        onCreateVariation: { poem in startCreateFlow(variationFrom: poem, forceType: .poem) },
                        playerState: playerState
                    )
                case .profile:
                    SettingsTabView(apiClient: apiClient, storeKit: storeKitManager)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(DesignTokens.background)

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

            // Custom Tab Bar (v1.pen: height 83, gold accents)
            customTabBar
        }
        .background(DesignTokens.background)
        .ignoresSafeArea(edges: .bottom)
        .fullScreenCover(item: $createFlowLaunch) { launch in
            WarmCanvasFlowView(
                apiClient: apiClient,
                storeKit: storeKitManager,
                initialRecipientName: launch.initialRecipientName,
                preselectedOccasion: launch.preselectedOccasion,
                preselectedType: launch.preselectedType,
                resumeTrackId: launch.resumeTrackId,
                resumeVersionNum: launch.resumeVersionNum,
                resumeTarget: launch.resumeTarget,
                variationSourcePoem: launch.variationSourcePoem,
                onPoemComplete: { poem in
                    handlePoemFlowCompletion(poem: poem)
                },
                onComplete: { trackId, versionNum in
                    handleSongFlowCompletion(trackId: trackId, versionNum: versionNum)
                },
                onCancel: {
                    createFlowLaunch = nil
                }
            )
        }
        .fullScreenCover(
            isPresented: Binding(
                get: { AppConfig.enableGiftPurchaseUI && showGiftFlow },
                set: { showGiftFlow = $0 }
            )
        ) {
            GiftSendFlowView(
                apiClient: apiClient,
                storeKit: storeKitManager,
                onComplete: { showGiftFlow = false },
                onCancel: { showGiftFlow = false }
            )
        }
        .fullScreenCover(isPresented: $showNowPlaying) {
            NowPlayingView(
                playerState: playerState,
                onDismiss: { showNowPlaying = false },
                onPlayPause: { playerState.togglePlayback() },
                onSeek: { time in playerState.seekTo(time: time) },
                onShare: {
                    guard let track = playerState.currentTrack else { return }
                    let text = "Listen to \"\(track.title)\" on Porizo\nhttps://apps.apple.com/app/porizo/id6741440378"
                    let activityVC = UIActivityViewController(activityItems: [text], applicationActivities: nil)
                    guard let scene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene,
                          let rootVC = scene.windows.first?.rootViewController else { return }
                    rootVC.present(activityVC, animated: true)
                }
            )
        }
        // Paywall sheet removed — entitlement check is inside WarmCanvasFlowView
        .task {
            playerState.setupInterruptionHandling()
            await storeKitManager.initializeAsync()
            consumePendingCreateContextIfNeeded()

            #if DEBUG
            // Fixture launch args — detected inside WarmCanvasFlowView.initializeFlow()
            let args = ProcessInfo.processInfo.arguments
            if createFlowLaunch == nil,
               args.contains("--fixture-reveal") ||
               args.contains("--fixture-reveal-ready") ||
               args.contains("--fixture-creating") {
                try? await Task.sleep(for: .seconds(0.5))
                presentCreateFlow()
            }
            #endif
        }
    }

    // MARK: - Custom Tab Bar (v1.pen design)

    private var customTabBar: some View {
        VStack(spacing: 0) {
            // Top border: 1px #1A1A1A
            Rectangle()
                .fill(DesignTokens.surfaceMuted)
                .frame(height: 1)

            // Tab bar content
            HStack(spacing: 0) {
                ForEach(Tab.allCases, id: \.rawValue) { tab in
                    tabButton(for: tab)
                }
            }
            .padding(.top, 12)
            .padding(.bottom, 34) // Safe area + padding (total height ~83)
        }
        .background(
            DesignTokens.background
                .ignoresSafeArea()
        )
    }

    private func tabButton(for tab: Tab) -> some View {
        Button {
            withAnimation(.easeInOut(duration: 0.15)) {
                selectedTab = tab
            }
        } label: {
            VStack(spacing: 4) {
                Image(systemName: tab.icon)
                    .font(.system(size: 24)) // v1.pen: 24x24 icons
                    .scaleEffect(selectedTab == tab ? 1.0 : 0.9)
                Text(tab.title)
                    .font(DesignTokens.bodyFont(size: 10)) // v1.pen: Inter 10pt
            }
            .foregroundStyle(selectedTab == tab ? DesignTokens.gold : DesignTokens.textTertiary)
            .frame(maxWidth: .infinity)
            .animation(.easeInOut(duration: 0.15), value: selectedTab)
        }
        .accessibilityLabel(tab.title)
        .accessibilityHint(selectedTab == tab ? "Currently selected" : "Double tap to switch to \(tab.title)")
        .accessibilityAddTraits(selectedTab == tab ? .isSelected : [])
    }

    /// Resets state and shows the create flow, optionally with a source poem for variation
    private func startCreateFlow(
        variationFrom poem: Poem?,
        forceType: CreateFlowKind?
    ) {
        presentCreateFlow(preselectedType: forceType, variationFrom: poem)
    }

    private func presentCreateFlow(
        initialRecipientName: String? = nil,
        preselectedOccasion: Occasion? = nil,
        preselectedType: CreateFlowKind? = nil,
        resumeTrackId: String? = nil,
        resumeVersionNum: Int? = nil,
        resumeTarget: CreateFlowResumeTarget? = nil,
        variationFrom poem: Poem? = nil
    ) {
        let launch = CreateFlowLaunch(
            initialRecipientName: initialRecipientName,
            preselectedOccasion: preselectedOccasion,
            preselectedType: preselectedType,
            resumeTrackId: resumeTrackId,
            resumeVersionNum: resumeVersionNum,
            resumeTarget: resumeTarget,
            variationSourcePoem: poem
        )

        // Entitlement check happens inside WarmCanvasFlowView (server-side, authoritative).
        // No client-side gate here — avoids race condition when StoreKit and server are out of sync.
        createFlowLaunch = launch
    }

    private func consumePendingCreateContextIfNeeded() {
        guard !hasConsumedPendingCreateContext else { return }
        guard createFlowLaunch == nil else { return }

        let recipient = pendingRecipientName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !recipient.isEmpty else { return }

        hasConsumedPendingCreateContext = true
        onConsumePendingCreateContext?()
        presentCreateFlow(
            initialRecipientName: recipient,
            preselectedOccasion: pendingOccasion,
            preselectedType: pendingType
        )
    }

    private func handleSongFlowCompletion(trackId: String, versionNum: Int) {
        createFlowLaunch = nil
        LocalCache.shared.invalidateTracks()
        trackListRefreshTrigger += 1
        NotificationCenter.default.post(
            name: .trackRenderCompleted,
            object: nil,
            userInfo: [
                "trackId": trackId,
                "versionNum": versionNum,
            ]
        )
        selectedTab = .songs
    }

    private func handlePoemFlowCompletion(poem: Poem) {
        createFlowLaunch = nil
        LocalCache.shared.invalidatePoems()
        NotificationCenter.default.post(
            name: .poemLibraryDidChange,
            object: nil,
            userInfo: [
                "poemId": poem.id,
            ]
        )
        selectedTab = .poems
    }

}

#Preview {
    MainTabView(apiClient: APIClient(baseURL: AppConfig.apiBaseURL))
}
