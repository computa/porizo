import SwiftUI

enum ContentTab: String, Hashable {
    case create, songs, poems, recipient, settings
}

struct ContentView: View {
    @AppStorage("tab") var tab = ContentTab.create
    @AppStorage("appearance") var appearance = ""

    var body: some View {
        TabView(selection: $tab) {
            NavigationStack {
                CreateSongView()
            }
            .tabItem { Label("Create", systemImage: "square.and.pencil") }
            .tag(ContentTab.create)

            NavigationStack {
                SongsView()
            }
            .tabItem { Label("Songs", systemImage: "music.note.list") }
            .tag(ContentTab.songs)

            NavigationStack {
                PoemsView()
            }
            .tabItem { Label("Poems", systemImage: "text.book.closed") }
            .tag(ContentTab.poems)

            NavigationStack {
                RecipientClaimView()
            }
            .tabItem { Label("Claim", systemImage: "gift.fill") }
            .tag(ContentTab.recipient)

            NavigationStack {
                SettingsView(appearance: $appearance)
            }
            .tabItem { Label("Settings", systemImage: "gearshape.fill") }
            .tag(ContentTab.settings)
        }
        .preferredColorScheme(appearance == "dark" ? .dark : appearance == "light" ? .light : nil)
    }
}

struct SongsView: View {
    @State var songs: [PorizoTrackSummary] = []
    @State var statusText = "Sign in to load songs from Porizo."
    @State var isLoading = false
    private let apiClient = AndroidAPIClient()

