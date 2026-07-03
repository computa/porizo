import SwiftUI

// PorizoAndroidTheme is now a thin alias layer over the canonical DesignTokens (UF1).
// Its former values were hand-approximated and hue-wrong (gold read as mustard ~#C79438
// instead of the real Warm Canvas coral #E07850); aliasing corrects the whole app in one move.
// Radius aliases map the old 10/14/18 scale onto the iOS scale (12/14/16) for parity.
enum PorizoAndroidTheme {
    static let background = DesignTokens.background
    static let surface = DesignTokens.surface
    static let surfaceElevated = DesignTokens.surfaceElevated
    static let textPrimary = DesignTokens.textPrimary
    static let textSecondary = DesignTokens.textSecondary
    static let textTertiary = DesignTokens.textTertiary
    static let gold = DesignTokens.gold
    static let goldDark = DesignTokens.goldDark
    static let border = DesignTokens.border
    static let accentBlue = DesignTokens.statusInfo

    static let radiusSmall: CGFloat = DesignTokens.radiusMedium   // 10 -> 12
    static let radiusMedium: CGFloat = DesignTokens.radiusCTA     // 14 -> 14
    static let radiusLarge: CGFloat = DesignTokens.radiusLarge    // 18 -> 16
}

enum ContentTab: String, Hashable, CaseIterable, Identifiable {
    // Mirrors iOS MainTabView: 4 tabs (Home / Songs / Poems / Settings).
    // Claim is NOT a tab on iOS — it is a deep-link-triggered sheet (see U12);
    // the old `.recipient` "Claim" tab was a sarah-birthday demo fixture, removed here.
    case home, songs, poems, settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .home: return "Home"
        case .songs: return "Songs"
        case .poems: return "Poems"
        case .settings: return "Settings"
        }
    }

    var symbol: String {
        switch self {
        case .home: return "house"
        case .songs: return "play.fill"
        case .poems: return "pencil"
        case .settings: return "gearshape"
        }
    }
}

enum AndroidCreateMode: String, CaseIterable, Identifiable {
    case simple = "Simple"
    case custom = "Custom"

    var id: String { rawValue }
}

struct ContentView: View {
    @AppStorage("tab") var tab = ContentTab.home
    @AppStorage("appearance") var appearance = ""
    // Preserved for U12 (deep-link claim sheet). Claim is no longer a tab; a pending
    // claim route is captured here and will drive a sheet once U12 lands.
    @State var pendingClaimRoute: AndroidDeepLinkRoute?
    @State var poemRouteId: String?
    // Shared, app-wide playback (U3). Injected once; the mini-player persists
    // across tabs and NowPlaying reflects the same state (mirrors iOS PlayerState).
    // Not `private` — Skip Fuse cannot bridge private @State on a bridged View.
    @State var player = AndroidPlayerModel(
        accessTokenProvider: { AndroidSessionStore().loadAuthSession()?.accessToken }
    )
    @State var showsNowPlaying = false

    var body: some View {
        VStack(spacing: 0) {
            currentTabView
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .environment(player)

            MiniPlayerBar(player: player) { showsNowPlaying = true }

            AndroidBottomTabBar(selection: $tab)
        }
        .background(PorizoAndroidTheme.background)
        .preferredColorScheme(appearance == "dark" ? .dark : appearance == "light" ? .light : nil)
        .task {
            consumePendingDeepLink()
        }
        .sheet(isPresented: $showsNowPlaying) {
            NowPlayingView(player: player) { showsNowPlaying = false }
        }
    }

    @ViewBuilder
    private var currentTabView: some View {
        switch tab {
        case .home:
            NavigationStack {
                AndroidExploreView()
            }
        case .songs:
            NavigationStack {
                SongsView()
            }
        case .poems:
            NavigationStack {
                PoemsView(deepLinkedPoemId: poemRouteId)
            }
        case .settings:
            NavigationStack {
                SettingsView(appearance: $appearance)
            }
        }
    }

    private func consumePendingDeepLink() {
        guard let route = AndroidDeepLinkStore().consume() else {
            return
        }
        switch route {
        case .share, .receiverHandoff, .unknown:
            // Claim is deep-link-only (no tab). Capture the route; U12 will present
            // it as a claim sheet. Until then this is inert (no crash, no lost link).
            pendingClaimRoute = route
        case .poem(let poemId):
            poemRouteId = poemId
            tab = .poems
        }
    }
}

struct AndroidBottomTabBar: View {
    @Binding var selection: ContentTab

    var body: some View {
        HStack(spacing: 0) {
            ForEach(ContentTab.allCases) { tab in
                Button {
                    selection = tab
                } label: {
                    VStack(spacing: 5) {
                        Image(systemName: tab.symbol)
                            .font(.system(size: 22, weight: .semibold))
                            .frame(width: 50, height: 34)
                            .background(selection == tab ? PorizoAndroidTheme.gold.opacity(0.18) : Color.clear)
                            .clipShape(Capsule())
                        Text(tab.title)
                            .font(.system(size: 12, weight: .semibold))
                    }
                    .foregroundStyle(selection == tab ? PorizoAndroidTheme.goldDark : PorizoAndroidTheme.textPrimary)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 10)
                    .padding(.bottom, 11)
                }
                .buttonStyle(.plain)
            }
        }
        .background(PorizoAndroidTheme.surface)
        .overlay(
            Rectangle()
                .fill(PorizoAndroidTheme.border.opacity(0.65))
                .frame(height: 1),
            alignment: .top
        )
    }
}

struct AndroidExploreView: View {
    @State var showsCreateFlow = false
    @State var createOccasion = Occasion.birthday

    var body: some View {
        if showsCreateFlow {
            CreateSongView(initialOccasion: createOccasion) {
                showsCreateFlow = false
            }
        } else {
            exploreContent
        }
    }