    var body: some View {
        Form {
            Section("Library") {
                Button {
                    Task {
                        await loadSongs()
                    }
                } label: {
                    Label(isLoading ? "Loading songs..." : "Load songs", systemImage: "arrow.clockwise")
                }
                .disabled(isLoading)

                Text(statusText)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Section("Songs") {
                if songs.isEmpty {
                    Text("No songs loaded.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(songs) { song in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(song.title)
                                .font(.headline)
                            Text("\(song.recipientName ?? "Recipient") • \(song.status)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .navigationTitle("Songs")
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
    @State var poems: [PorizoPoemSummary] = []
    @State var statusText = "Sign in to load poems from Porizo."
    @State var isLoading = false
    private let apiClient = AndroidAPIClient()

    var body: some View {
        Form {
            Section("Library") {
                Button {
                    Task {
                        await loadPoems()
                    }
                } label: {
                    Label(isLoading ? "Loading poems..." : "Load poems", systemImage: "arrow.clockwise")
                }
                .disabled(isLoading)

                Text(statusText)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Section("Poems") {
                if poems.isEmpty {
                    Text("No poems loaded.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(poems) { poem in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(poem.title)
                                .font(.headline)
                            Text("\(poem.recipientName) • \(poem.status)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text(poem.verses.prefix(2).joined(separator: " "))
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .navigationTitle("Poems")
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

struct RecipientClaimView: View {
    @State var claimState = ClaimState.readyToClaim
    @State var linkRoute = LinkRoute.webPreview
    @State var isPlaying = false
    @State var playhead = 18.0

    var body: some View {
        Form {
            Section("Claim state") {
                Picker("Fixture", selection: $claimState) {
                    ForEach(ClaimState.allCases) { state in
                        Text(state.label).tag(state)
                    }
                }
                RecipientHeroCard(state: claimState)
            }

            Section("Web and app handoff") {
                Picker("Entry route", selection: $linkRoute) {
                    ForEach(LinkRoute.allCases) { route in
                        Text(route.label).tag(route)
                    }
                }
                HStack {
                    Label("https://\(AndroidAppConfig.shareHost)/s/sarah-birthday", systemImage: "link")
                    Spacer()
                    Text(linkRoute.badge)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Text(linkRoute.detail)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Section("Playback") {
                HStack {
                    Button {
                        isPlaying.toggle()
                        if isPlaying && playhead < 62 {
                            playhead = min(62, playhead + 7)
                        }
                    } label: {
                        Label(isPlaying ? "Pause" : "Play", systemImage: isPlaying ? "pause.fill" : "play.fill")
                    }
                    .disabled(!claimState.canPlay)

                    Spacer()
                    Text("\(Int(playhead)) / 62 sec")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                ProgressView(value: playhead, total: 62)
                Button("Claim on this Android device") {
                    claimState = .claimedHere
                }
                .disabled(claimState != .readyToClaim)
            }
        }
        .navigationTitle("Recipient")
    }
}

struct RecipientHeroCard: View {
    let state: ClaimState

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: state.symbol)
                    .font(.title2)
                VStack(alignment: .leading, spacing: 4) {
                    Text(state.headline)
                        .font(.headline)
                    Text("Happy Birthday Sarah")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            Text(state.detail)
                .font(.body)
            HStack {
                Text("Bound device")
                    .foregroundStyle(.secondary)
                Spacer()
                Text(state.boundDevice)
            }
            .font(.caption)
        }
        .padding(.vertical, 8)
    }
}

struct CreateSongView: View {
    @State var recipientName = "Sarah"
    @State var occasion = Occasion.birthday
    @State var voiceSource = VoiceSource.creatorVoice
    @State var tone = "Warm, specific, grateful"
    @State var message = "You always make everyone feel seen. I want the chorus to say her name clearly and make the gift feel private."
    @State var targetDuration = 60.0
    @State var includeNameHook = true
    @State var appOnlySave = true

    var body: some View {
        Form {
            Section("Create tokens") {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        TokenPill(text: "name hook")
                        TokenPill(text: "inside joke")
                        TokenPill(text: "clear chorus")
                    }
                    HStack {
                        TokenPill(text: "app-only save")
                        TokenPill(text: "preview first")
                    }
                }
            }

            Section("Recipient") {
                TextField("Recipient name", text: $recipientName)
                Picker("Occasion", selection: $occasion) {
                    ForEach(Occasion.allCases) { option in
                        Text(option.label).tag(option)
                    }
                }
                Toggle("Use recipient name as chorus anchor", isOn: $includeNameHook)
            }

            Section("Message and tone") {
                TextField("Tone", text: $tone)
                TextEditor(text: $message)
                    .frame(minHeight: 96)
            }

            Section("Music and voice") {
                Picker("Voice", selection: $voiceSource) {
                    ForEach(VoiceSource.allCases) { source in
                        Text(source.label).tag(source)
                    }
                }
                Slider(value: $targetDuration, in: 45...90, step: 15)
                Text("Target duration: \(Int(targetDuration)) seconds")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Toggle("Require app claim before saving", isOn: $appOnlySave)
            }

            Section("Backend contract") {
                Label("Create, render status, and app-only saving are next integration slices", systemImage: "checklist")
                Label("API base: \(AndroidAppConfig.apiBaseURL)", systemImage: "network")
            }
        }
        .navigationTitle("Create")
    }
}

struct TokenPill: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.caption)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Color.secondary.opacity(0.12))
            .cornerRadius(8)
    }
}

struct SettingsView: View {
    @Binding var appearance: String
    @State var activeSheet: ActiveSettingsSheet?
    @State var probeStatus = NativeProbeStatus.idle

    var body: some View {
        Form {
            Section("Account and billing") {
                Button {
                    activeSheet = .auth
                } label: {
                    Label("Open auth sheet", systemImage: "person.crop.circle.badge.checkmark")
                }
                Button {
                    activeSheet = .subscription
                } label: {
                    Label("Open subscription sheet", systemImage: "creditcard")
                }
            }

            Section("Appearance") {
                Picker("Appearance", selection: $appearance) {
                    Text("System").tag("")
                    Text("Light").tag("light")
                    Text("Dark").tag("dark")
                }
            }

            Section("Android native adapters") {
                RecordingEscapeHatchView()
                Picker("Probe state", selection: $probeStatus) {
                    ForEach(NativeProbeStatus.allCases) { status in
                        Text(status.label).tag(status)
                    }
                }
                Text(probeStatus.detail)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Section("App identity") {
                HStack {
                    Text("App")
                    Spacer()
                    Text(AndroidAppConfig.displayName)
                }
                HStack {
                    Text("Package")
                    Spacer()
                    Text(AndroidAppConfig.applicationId)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                HStack {
                    Text("Platform")
                    Spacer()
                    Text(AndroidAppConfig.platform)
                }
            }
        }
        .navigationTitle("Settings")
        .sheet(item: $activeSheet) { sheet in
            switch sheet {
            case .auth:
                AuthSheetView()
            case .subscription:
                SubscriptionSheetView()
            }
        }
    }
}

struct AuthSheetView: View {
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Phone auth") {
                    Text("sarah@example.com")
                    Button("Send verification code") {
                    }
                }
                Section("Device trust") {
                    Label("Android device token and Play Integrity adapters pending", systemImage: "lock.shield")
                }
            }
            .navigationTitle("Auth")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }
}

struct SubscriptionSheetView: View {
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Entitlement") {
                    HStack {
                        Text("Plan")
                        Spacer()
                        Text("Gift Plus")
                    }
                    HStack {
                        Text("Song credits")
                        Spacer()
                        Text("3")
                    }
                }
                Section("Android purchase proof") {
                    Label("Play Billing purchase-token adapter pending", systemImage: "cart.badge.questionmark")
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
}

struct RecordingEscapeHatchView: View {
    var body: some View {
        #if os(Android)
        ComposeView {
            RecordingShellComposer()
        }
        .frame(height: 56)
        #else
        HStack {
            Image(systemName: "mic.circle")
            VStack(alignment: .leading) {
                Text("Recording shell placeholder")
                Text("Android recording and STT will use a native adapter.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        #endif
    }
}

#if SKIP
struct RecordingShellComposer: ContentComposer {
    @Composable func Compose(context: ComposeContext) {
        androidx.compose.material3.Text("Android native recording and STT adapter pending", modifier: context.modifier)
    }
}
#endif