    private var exploreContent: some View {
        ZStack {
            PorizoAndroidTheme.background.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 6) {
                        FrauncesTitle(text: "Explore", size: 34, weight: .bold)
                        Text("Make something personal, then send it as an app-only gift.")
                            .font(.system(size: 15))
                            .foregroundStyle(PorizoAndroidTheme.textSecondary)
                    }
                    .padding(.top, 18)

                    FeaturedSongCard()

                    Button {
                        startCreate()
                    } label: {
                        VStack(spacing: 4) {
                            Text("Create for someone special")
                                .font(.system(size: 17, weight: .semibold))
                            Text("A guided song draft in about 90 seconds")
                                .font(.system(size: 13))
                                .opacity(0.82)
                        }
                        .foregroundStyle(Color.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(PorizoAndroidTheme.gold)
                        .clipShape(RoundedRectangle(cornerRadius: PorizoAndroidTheme.radiusMedium))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Create for someone special")

                    Button {
                        // TODO(U15): open the gift send flow (iOS routes this card to
                        // GiftSendFlowView, not claim). Inert until U15 lands.
                    } label: {
                        HStack(spacing: 12) {
                            Circle()
                                .fill(PorizoAndroidTheme.gold.opacity(0.18))
                                .frame(width: 36, height: 36)
                                .overlay(
                                    Text("G")
                                        .font(.system(size: 15, weight: .bold))
                                        .foregroundStyle(PorizoAndroidTheme.goldDark)
                                )
                            VStack(alignment: .leading, spacing: 3) {
                                Text("Schedule and send, for them")
                                    .font(.system(size: 16, weight: .semibold))
                                Text("Share-once links, app claim, protected playback")
                                    .font(.system(size: 12))
                                    .foregroundStyle(PorizoAndroidTheme.textSecondary)
                            }
                            Spacer()
                            Text("Open")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(PorizoAndroidTheme.goldDark)
                        }
                        .foregroundStyle(PorizoAndroidTheme.textPrimary)
                        .padding(16)
                        .background(PorizoAndroidTheme.surface)
                        .clipShape(RoundedRectangle(cornerRadius: PorizoAndroidTheme.radiusMedium))
                    }
                    .buttonStyle(.plain)

                    VStack(alignment: .leading, spacing: 12) {
                        Text("Create for an occasion")
                            .font(.system(size: 19, weight: .bold))
                            .foregroundStyle(PorizoAndroidTheme.textPrimary)

                        ScrollView(.horizontal) {
                            HStack(spacing: 8) {
                                ForEach(Occasion.allCases) { occasion in
                                    Button {
                                        startCreate(occasion)
                                    } label: {
                                        Text(occasion.label)
                                            .font(.system(size: 14, weight: .medium))
                                            .foregroundStyle(PorizoAndroidTheme.textPrimary)
                                            .padding(.horizontal, 14)
                                            .padding(.vertical, 8)
                                            .background(PorizoAndroidTheme.surface)
                                            .clipShape(Capsule())
                                            .overlay(
                                                Capsule()
                                                    .stroke(PorizoAndroidTheme.border, lineWidth: 1)
                                            )
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(.vertical, 2)
                        }
                    }

                    PorizoInfoCard(
                        title: "Start with a real memory",
                        detail: "Names, private phrases, voice, and app-only saving stay part of the same creation contract.",
                        marker: "1"
                    )

                    PorizoInfoCard(
                        title: "Nothing saved until they claim",
                        detail: "Recipients get a protected preview first. Full saving stays bound to the claimed app device.",
                        marker: "2"
                    )
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 28)
            }
        }
        .navigationBarTitleDisplayMode(.inline)
    }

    private func startCreate(_ occasion: Occasion? = nil) {
        createOccasion = occasion ?? .birthday
        showsCreateFlow = true
    }
}

struct FeaturedSongCard: View {
    var body: some View {
        // Gradient is a .background of the content (not a sibling ZStack layer): the content's
        // padded intrinsic height drives the card size, so the display-font title can wrap without
        // clipping (old fixed frame(height:154)) or overlapping the subtitle (bottom-aligned ZStack).
        HStack(alignment: .bottom) {
            VStack(alignment: .leading, spacing: 6) {
                FrauncesTitle(text: "Every moment deserves a song", size: 22, weight: .bold, color: .onAccent)
                    .fixedSize(horizontal: false, vertical: true)
                Text("Create from a memory, a voice, and one clear feeling.")
                    .font(.system(size: 14))
                    .foregroundStyle(Color.white.opacity(0.86))
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            StaticBarsView()
                .frame(width: 78, height: 56)
        }
        .padding(20)
        .frame(maxWidth: .infinity, minHeight: 154, alignment: .bottomLeading)
        .background(
            LinearGradient(
                colors: [PorizoAndroidTheme.gold, PorizoAndroidTheme.goldDark],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: PorizoAndroidTheme.radiusLarge))
    }
}

struct StaticBarsView: View {
    private let heights: [CGFloat] = [18, 30, 44, 28, 52, 36, 22]

    var body: some View {
        HStack(alignment: .bottom, spacing: 5) {
            ForEach(heights.indices, id: \.self) { index in
                RoundedRectangle(cornerRadius: 3)
                    .fill(Color.white.opacity(0.34))
                    .frame(width: 6, height: heights[index])
            }
        }
    }
}

struct PorizoInfoCard: View {
    let title: String
    let detail: String
    let marker: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Circle()
                .fill(PorizoAndroidTheme.gold.opacity(0.2))
                .frame(width: 34, height: 34)
                .overlay(
                    Text(marker)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(PorizoAndroidTheme.goldDark)
                )
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(PorizoAndroidTheme.textPrimary)
                Text(detail)
                    .font(.system(size: 13))
                    .foregroundStyle(PorizoAndroidTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(16)
        .background(PorizoAndroidTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: PorizoAndroidTheme.radiusMedium))
    }
}

struct SongsView: View {
    @State var songs: [PorizoTrackSummary] = []
    @State var statusText = "Sign in to load songs from Porizo."
    @State var isLoading = false
    private let apiClient = AndroidAPIClient()

    var body: some View {
        ZStack {
            PorizoAndroidTheme.background.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    PorizoScreenHeader(
                        title: "Songs",
                        subtitle: "Your claimed and created songs stay app-bound, with protected playback controlled by the backend."
                    )

                    PorizoSectionCard(title: "Library") {
                        VStack(alignment: .leading, spacing: 12) {
                            PorizoActionButton(
                                title: isLoading ? "Loading songs..." : "Load songs",
                                symbol: "arrow.clockwise.circle",
                                isDisabled: isLoading
                            ) {
                                Task { await loadSongs() }
                            }

                            PorizoStatusText(text: statusText)
                        }
                    }

                    PorizoSectionCard(title: "Songs") {
                        if songs.isEmpty {
                            PorizoEmptyStateCard(
                                symbol: "play.fill",
                                title: "No songs loaded",
                                detail: "Sign in, load your library, or create a song from Explore."
                            )
                        } else {
                            VStack(spacing: 10) {
                                ForEach(songs) { song in
                                    SongSummaryCard(song: song)
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 18)
                .padding(.bottom, 28)
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func loadSongs() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let response = try await apiClient.getTracks()
            songs = response.tracks
            statusText = response.tracks.isEmpty ? "No songs yet." : "Loaded \(response.tracks.count) songs."
        } catch {
            statusText = String(describing: error)
        }
    }
}

struct PoemsView: View {
    let deepLinkedPoemId: String?
    @State var poems: [PorizoPoemSummary] = []
    @State var statusText = "Sign in to load poems from Porizo."
    @State var isLoading = false
    private let apiClient = AndroidAPIClient()

    var body: some View {
        ZStack {
            PorizoAndroidTheme.background.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    PorizoScreenHeader(
                        title: "Poems",
                        subtitle: "Short personal pieces use the same recipient contract, claim rules, and app-only save model."
                    )

                    PorizoSectionCard(title: "Library") {
                        VStack(alignment: .leading, spacing: 12) {
                            PorizoActionButton(
                                title: isLoading ? "Loading poems..." : "Load poems",
                                symbol: "arrow.clockwise.circle",
                                isDisabled: isLoading
                            ) {
                                Task { await loadPoems() }
                            }

                            PorizoStatusText(text: statusText)
                        }
                    }

                    PorizoSectionCard(title: "Poems") {
                        if poems.isEmpty {
                            PorizoEmptyStateCard(
                                symbol: "pencil",
                                title: "No poems loaded",
                                detail: "Open a poem link or sign in to refresh your poem library."
                            )
                        } else {
                            VStack(spacing: 10) {
                                ForEach(poems) { poem in
                                    PoemSummaryCard(poem: poem)
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 18)
                .padding(.bottom, 28)
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: deepLinkedPoemId ?? "") {
            if let deepLinkedPoemId, !deepLinkedPoemId.isEmpty {
                statusText = "Opened poem link \(deepLinkedPoemId). Sign in to load the poem library."
            }
        }
    }

    private func loadPoems() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let response = try await apiClient.getPoems()
            poems = response.poems
            statusText = response.poems.isEmpty ? "No poems yet." : "Loaded \(response.poems.count) poems."
        } catch {
            statusText = String(describing: error)
        }
    }
}

struct CreateSongView: View {
    let onClose: (() -> Void)?
    @State var recipientName = "Sarah"
    @State var occasion = Occasion.birthday
    @State var voiceSource = VoiceSource.creatorVoice
    @State var tone = "Warm, specific, grateful"
    @State var message = "You always make everyone feel seen. I want the chorus to say her name clearly and make the gift feel private."
    @State var targetDuration = 60.0
    @State var includeNameHook = true
    @State var appOnlySave = true
    @State var trackId = ""
    @State var versionNum = 0
    @State var jobId = ""
    @State var createStatus = "Draft is local until you create the song."
    @State var renderStatus = "No render started."
    @State var automaticPollingEnabled = true
    @State var pollAttempts = 0
    @State var isWorking = false
    @State var selectedMode = AndroidCreateMode.simple
    @State var showDeveloperTools = false
    private let apiClient = AndroidAPIClient()
    private let draftStore = AndroidCreateDraftStore()
    private let renderStore = AndroidRenderPollStore()

    init(initialOccasion: Occasion = .birthday, onClose: (() -> Void)? = nil) {
        self.onClose = onClose
        _occasion = State(initialValue: initialOccasion)
    }

    var body: some View {
        ZStack {
            PorizoAndroidTheme.background.ignoresSafeArea()

            VStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        createHeader
                        createModeToggle
                        createStatusCard

                        if selectedMode == .simple {
                            simpleCreateContent
                        } else {
                            customCreateContent
                        }

                        #if DEBUG
                        developerToolsCard
                        #endif
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 12)
                    .padding(.bottom, 22)
                }

                createBottomBar
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            loadLocalRecoveryState()
        }
    }

    private var createHeader: some View {
        VStack(alignment: .leading, spacing: 7) {
            if let onClose {
                Button {
                    onClose()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "arrow.left")
                            .font(.system(size: 15, weight: .semibold))
                        Text("Back")
                            .font(.system(size: 15, weight: .semibold))
                    }
                    .foregroundStyle(PorizoAndroidTheme.goldDark)
                    .padding(.vertical, 6)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Back to Explore")
            }

            FrauncesTitle(text: "Create", size: 34, weight: .bold)
            Text("Turn one private memory into a song they can preview, claim, and save in the app.")
                .font(.system(size: 15))
                .foregroundStyle(PorizoAndroidTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var createModeToggle: some View {
        HStack(spacing: 6) {
            ForEach(AndroidCreateMode.allCases) { mode in
                Button {
                    selectedMode = mode
                } label: {
                    Text(mode.rawValue)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(selectedMode == mode ? Color.white : PorizoAndroidTheme.textSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(selectedMode == mode ? PorizoAndroidTheme.gold : Color.clear)
                        .clipShape(RoundedRectangle(cornerRadius: PorizoAndroidTheme.radiusSmall))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(4)
        .background(PorizoAndroidTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: PorizoAndroidTheme.radiusMedium))
        .overlay(
            RoundedRectangle(cornerRadius: PorizoAndroidTheme.radiusMedium)
                .stroke(PorizoAndroidTheme.border, lineWidth: 1)
        )
    }

    private var createStatusCard: some View {
        PorizoSectionCard(title: "Create tokens") {
            VStack(alignment: .leading, spacing: 12) {
                FlowLayoutPills(items: ["name hook", "inside joke", "clear chorus", "app-only save", "preview first"])
                Text(createStatus)
                    .font(.system(size: 13))
                    .foregroundStyle(PorizoAndroidTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var simpleCreateContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            recipientCard
            messageCard
            musicAndVoiceCard
        }
    }

    private var customCreateContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            PorizoSectionCard(title: "Song direction") {
                VStack(alignment: .leading, spacing: 12) {
                    TextField("Warm acoustic pop with a clear chorus", text: $tone)
                        .padding(14)
                        .background(PorizoAndroidTheme.surfaceElevated)
                        .clipShape(RoundedRectangle(cornerRadius: PorizoAndroidTheme.radiusSmall))
                        .overlay(
                            RoundedRectangle(cornerRadius: PorizoAndroidTheme.radiusSmall)
                                .stroke(PorizoAndroidTheme.border, lineWidth: 1)
                        )
                    Text("Use Custom when you know the musical direction, chorus anchor, and voice treatment.")
                        .font(.system(size: 13))
                        .foregroundStyle(PorizoAndroidTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            recipientCard
            messageCard
            musicAndVoiceCard
        }
    }

    private var recipientCard: some View {
        PorizoSectionCard(title: "Recipient") {
            VStack(alignment: .leading, spacing: 14) {
                TextField("Recipient name", text: $recipientName)
                    .padding(14)
                    .background(PorizoAndroidTheme.surfaceElevated)
                    .clipShape(RoundedRectangle(cornerRadius: PorizoAndroidTheme.radiusSmall))
                    .overlay(
                        RoundedRectangle(cornerRadius: PorizoAndroidTheme.radiusSmall)
                            .stroke(PorizoAndroidTheme.border, lineWidth: 1)
                    )
                    .accessibilityLabel("Recipient name")

                VStack(alignment: .leading, spacing: 8) {
                    Text("Occasion")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(PorizoAndroidTheme.textTertiary)
                    ScrollView(.horizontal) {
                        HStack(spacing: 8) {
                            ForEach(Occasion.allCases) { option in
                                PorizoOptionChip(
                                    title: option.label,
                                    isSelected: option == occasion
                                ) {
                                    occasion = option
                                }
                            }
                        }
                        .padding(.vertical, 2)
                    }
                }

                Toggle("Use recipient name as chorus anchor", isOn: $includeNameHook)
                    .font(.system(size: 15, weight: .medium))
                    .tint(PorizoAndroidTheme.gold)
            }
        }
    }

    private var messageCard: some View {
        PorizoSectionCard(title: "Message and tone") {
            VStack(alignment: .leading, spacing: 14) {
                TextField("Tone", text: $tone)
                    .padding(14)
                    .background(PorizoAndroidTheme.surfaceElevated)
                    .clipShape(RoundedRectangle(cornerRadius: PorizoAndroidTheme.radiusSmall))
                    .overlay(
                        RoundedRectangle(cornerRadius: PorizoAndroidTheme.radiusSmall)
                            .stroke(PorizoAndroidTheme.border, lineWidth: 1)
                    )
                    .accessibilityLabel("Tone")

                TextEditor(text: $message)
                    .frame(minHeight: 118)
                    .padding(8)
                    .background(PorizoAndroidTheme.surfaceElevated)
                    .clipShape(RoundedRectangle(cornerRadius: PorizoAndroidTheme.radiusSmall))
                    .overlay(
                        RoundedRectangle(cornerRadius: PorizoAndroidTheme.radiusSmall)
                            .stroke(PorizoAndroidTheme.border, lineWidth: 1)
                    )
                    .accessibilityLabel("Message")
            }
        }
    }

    private var musicAndVoiceCard: some View {
        PorizoSectionCard(title: "Music and voice") {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Voice")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(PorizoAndroidTheme.textTertiary)
                    ScrollView(.horizontal) {
                        HStack(spacing: 8) {
                            ForEach(VoiceSource.allCases) { source in
                                PorizoOptionChip(
                                    title: source.label,
                                    isSelected: source == voiceSource
                                ) {
                                    voiceSource = source
                                }
                            }
                        }
                        .padding(.vertical, 2)
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("Target duration")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(PorizoAndroidTheme.textTertiary)
                        Spacer()
                        Text("\(Int(targetDuration)) sec")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(PorizoAndroidTheme.goldDark)
                    }
                    HStack(spacing: 8) {
                        ForEach([45.0, 60.0, 90.0], id: \.self) { duration in
                            PorizoOptionChip(
                                title: "\(Int(duration))",
                                isSelected: Int(duration) == Int(targetDuration)
                            ) {
                                targetDuration = duration
                            }
                        }
                    }
                }

                Toggle("Require app claim before saving", isOn: $appOnlySave)
                    .font(.system(size: 15, weight: .medium))
                    .tint(PorizoAndroidTheme.gold)
            }
        }
    }

    #if DEBUG
    private var developerToolsCard: some View {
        PorizoSectionCard(title: "Developer tools") {
            VStack(alignment: .leading, spacing: 12) {
                Button {
                    showDeveloperTools.toggle()
                } label: {
                    HStack {
                        Text("Backend and render contract")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(PorizoAndroidTheme.textPrimary)
                        Spacer()
                        Text(showDeveloperTools ? "Hide" : "Show")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(PorizoAndroidTheme.goldDark)
                    }
                }
                .buttonStyle(.plain)

                if showDeveloperTools {
                    developerToolsContent
                }
            }
        }
    }

    private var developerToolsContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("API base: \(AndroidAppConfig.apiBaseURL)")
                .font(.system(size: 12))
                .foregroundStyle(PorizoAndroidTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)

            HStack {
                Button("Save draft") {
                    saveDraft()
                }
                Spacer()
                Button("Clear draft") {
                    clearDraft()
                }
            }

            TextField("Track ID", text: $trackId)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(10)
                .background(PorizoAndroidTheme.surfaceElevated)
                .clipShape(RoundedRectangle(cornerRadius: PorizoAndroidTheme.radiusSmall))

            Stepper("Version: \(versionNum)", value: $versionNum, in: 0...99)

            TextField("Job ID", text: $jobId)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(10)
                .background(PorizoAndroidTheme.surfaceElevated)
                .clipShape(RoundedRectangle(cornerRadius: PorizoAndroidTheme.radiusSmall))

            Button("Start preview render") {
                Task { await createVersionAndRenderPreview() }
            }
            .disabled(isWorking || trackId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            Button("Start full render") {
                Task { await renderFullVersion() }
            }
            .disabled(isWorking || trackId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || versionNum <= 0)

            Button("Poll render status") {
                Task { await pollRenderStatus() }
            }
            .disabled(isWorking || jobId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            Toggle("Auto-poll new render jobs", isOn: $automaticPollingEnabled)

            if pollAttempts > 0 {
                Text("Automatic polls: \(pollAttempts)")
                    .font(.system(size: 12))
                    .foregroundStyle(PorizoAndroidTheme.textSecondary)
            }

            Text(renderStatus)
                .font(.system(size: 12))
                .foregroundStyle(PorizoAndroidTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 4)
    }

    #endif

    private var createBottomBar: some View {
        VStack(spacing: 10) {
            Button {
                Task { await createTrack() }
            } label: {
                Text(isWorking ? "Creating..." : "Create song")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Color.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 15)
                    .background(isCreateDisabled ? PorizoAndroidTheme.textTertiary : PorizoAndroidTheme.gold)
                    .clipShape(RoundedRectangle(cornerRadius: PorizoAndroidTheme.radiusMedium))
            }
            .buttonStyle(.plain)
            .disabled(isCreateDisabled)
            .accessibilityLabel(isWorking ? "Creating song" : "Create song")

            Button {
                saveDraft()
            } label: {
                Text("Save draft")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(PorizoAndroidTheme.goldDark)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 14)
        .background(PorizoAndroidTheme.surface)
        .overlay(
            Rectangle()
                .fill(PorizoAndroidTheme.border)
                .frame(height: 1),
            alignment: .top
        )
    }

    private var isCreateDisabled: Bool {
        isWorking || recipientName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func loadLocalRecoveryState() {
        if let draft = draftStore.load() {
            recipientName = draft.recipientName
            occasion = Occasion(rawValue: draft.occasionRawValue) ?? .birthday
            voiceSource = VoiceSource(rawValue: draft.voiceSourceRawValue) ?? .creatorVoice
            tone = draft.tone
            message = draft.message
            targetDuration = draft.targetDuration
            includeNameHook = draft.includeNameHook
            appOnlySave = draft.appOnlySave
            createStatus = "Recovered draft from \(draft.updatedAt)."
        }
        if let pending = renderStore.load() {
            trackId = pending.trackId
            versionNum = pending.versionNum
            jobId = pending.jobId
            renderStatus = "Recovered \(pending.renderType) render job from \(pending.updatedAt)."
        }
    }

    private func saveDraft() {
        draftStore.save(currentDraft())
        createStatus = "Draft saved locally."
    }

    private func clearDraft() {
        draftStore.clear()
        createStatus = "Local draft cleared."
    }

    private func currentDraft() -> PorizoCreateDraft {
        PorizoCreateDraft(
            recipientName: recipientName,
            occasionRawValue: occasion.rawValue,
            voiceSourceRawValue: voiceSource.rawValue,
            tone: tone,
            message: message,
            targetDuration: targetDuration,
            includeNameHook: includeNameHook,
            appOnlySave: appOnlySave,
            updatedAt: ISO8601DateFormatter().string(from: Date())
        )
    }

    private func createTrack() async {
        await runCreateAction {
            saveDraft()
            let cleanedRecipient = recipientName.trimmingCharacters(in: .whitespacesAndNewlines)
            let request = PorizoCreateTrackRequest(
                title: "\(occasion.label) for \(cleanedRecipient)",
                occasion: occasion.rawValue,
                recipientName: cleanedRecipient,
                style: tone,
                durationTarget: Int(targetDuration),
                voiceMode: voiceSource.apiValue,
                message: message,
                specificMemory: nil,
                specialPhrases: includeNameHook ? cleanedRecipient : nil,
                whatMakesThemSpecial: message
            )
            let response = try await apiClient.createTrack(request)
            trackId = response.trackId
            createStatus = "Created track \(response.trackId) with status \(response.status)."
        }
    }

    private func createVersionAndRenderPreview() async {
        await runCreateAction {
            let version = try await apiClient.createVersion(trackId: clean(trackId), renderType: "preview")
            versionNum = version.versionNum
            let render = try await apiClient.renderPreview(trackId: clean(trackId), versionNum: version.versionNum)
            jobId = render.jobId ?? ""
            persistPendingRender(renderType: "preview")
            renderStatus = "Preview render queued. Job: \(jobId.isEmpty ? "unknown" : jobId)."
            if automaticPollingEnabled {
                await pollRenderWithRetry(renderType: "preview")
            }
        }
    }

    private func renderFullVersion() async {
        await runCreateAction {
            let render = try await apiClient.renderFull(trackId: clean(trackId), versionNum: versionNum)
            jobId = render.jobId ?? ""
            persistPendingRender(renderType: "full")
            renderStatus = "Full render queued. Job: \(jobId.isEmpty ? "unknown" : jobId)."
            if automaticPollingEnabled {
                await pollRenderWithRetry(renderType: "full")
            }
        }
    }

    private func pollRenderStatus() async {
        await runCreateAction {
            let status = try await apiClient.getJobStatus(jobId: clean(jobId))
            applyRenderStatus(status)
        }
    }

    private func pollRenderWithRetry(renderType: String) async {
        let delays: [UInt64] = [2, 4, 8, 12, 20]
        let cleanedJobId = clean(jobId)
        guard !cleanedJobId.isEmpty else {
            renderStatus = "Render queued, but no job ID was returned. Open Songs later to check server status."
            return
        }

        for (index, delay) in delays.enumerated() {
            pollAttempts = index + 1
            renderStatus = "Render queued. Waiting \(delay)s before poll \(pollAttempts) of \(delays.count)."
            try? await Task.sleep(nanoseconds: delay * 1_000_000_000)
            do {
                let status = try await apiClient.getJobStatus(jobId: cleanedJobId)
                applyRenderStatus(status)
                if isTerminalJobStatus(status.status) {
                    return
                }
                persistPendingRender(renderType: status.workflowType ?? renderType)
            } catch {
                renderStatus = "Poll \(pollAttempts) failed: \(String(describing: error))"
            }
        }

        if !isTerminalRenderMessage(renderStatus) {
            renderStatus = "\(renderStatus) Automatic polling paused; the pending job is saved and can be checked again."
        }
    }

    private func applyRenderStatus(_ status: PorizoJobStatus) {
        let progressText = status.progress.map { "\($0)%" } ?? "progress unknown"
        let detail = status.errorMessage ?? status.step ?? ""
        renderStatus = "Job \(status.status): \(progressText). \(detail)"
        if isTerminalJobStatus(status.status) {
            renderStore.clear()
        } else {
            persistPendingRender(renderType: status.workflowType ?? "render")
        }
    }

    private func isTerminalJobStatus(_ status: String) -> Bool {
        switch status.lowercased() {
        case "completed", "complete", "failed", "cancelled", "canceled":
            return true
        default:
            return false
        }
    }

    private func isTerminalRenderMessage(_ message: String) -> Bool {
        message.localizedCaseInsensitiveContains("completed") ||
            message.localizedCaseInsensitiveContains("failed") ||
            message.localizedCaseInsensitiveContains("cancelled") ||
            message.localizedCaseInsensitiveContains("canceled")
    }

    private func persistPendingRender(renderType: String) {
        guard !trackId.isEmpty, versionNum > 0, !jobId.isEmpty else {
            return
        }
        renderStore.save(PorizoPendingRender(
            trackId: clean(trackId),
            versionNum: versionNum,
            jobId: clean(jobId),
            renderType: renderType,
            updatedAt: ISO8601DateFormatter().string(from: Date())
        ))
    }

    private func runCreateAction(_ action: @escaping () async throws -> Void) async {
        isWorking = true
        defer { isWorking = false }
        do {
            try await action()
        } catch {
            createStatus = String(describing: error)
            renderStatus = String(describing: error)
        }
    }

    private func clean(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

struct PorizoSectionCard<Content: View>: View {
    let title: String
    let content: Content

    init(title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title.uppercased())
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(PorizoAndroidTheme.textTertiary)

            content
                .padding(16)
                .background(PorizoAndroidTheme.surface)
                .clipShape(RoundedRectangle(cornerRadius: PorizoAndroidTheme.radiusMedium))
                .overlay(
                    RoundedRectangle(cornerRadius: PorizoAndroidTheme.radiusMedium)
                        .stroke(PorizoAndroidTheme.border.opacity(0.7), lineWidth: 1)
                )
        }
    }
}

struct PorizoScreenHeader: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            FrauncesTitle(text: title, size: 34, weight: .bold)
            Text(subtitle)
                .font(.system(size: 15))
                .foregroundStyle(PorizoAndroidTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

struct PorizoStatusText: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 13))
            .foregroundStyle(PorizoAndroidTheme.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
    }
}

struct PorizoTextInput: View {
    let title: String
    @Binding var text: String

    var body: some View {
        TextField(title, text: $text)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .padding(13)
            .background(PorizoAndroidTheme.surfaceElevated)
            .clipShape(RoundedRectangle(cornerRadius: PorizoAndroidTheme.radiusSmall))
            .overlay(
                RoundedRectangle(cornerRadius: PorizoAndroidTheme.radiusSmall)
                    .stroke(PorizoAndroidTheme.border, lineWidth: 1)
            )
    }
}

struct PorizoActionButton: View {
    let title: String
    let symbol: String
    let isDisabled: Bool
    let action: () -> Void

    init(title: String, symbol: String, isDisabled: Bool = false, action: @escaping () -> Void) {
        self.title = title
        self.symbol = symbol
        self.isDisabled = isDisabled
        self.action = action
    }

    var body: some View {
        Button {
            action()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: symbol)
                Text(title)
                    .lineLimit(2)
            }
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(isDisabled ? PorizoAndroidTheme.textTertiary : Color.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .padding(.horizontal, 12)
            .background(isDisabled ? PorizoAndroidTheme.surfaceElevated : PorizoAndroidTheme.gold)
            .clipShape(RoundedRectangle(cornerRadius: PorizoAndroidTheme.radiusSmall))
        }
        .buttonStyle(.plain)
        .disabled(isDisabled)
    }
}

struct PorizoDivider: View {
    var body: some View {
        Rectangle()
            .fill(PorizoAndroidTheme.border.opacity(0.6))
            .frame(height: 1)
    }
}

struct PorizoStatusBadge: View {
    let text: String

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(PorizoAndroidTheme.goldDark)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(PorizoAndroidTheme.gold.opacity(0.14))
            .clipShape(Capsule())
    }
}

struct PorizoEmptyStateCard: View {
    let symbol: String
    let title: String
    let detail: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(PorizoAndroidTheme.goldDark)
                .frame(width: 38, height: 38)
                .background(PorizoAndroidTheme.gold.opacity(0.14))
                .clipShape(Circle())
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(PorizoAndroidTheme.textPrimary)
                Text(detail)
                    .font(.system(size: 13))
                    .foregroundStyle(PorizoAndroidTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 4)
    }
}

struct SongSummaryCard: View {
    let song: PorizoTrackSummary

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "play.fill")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(PorizoAndroidTheme.goldDark)
                .frame(width: 34, height: 34)
                .background(PorizoAndroidTheme.gold.opacity(0.14))
                .clipShape(Circle())

            VStack(alignment: .leading, spacing: 4) {
                Text(song.title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(PorizoAndroidTheme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(songSubtitle)
                    .font(.system(size: 13))
                    .foregroundStyle(PorizoAndroidTheme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                if let latestVersion = song.latestVersion {
                    Text("Latest version \(latestVersion)")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(PorizoAndroidTheme.textTertiary)
                }
            }

            Spacer()

            PorizoStatusBadge(text: song.status)
        }
        .padding(.vertical, 4)
    }

    private var songSubtitle: String {
        let recipient = song.recipientName ?? "Recipient"
        let occasion = song.occasion ?? "Song"
        return "\(recipient) • \(occasion)"
    }
}

struct PoemSummaryCard: View {
    let poem: PorizoPoemSummary

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "pencil")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(PorizoAndroidTheme.goldDark)
                .frame(width: 34, height: 34)
                .background(PorizoAndroidTheme.gold.opacity(0.14))
                .clipShape(Circle())

            VStack(alignment: .leading, spacing: 4) {
                Text(poem.title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(PorizoAndroidTheme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                Text("\(poem.recipientName) • \(poem.occasion)")
                    .font(.system(size: 13))
                    .foregroundStyle(PorizoAndroidTheme.textSecondary)
                Text(poemPreview)
                    .font(.system(size: 12))
                    .foregroundStyle(PorizoAndroidTheme.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer()

            PorizoStatusBadge(text: poem.status)
        }
        .padding(.vertical, 4)
    }

    private var poemPreview: String {
        let preview = poem.verses.prefix(2).joined(separator: " ")
        return preview.isEmpty ? poem.tone : preview
    }
}

struct PorizoKeyValueRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(label)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(PorizoAndroidTheme.textPrimary)
            Spacer()
            Text(value)
                .font(.system(size: 13))
                .foregroundStyle(PorizoAndroidTheme.textSecondary)
                .multilineTextAlignment(.trailing)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 8)
    }
}

struct SettingsActionRow: View {
    let title: String
    let detail: String
    let symbol: String
    let action: () -> Void

    var body: some View {
        Button {
            action()
        } label: {
            HStack(alignment: .center, spacing: 12) {
                Image(systemName: symbol)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(PorizoAndroidTheme.goldDark)
                    .frame(width: 34, height: 34)
                    .background(PorizoAndroidTheme.gold.opacity(0.14))
                    .clipShape(Circle())

                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(PorizoAndroidTheme.textPrimary)
                    Text(detail)
                        .font(.system(size: 12))
                        .foregroundStyle(PorizoAndroidTheme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer()

                Text("Open")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(PorizoAndroidTheme.goldDark)
            }
            .padding(.vertical, 10)
        }
        .buttonStyle(.plain)
    }
}

struct SettingsCapabilityRow: View {
    let capability: AndroidNativeCapability

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline) {
                Text(capability.label)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(PorizoAndroidTheme.textPrimary)
                Spacer()
                PorizoStatusBadge(text: capability.status)
            }
            Text(capability.detail)
                .font(.system(size: 12))
                .foregroundStyle(PorizoAndroidTheme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 10)
    }
}

struct FlowLayoutPills: View {
    let items: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                ForEach(Array(items.prefix(3)), id: \.self) { item in
                    TokenPill(text: item)
                }
            }
            if items.count > 3 {
                HStack(spacing: 8) {
                    ForEach(Array(items.dropFirst(3)), id: \.self) { item in
                        TokenPill(text: item)
                    }
                }
            }
        }
    }
}

struct PorizoOptionChip: View {
    let text: String
    let isSelected: Bool
    let action: () -> Void

    init(title: String, isSelected: Bool, action: @escaping () -> Void) {
        self.text = title
        self.isSelected = isSelected
        self.action = action
    }

    var body: some View {
        Button {
            action()
        } label: {
            Text(text)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(isSelected ? Color.white : PorizoAndroidTheme.textPrimary)
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(isSelected ? PorizoAndroidTheme.gold : PorizoAndroidTheme.surfaceElevated)
                .clipShape(Capsule())
                .overlay(
                    Capsule()
                        .stroke(isSelected ? PorizoAndroidTheme.gold : PorizoAndroidTheme.border, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }
}

struct TokenPill: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(PorizoAndroidTheme.goldDark)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(PorizoAndroidTheme.gold.opacity(0.14))
            .clipShape(Capsule())
    }
}

struct SettingsView: View {
    @Binding var appearance: String
    @State var activeSheet: ActiveSettingsSheet?
    @State var probeStatus = NativeProbeStatus.idle
    @State var apiBaseOverride = ""
    @State var apiBaseStatus = "Uses production unless a debug override is saved."

    var body: some View {
        ZStack {
            PorizoAndroidTheme.background.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    PorizoScreenHeader(
                        title: "Settings",
                        subtitle: "Manage account access, device trust, Android adapters, and release readiness."
                    )

                    PorizoSectionCard(title: "Account and billing") {
                        VStack(spacing: 0) {
                            SettingsActionRow(
                                title: "Authentication",
                                detail: "Phone sign-in and trusted device token",
                                symbol: "person.crop.circle"
                            ) {
                                activeSheet = .auth
                            }
                            PorizoDivider()
                            SettingsActionRow(
                                title: "Subscription",
                                detail: "Plans, Play Billing, and backend receipt sync",
                                symbol: "cart"
                            ) {
                                activeSheet = .subscription
                            }
                            PorizoDivider()
                            SettingsActionRow(
                                title: "Push notifications",
                                detail: "OneSignal token registration",
                                symbol: "bell"
                            ) {
                                activeSheet = .push
                            }
                            PorizoDivider()
                            SettingsActionRow(
                                title: "Voice enrollment",
                                detail: "Recorder, upload, and completion flow",
                                symbol: "plus.circle.fill"
                            ) {
                                activeSheet = .voiceEnrollment
                            }
                        }
                    }

                    PorizoSectionCard(title: "Appearance") {
                        Picker("Appearance", selection: $appearance) {
                            Text("System").tag("")
                            Text("Light").tag("light")
                            Text("Dark").tag("dark")
                        }
                    }

                    #if DEBUG
                    PorizoSectionCard(title: "Backend target") {
                        VStack(alignment: .leading, spacing: 12) {
                            PorizoKeyValueRow(label: "Active", value: AndroidAppConfig.apiBaseURL)
                            PorizoTextInput(title: "https://api.porizo.co", text: $apiBaseOverride)

                            HStack(spacing: 10) {
                                PorizoActionButton(title: "Save API base", symbol: "info.circle") {
                                    AndroidAppConfig.saveDebugAPIBaseURLOverride(apiBaseOverride)
                                    apiBaseStatus = "Saved. Reopen a screen to create clients with the new API base."
                                }

                                PorizoActionButton(title: "Clear", symbol: "xmark") {
                                    apiBaseOverride = ""
                                    AndroidAppConfig.saveDebugAPIBaseURLOverride("")
                                    apiBaseStatus = "Cleared. New clients use production."
                                }
                            }

                            PorizoStatusText(text: apiBaseStatus)
                        }
                    }
                    #endif

                    PorizoSectionCard(title: "Android native adapters") {
                        VStack(alignment: .leading, spacing: 12) {
                            RecordingEscapeHatchView()

                            Picker("Probe state", selection: $probeStatus) {
                                ForEach(NativeProbeStatus.allCases) { status in
                                    Text(status.label).tag(status)
                                }
                            }

                            PorizoStatusText(text: probeStatus.detail)
                        }
                    }

                    PorizoSectionCard(title: "Phone test readiness") {
                        VStack(spacing: 0) {
                            ForEach(AndroidNativeCapability.allCases) { capability in
                                SettingsCapabilityRow(capability: capability)
                                if capability.id != AndroidNativeCapability.releaseSigning.id {
                                    PorizoDivider()
                                }
                            }
                        }
                    }

                    PorizoSectionCard(title: "App identity") {
                        VStack(spacing: 0) {
                            PorizoKeyValueRow(label: "App", value: AndroidAppConfig.displayName)
                            PorizoDivider()
                            PorizoKeyValueRow(label: "Package", value: AndroidAppConfig.applicationId)
                            PorizoDivider()
                            PorizoKeyValueRow(label: "Platform", value: AndroidAppConfig.platform)
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 18)
                .padding(.bottom, 28)
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            apiBaseOverride = UserDefaults.standard.string(forKey: AndroidAppConfig.apiBaseURLOverrideKey) ?? ""
        }
        .sheet(item: $activeSheet) { sheet in
            switch sheet {
            case .auth:
                AuthSheetView()
            case .subscription:
                SubscriptionSheetView()
            case .push:
                PushTokenSheetView()
            case .voiceEnrollment:
                VoiceEnrollmentSheetView()
            }
        }
    }
}

struct AuthSheetView: View {
    @Environment(\.dismiss) var dismiss
    @State var phoneNumber = ""
    @State var verificationCode = ""
    @State var registrationToken = ""
    @State var userId = ""
    @State var deviceId = ""
    @State var deviceToken = ""
    @State var deviceTokenExpiry = ""
    @State var statusText = "Use an E.164 phone number, then verify the code."
    @State var isWorking = false
    private let apiClient = AndroidAPIClient()
    private let sessionStore = AndroidSessionStore()
    private let pushProvider = AndroidPushProvider()

    var body: some View {
        NavigationStack {
            Form {
                Section("Phone auth") {
                    TextField("+15551234567", text: $phoneNumber)
                        .keyboardType(.phonePad)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Verification code", text: $verificationCode)
                        .keyboardType(.numberPad)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Registration token", text: $registrationToken)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()

                    Button {
                        Task { await sendCode() }
                    } label: {
                        Label("Send verification code", systemImage: "envelope")
                    }
                    .disabled(isWorking || phoneNumber.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                    Button {
                        Task { await verifyCode() }
                    } label: {
                        Label("Verify code", systemImage: "checkmark.circle")
                    }
                    .disabled(isWorking || phoneNumber.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || verificationCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                    Button {
                        Task { await registerAccount() }
                    } label: {
                        Label("Register new phone account", systemImage: "person")
                    }
                    .disabled(isWorking || registrationToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                Section("Device trust") {
                    HStack {
                        Text("User")
                        Spacer()
                        Text(userId.isEmpty ? "not signed in" : userId)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    HStack {
                        Text("Device")
                        Spacer()
                        Text(deviceId)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    HStack {
                        Text("Device token")
                        Spacer()
                        Text(deviceToken.isEmpty ? "not registered" : "stored securely")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if !deviceTokenExpiry.isEmpty {
                        Text("Expires \(deviceTokenExpiry)")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    Button {
                        Task { await registerDevice() }
                    } label: {
                        Label("Register Android device", systemImage: "lock")
                    }
                    .disabled(isWorking)

                    Button(role: .destructive) {
                        clearSession()
                    } label: {
                        Label("Clear local auth session", systemImage: "person.crop.circle")
                    }

                    Text(statusText)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Auth")
            .task {
                reloadSession()
            }
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }

    private func reloadSession() {
        deviceId = sessionStore.getOrCreateDeviceId()
        deviceToken = sessionStore.currentDeviceToken() ?? ""
        deviceTokenExpiry = sessionStore.loadDeviceTokenExpiry() ?? ""
        userId = sessionStore.loadAuthSession()?.userId ?? ""
    }

    private func sendCode() async {
        await runAuthAction {
            let response = try await apiClient.sendPhoneVerificationCode(phoneNumber: clean(phoneNumber))
            statusText = "Code sent to \(response.maskedPhone ?? clean(phoneNumber)). Expires \(response.expiresAt ?? "soon")."
        }
    }

    private func verifyCode() async {
        await runAuthAction {
            let response = try await apiClient.verifyPhoneCode(phoneNumber: clean(phoneNumber), code: clean(verificationCode))
            if let token = response.registrationToken {
                registrationToken = token
                statusText = "Phone verified. Register this new account to finish sign-in."
            } else if response.accessToken != nil {
                if let signedInUserId = sessionStore.loadAuthSession()?.userId {
                    _ = pushProvider.initialize()
                    _ = pushProvider.login(userId: signedInUserId)
                }
                statusText = "Signed in existing phone account."
            } else {
                statusText = response.verified ? "Phone verified." : "Verification failed."
            }
            reloadSession()
        }
    }

    private func registerAccount() async {
        await runAuthAction {
            let session = try await apiClient.registerPhoneAccount(registrationToken: clean(registrationToken), phoneNumber: clean(phoneNumber))
            _ = pushProvider.initialize()
            _ = pushProvider.login(userId: session.userId)
            statusText = "Registered user \(session.userId)."
            reloadSession()
        }
    }

    private func registerDevice() async {
        await runAuthAction {
            let response = try await apiClient.registerDevice()
            statusText = "Device registered. Token expires \(response.expiresAt)."
            reloadSession()
        }
    }

    private func clearSession() {
        _ = pushProvider.logout()
        sessionStore.clearAuthSession()
        sessionStore.clearDeviceToken()
        reloadSession()
        statusText = "Local auth and device tokens cleared."
    }

    private func runAuthAction(_ action: @escaping () async throws -> Void) async {
        isWorking = true
        defer { isWorking = false }
        do {
            try await action()
        } catch {
            statusText = String(describing: error)
        }
    }

    private func clean(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

struct SubscriptionSheetView: View {
    @Environment(\.dismiss) var dismiss
    @State var entitlements: PorizoBillingEntitlements?
    @State var subscriptionStatus: PorizoSubscriptionStatusResponse?
    @State var plans: [PorizoSubscriptionPlan] = []
    @State var loadedProducts: [AndroidPlayProductSummary] = []
    @State var purchaseToken = ""
    @State var selectedProductId = AndroidAppConfig.subscriptionProductIds.first ?? ""
    @State var statusText = "Load plans, query Play Billing products, then purchase or restore a subscription."
    @State var isWorking = false
    private let apiClient = AndroidAPIClient()
    private let billingProvider = AndroidPlayBillingProvider()
    private let sessionStore = AndroidSessionStore()

    var body: some View {
        NavigationStack {
            Form {
                Section("Entitlement and subscription") {
                    HStack {
                        Text("Plan")
                        Spacer()
                        Text(entitlements?.tier ?? "unknown")
                    }
                    HStack {
                        Text("Active subscription")
                        Spacer()
                        Text((subscriptionStatus?.hasActiveSubscription ?? subscriptionStatus?.hasSubscription) == true ? "yes" : "unknown")
                    }
                    HStack {
                        Text("Song credits")
                        Spacer()
                        Text("\(entitlements?.availableSongCredits ?? entitlements?.songsRemaining ?? 0)")
                    }
                    HStack {
                        Text("Poem credits")
                        Spacer()
                        Text("\(entitlements?.poemsRemaining ?? 0)")
                    }
                    Button {
                        Task { await loadEntitlements() }
                    } label: {
                        Label("Load entitlements", systemImage: "arrow.clockwise.circle")
                    }
                    .disabled(isWorking)

                    Button {
                        Task { await loadSubscriptionStatus() }
                    } label: {
                        Label("Load subscription status", systemImage: "person")
                    }
                    .disabled(isWorking)
                }

                Section("Plans and Play products") {
                    Button {
                        Task { await loadBillingCatalog() }
                    } label: {
                        Label("Load plans and Play products", systemImage: "list.bullet")
                    }
                    .disabled(isWorking)

                    Picker("Product", selection: $selectedProductId) {
                        ForEach(productChoices, id: \.self) { productId in
                            Text(productId).tag(productId)
                        }
                    }

                    if !plans.isEmpty {
                        ForEach(plans) { plan in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(plan.name)
                                    .font(.headline)
                                Text("\(plan.songsPerMonth) songs/month • \(plan.poemsPerMonth) poems/month")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Text(plan.googleSubscriptionProductIds.joined(separator: " • "))
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }

                    if !loadedProducts.isEmpty {
                        ForEach(loadedProducts) { product in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(product.title)
                                    .font(.subheadline)
                                Text("\(product.id) • \(product.productType) • \(product.price)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }

                Section("Play Billing purchase") {
                    Button {
                        Task { await launchPurchase() }
                    } label: {
                        Label("Open Play purchase sheet", systemImage: "cart")
                    }
                    .disabled(isWorking || selectedProductId.isEmpty)

                    Button {
                        Task { await refreshPlayPurchases() }
                    } label: {
                        Label("Refresh Play purchases", systemImage: "arrow.clockwise.circle")
                    }
                    .disabled(isWorking)

                    TextField("Purchase token", text: $purchaseToken)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Subscription product ID", text: $selectedProductId)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button {
                        Task { await validateGoogleReceipt() }
                    } label: {
                        Label("Sync Google receipt with backend", systemImage: "checkmark.circle")
                    }
                    .disabled(isWorking || purchaseToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || selectedProductId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                    Text(statusText)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Text("Gift bundle purchases still need a backend Google consumable receipt endpoint before Android can grant gift wallet credit.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Subscription")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }

    private var productChoices: [String] {
        let loaded = loadedProducts.map(\.id)
        let planIds = plans.flatMap(\.googleSubscriptionProductIds)
        let all = loaded + planIds + AndroidAppConfig.subscriptionProductIds
        return Array(Set(all)).sorted()
    }

    private func loadEntitlements() async {
        await runBillingAction {
            entitlements = try await apiClient.getBillingEntitlements()
            statusText = "Entitlements loaded."
        }
    }

    private func loadSubscriptionStatus() async {
        await runBillingAction {
            subscriptionStatus = try await apiClient.getSubscriptionStatus()
            entitlements = subscriptionStatus?.entitlements ?? entitlements
            statusText = "Subscription status loaded."
        }
    }

    private func loadBillingCatalog() async {
        await runBillingAction {
            let response = try await apiClient.getBillingPlans()
            plans = response.plans
            let planProductIds = response.plans.flatMap(\.googleSubscriptionProductIds)
            let subscriptionIds = planProductIds.isEmpty ? AndroidAppConfig.subscriptionProductIds : Array(Set(planProductIds)).sorted()
            if selectedProductId.isEmpty {
                selectedProductId = subscriptionIds.first ?? ""
            }
            statusText = billingProvider.queryProducts(
                subscriptionIds: subscriptionIds,
                oneTimeIds: AndroidAppConfig.oneTimeProductIds
            )
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            loadedProducts = billingProvider.loadedProducts()
            if loadedProducts.contains(where: { $0.id == selectedProductId }) == false,
               let first = loadedProducts.first(where: { $0.productType == "subs" })?.id ?? subscriptionIds.first {
                selectedProductId = first
            }
            statusText = billingProvider.status()
        }
    }

    private func launchPurchase() async {
        await runBillingAction {
            let userId = sessionStore.loadAuthSession()?.userId
            statusText = billingProvider.launchPurchase(
                productId: selectedProductId.trimmingCharacters(in: .whitespacesAndNewlines),
                obfuscatedAccountId: userId.map { String($0.prefix(64)) }
            )
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            if let token = billingProvider.lastPurchaseToken(productId: selectedProductId) {
                purchaseToken = token
                statusText = "Purchase token captured. Sync it with the backend to activate entitlements."
            }
        }
    }

    private func refreshPlayPurchases() async {
        await runBillingAction {
            statusText = billingProvider.queryActivePurchases()
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            if let token = billingProvider.lastPurchaseToken(productId: selectedProductId) {
                purchaseToken = token
                statusText = "Active purchase token loaded for \(selectedProductId)."
            } else {
                statusText = billingProvider.status()
            }
            loadedProducts = billingProvider.loadedProducts()
        }
    }

    private func validateGoogleReceipt() async {
        await runBillingAction {
            let response = try await apiClient.validateGoogleSubscription(
                purchaseToken: purchaseToken.trimmingCharacters(in: .whitespacesAndNewlines),
                subscriptionId: selectedProductId.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            entitlements = response.entitlements
            statusText = response.success ? "Google subscription synced." : "Google validation returned unsuccessful."
        }
    }

    private func runBillingAction(_ action: @escaping () async throws -> Void) async {
        isWorking = true
        defer { isWorking = false }
        do {
            try await action()
        } catch {
            statusText = String(describing: error)
        }
    }
}

struct PushTokenSheetView: View {
    @Environment(\.dismiss) var dismiss
    @State var pushToken = ""
    @State var subscriptionId = ""
    @State var statusText = "Initialize OneSignal, request permission, then register the device token with the backend."
    @State var isWorking = false
    private let apiClient = AndroidAPIClient()
    private let sessionStore = AndroidSessionStore()
    private let pushProvider = AndroidPushProvider()

    var body: some View {
        NavigationStack {
            Form {
                Section("OneSignal Android") {
                    HStack {
                        Text("App ID")
                        Spacer()
                        Text(AndroidAppConfig.oneSignalAppId)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Button {
                        initializeOneSignal()
                    } label: {
                        Label("Initialize OneSignal", systemImage: "bell")
                    }
                    .disabled(isWorking)

                    Button {
                        requestPermission()
                    } label: {
                        Label("Request notification permission", systemImage: "checkmark.circle")
                    }
                    .disabled(isWorking)

                    Button {
                        optInAndReadToken()
                    } label: {
                        Label("Read OneSignal token", systemImage: "lock")
                    }
                    .disabled(isWorking)

                    if !subscriptionId.isEmpty {
                        Text("Subscription: \(subscriptionId)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Section("Backend device registration") {
                    TextField("OneSignal push token", text: $pushToken)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button {
                        Task { await registerPushToken() }
                    } label: {
                        Label("Register token", systemImage: "bell")
                    }
                    .disabled(isWorking || pushToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    Text(statusText)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Push")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }

    private func initializeOneSignal() {
        isWorking = true
        defer { isWorking = false }
        var messages = [pushProvider.initialize()]
        if let userId = sessionStore.loadAuthSession()?.userId, !userId.isEmpty {
            messages.append(pushProvider.login(userId: userId))
        }
        statusText = messages.joined(separator: " ")
    }

    private func requestPermission() {
        isWorking = true
        defer { isWorking = false }
        statusText = pushProvider.requestPermission()
    }

    private func optInAndReadToken() {
        isWorking = true
        defer { isWorking = false }
        let optInStatus = pushProvider.optIn()
        pushToken = pushProvider.pushToken() ?? pushToken
        subscriptionId = pushProvider.subscriptionId() ?? subscriptionId
        statusText = pushToken.isEmpty ? "\(optInStatus) Token is not available yet; reopen after FCM registration completes." : "\(optInStatus) Token loaded."
    }

    private func registerPushToken() async {
        isWorking = true
        defer { isWorking = false }
        do {
            let response = try await apiClient.registerPushToken(pushToken.trimmingCharacters(in: .whitespacesAndNewlines))
            statusText = "Push token registered. Device token expires \(response.expiresAt)."
        } catch {
            statusText = String(describing: error)
        }
    }
}

struct VoiceEnrollmentSheetView: View {
    @Environment(\.dismiss) var dismiss
    @State var consentAccepted = false
    @State var session: PorizoEnrollmentSession?
    @State var uploadUrlsByChunkId: [String: PorizoUploadURL] = [:]
    @State var uploadedChunkIds: Set<String> = []
    @State var currentPromptIndex = 0
    @State var currentRecording: AndroidNativeRecording?
    @State var voiceProfile: PorizoVoiceProfileStatus?
    @State var completionProfile: PorizoVoiceProfile?
    @State var statusText = "Accept voice consent, start enrollment, then record each prompt."
    @State var isRecording = false
    @State var isWorking = false
    private let apiClient = AndroidAPIClient()
    private let recorder = AndroidRecorderProvider()

    var body: some View {
        NavigationStack {
            Form {
                Section("Consent") {
                    Toggle("I consent to record my voice for Porizo My Voice songs", isOn: $consentAccepted)
                    Text("Consent is sent to the backend with the same voice_suno_persona_v1 scope as iOS.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("Enrollment session") {
                    Button {
                        Task { await startEnrollment() }
                    } label: {
                        Label(isWorking ? "Starting..." : "Start voice enrollment", systemImage: "plus.circle.fill")
                    }
                    .disabled(isWorking || !consentAccepted)

                    Button {
                        Task { await loadVoiceProfile() }
                    } label: {
                        Label("Check voice profile", systemImage: "person")
                    }
                    .disabled(isWorking)

                    if let session {
                        Text("Session: \(session.sessionId)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text("Expires: \(session.sessionExpiresAt)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    if let voiceProfile {
                        Text("Profile: \(voiceProfile.status ?? "unknown") • ready: \(voiceProfile.myVoiceReady == true ? "yes" : "no")")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Section("Prompt recording") {
                    if let prompt = currentPrompt {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Phrase \(currentPromptIndex + 1) of \(prompts.count)")
                                .font(.headline)
                            Text(prompt.text)
                            if prompt.type == "sung" {
                                Text(prompt.pitchHint ?? "Sing slowly and hold each note.")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Text("Minimum: \(Int(currentPromptMinimumDuration)) seconds")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        Button {
                            requestMicrophonePermission()
                        } label: {
                            Label("Request microphone permission", systemImage: "checkmark.circle")
                        }
                        .disabled(isWorking || isRecording)

                        Button {
                            startRecording()
                        } label: {
                            Label("Start recording", systemImage: "plus.circle.fill")
                        }
                        .disabled(isWorking || isRecording)

                        Button {
                            stopRecording()
                        } label: {
                            Label("Stop recording", systemImage: "xmark")
                        }
                        .disabled(!isRecording)

                        if let currentRecording {
                            Text("Recorded \(String(format: "%.1f", currentRecording.durationSec))s, \(currentRecording.bytes) bytes")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        Button {
                            Task { await uploadCurrentRecording() }
                        } label: {
                            Label("Upload current prompt", systemImage: "square.and.arrow.up")
                        }
                        .disabled(isWorking || currentRecording == nil)
                    } else {
                        Text(session == nil ? "Start a session to load prompts." : "All prompts are uploaded.")
                            .foregroundStyle(.secondary)
                    }
                }

                Section("Complete") {
                    HStack {
                        Text("Uploaded")
                        Spacer()
                        Text("\(uploadedChunkIds.count) / \(prompts.count)")
                    }

                    Button {
                        Task { await completeEnrollment() }
                    } label: {
                        Label("Complete enrollment", systemImage: "checkmark.circle")
                    }
                    .disabled(isWorking || session == nil || prompts.isEmpty || uploadedChunkIds.count < prompts.count)

                    if let completionProfile {
                        Text("Completion: \(completionProfile.status) • score \(completionProfile.qualityScore.map { String(format: "%.0f", $0) } ?? "pending")")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Text(statusText)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Voice")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }

    private var prompts: [PorizoEnrollmentPrompt] {
        session?.prompts ?? []
    }

    private var currentPrompt: PorizoEnrollmentPrompt? {
        guard currentPromptIndex < prompts.count else { return nil }
        return prompts[currentPromptIndex]
    }

    private var currentPromptMinimumDuration: Double {
        guard let prompt = currentPrompt else { return 2 }
        if prompt.type == "sung" {
            return max(6, Double(prompt.durationHintSec ?? 8) - 0.5)
        }
        return 2
    }

    private func startEnrollment() async {
        guard consentAccepted else {
            statusText = "Consent is required before voice enrollment can start."
            return
        }
        await runVoiceAction {
            let response = try await apiClient.startEnrollment(consentAccepted: consentAccepted)
            session = response
            uploadUrlsByChunkId = Dictionary(uniqueKeysWithValues: (response.uploadUrls ?? []).map { ($0.chunkId, $0) })
            uploadedChunkIds = []
            currentPromptIndex = 0
            currentRecording = nil
            completionProfile = nil
            statusText = "Enrollment started with \(response.prompts?.count ?? 0) prompts."
        }
    }

    private func requestMicrophonePermission() {
        statusText = recorder.requestMicrophonePermission()
    }

    private func startRecording() {
        if !recorder.hasMicrophonePermission() {
            statusText = recorder.requestMicrophonePermission()
            return
        }
        let result = recorder.startRecording()
        if result.hasPrefix("OK|") {
            isRecording = true
            currentRecording = nil
            statusText = "Recording started."
        } else {
            statusText = result.replacingOccurrences(of: "ERROR|", with: "")
        }
    }

    private func stopRecording() {
        do {
            let recording = try recorder.stopRecording()
            isRecording = false
            if recording.durationSec < currentPromptMinimumDuration {
                _ = recorder.delete(recording: recording)
                currentRecording = nil
                statusText = "Recording was too short. Record the full prompt before uploading."
            } else {
                currentRecording = recording
                statusText = "Recording captured. Upload it before moving to the next phrase."
            }
        } catch {
            isRecording = false
            statusText = String(describing: error)
        }
    }

    private func uploadCurrentRecording() async {
        guard let session, let prompt = currentPrompt, let recording = currentRecording else {
            statusText = "No recording is ready to upload."
            return
        }
        guard let uploadURL = uploadUrlsByChunkId[prompt.id] else {
            statusText = "Upload URL for \(prompt.id) is missing. Restart enrollment to refresh presigned URLs."
            return
        }
        await runVoiceAction {
            let audioData = try recorder.data(for: recording)
            let response = try await apiClient.uploadEnrollmentChunk(
                sessionId: session.sessionId,
                chunkId: prompt.id,
                audioData: audioData,
                uploadURL: uploadURL,
                durationSec: recording.durationSec,
                checksum: recording.checksum
            )
            if response.status == "accepted" {
                uploadedChunkIds.insert(prompt.id)
            }
            if let nextUploadUrl = response.nextUploadUrl {
                uploadUrlsByChunkId[nextUploadUrl.chunkId] = nextUploadUrl
            }
            _ = recorder.delete(recording: recording)
            currentRecording = nil
            if currentPromptIndex < prompts.count - 1 {
                currentPromptIndex += 1
                statusText = "Prompt uploaded. Continue with phrase \(currentPromptIndex + 1)."
            } else {
                statusText = "All prompts uploaded. Complete enrollment."
            }
        }
    }

    private func completeEnrollment() async {
        guard let session else {
            statusText = "Start enrollment first."
            return
        }
        await runVoiceAction {
            completionProfile = try await apiClient.completeEnrollment(sessionId: session.sessionId)
            statusText = "Enrollment completion started. Check voice profile readiness next."
        }
    }

    private func loadVoiceProfile() async {
        await runVoiceAction {
            voiceProfile = try await apiClient.getVoiceProfile()
            statusText = "Voice profile loaded."
        }
    }

    private func runVoiceAction(_ action: @escaping () async throws -> Void) async {
        isWorking = true
        defer { isWorking = false }
        do {
            try await action()
        } catch {
            statusText = String(describing: error)
        }
    }
}

struct RecordingEscapeHatchView: View {
    var body: some View {
        HStack {
            Image(systemName: "person.crop.circle")
            VStack(alignment: .leading, spacing: 4) {
                Text("Voice enrollment adapter")
                Text("Android WAV recording is wired through the Settings voice sheet.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
