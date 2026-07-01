import SwiftUI

enum ContentTab: String, Hashable {
    case create, songs, poems, recipient, settings
}

struct ContentView: View {
    @AppStorage("tab") var tab = ContentTab.create
    @AppStorage("appearance") var appearance = ""
    @State var claimRoute: AndroidDeepLinkRoute?
    @State var poemRouteId: String?

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
                PoemsView(deepLinkedPoemId: poemRouteId)
            }
            .tabItem { Label("Poems", systemImage: "text.book.closed") }
            .tag(ContentTab.poems)

            NavigationStack {
                RecipientClaimView(initialRoute: claimRoute)
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
        .task {
            consumePendingDeepLink()
        }
    }

    private func consumePendingDeepLink() {
        guard let route = AndroidDeepLinkStore().consume() else {
            return
        }
        switch route {
        case .share, .receiverHandoff:
            claimRoute = route
            tab = .recipient
        case .poem(let poemId):
            poemRouteId = poemId
            tab = .poems
        case .unknown:
            claimRoute = route
            tab = .recipient
        }
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
    let deepLinkedPoemId: String?
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

struct RecipientClaimView: View {
    let initialRoute: AndroidDeepLinkRoute?
    @State var claimState = ClaimState.readyToClaim
    @State var linkRoute = LinkRoute.webPreview
    @State var isPlaying = false
    @State var playhead = 18.0
    @State var routedRouteLabel = ""
    @State var shareId = "sarah-birthday"
    @State var claimPin = ""
    @State var handoffId = ""
    @State var receiverClaimToken = ""
    @State var routeStatus = "Open an Android App Link or enter a share ID."
    @State var streamStatus = "Protected stream keys require a claimed Android device."
    @State var isWorking = false
    private let apiClient = AndroidAPIClient()

    init(initialRoute: AndroidDeepLinkRoute? = nil) {
        self.initialRoute = initialRoute
    }

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

            Section("Share contract") {
                TextField("Share ID", text: $shareId)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                TextField("PIN, if required", text: $claimPin)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()

                Button {
                    Task { await loadShareInfo() }
                } label: {
                    Label(isWorking ? "Loading share..." : "Load share", systemImage: "link")
                }
                .disabled(isWorking || shareId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                Button {
                    Task { await claimShare() }
                } label: {
                    Label("Claim on this Android device", systemImage: "gift.fill")
                }
                .disabled(isWorking || shareId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                Button {
                    Task { await loadProtectedStream() }
                } label: {
                    Label("Check protected stream", systemImage: "lock.open")
                }
                .disabled(isWorking || shareId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                Text(routeStatus)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Text(streamStatus)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Section("Receiver handoff") {
                TextField("Handoff ID", text: $handoffId)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                TextField("Receiver claim token", text: $receiverClaimToken)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()

                Button {
                    Task { await resolveHandoff() }
                } label: {
                    Label("Resolve handoff", systemImage: "arrow.triangle.2.circlepath")
                }
                .disabled(isWorking || handoffId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                Button {
                    Task { await claimReceiverToken() }
                } label: {
                    Label("Claim receiver token", systemImage: "checkmark.seal")
                }
                .disabled(isWorking || receiverClaimToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
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
                Button("Set fixture as claimed") {
                    claimState = .claimedHere
                }
                .disabled(claimState != .readyToClaim)
            }
        }
        .navigationTitle("Recipient")
        .task(id: initialRoute?.routeLabel ?? "") {
            applyInitialRoute()
        }
    }

    private func applyInitialRoute() {
        guard let initialRoute else {
            return
        }
        let label = initialRoute.routeLabel
        guard routedRouteLabel != label else {
            return
        }
        routedRouteLabel = label
        switch initialRoute {
        case .share(let id):
            shareId = id
            linkRoute = .appLinkReturn
            routeStatus = "Loaded app link for share \(id)."
        case .receiverHandoff(let id):
            handoffId = id
            linkRoute = .appLinkReturn
            routeStatus = "Loaded receiver handoff \(id)."
        case .poem(let id):
            routeStatus = "Poem link \(id) belongs in the Poems tab."
        case .unknown(let rawURL):
            routeStatus = "Unsupported Android App Link: \(rawURL)"
        }
    }

    private func loadShareInfo() async {
        await runClaimAction {
            let response = try await apiClient.getShareInfo(shareId: clean(shareId))
            let title = response.track?.title ?? response.trackPreview?.title ?? "shared song"
            let access = response.canAccess == false ? "not accessible" : "accessible"
            routeStatus = "Share \(response.status): \(title) is \(access)."
            claimState = response.status == "claimed" ? .alreadyClaimed : .readyToClaim
        }
    }

    private func claimShare() async {
        await runClaimAction {
            let response = try await apiClient.claimShare(shareId: clean(shareId), pin: claimPin)
            routeStatus = "Claim \(response.status). App save allowed: \(response.appSaveAllowed == false ? "no" : "yes")."
            claimState = response.status == "claimed" || response.appSaveAllowed == true ? .claimedHere : claimState
        }
    }

    private func resolveHandoff() async {
        await runClaimAction {
            let response = try await apiClient.resolveReceiverHandoff(handoffId: clean(handoffId))
            receiverClaimToken = response.receiverClaimToken
            routeStatus = "Resolved \(response.contentKind) handoff. Claim token expires \(response.receiverClaimExpiresAt ?? "unknown")."
        }
    }

    private func claimReceiverToken() async {
        await runClaimAction {
            let response = try await apiClient.claimReceiverToken(claimToken: clean(receiverClaimToken), pin: claimPin)
            routeStatus = "Receiver claim \(response.status). App save allowed: \(response.appSaveAllowed == false ? "no" : "yes")."
            claimState = response.status == "claimed" || response.appSaveAllowed == true ? .claimedHere : claimState
        }
    }

    private func loadProtectedStream() async {
        await runClaimAction {
            let response = try await apiClient.getShareStream(shareId: clean(shareId))
            streamStatus = "Stream \(response.format ?? "audio") available until \(response.expiresAt ?? "unknown")."
        }
    }

    private func runClaimAction(_ action: @escaping () async throws -> Void) async {
        isWorking = true
        defer { isWorking = false }
        do {
            try await action()
        } catch {
            routeStatus = String(describing: error)
        }
    }

    private func clean(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
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
    @State var trackId = ""
    @State var versionNum = 0
    @State var jobId = ""
    @State var createStatus = "Draft is local until you create the song."
    @State var renderStatus = "No render started."
    @State var automaticPollingEnabled = true
    @State var pollAttempts = 0
    @State var isWorking = false
    private let apiClient = AndroidAPIClient()
    private let draftStore = AndroidCreateDraftStore()
    private let renderStore = AndroidRenderPollStore()

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
                Label("API base: \(AndroidAppConfig.apiBaseURL)", systemImage: "network")
                Button {
                    saveDraft()
                } label: {
                    Label("Save draft", systemImage: "tray.and.arrow.down")
                }
                Button {
                    clearDraft()
                } label: {
                    Label("Clear draft", systemImage: "trash")
                }
                Button {
                    Task { await createTrack() }
                } label: {
                    Label(isWorking ? "Creating..." : "Create song", systemImage: "music.note")
                }
                .disabled(isWorking || recipientName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Text(createStatus)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Section("Render status") {
                TextField("Track ID", text: $trackId)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Stepper("Version: \(versionNum)", value: $versionNum, in: 0...99)
                TextField("Job ID", text: $jobId)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()

                Button {
                    Task { await createVersionAndRenderPreview() }
                } label: {
                    Label("Start preview render", systemImage: "waveform")
                }
                .disabled(isWorking || trackId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                Button {
                    Task { await renderFullVersion() }
                } label: {
                    Label("Start full render", systemImage: "waveform.path")
                }
                .disabled(isWorking || trackId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || versionNum <= 0)

                Button {
                    Task { await pollRenderStatus() }
                } label: {
                    Label("Poll render status", systemImage: "arrow.clockwise")
                }
                .disabled(isWorking || jobId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                Toggle("Auto-poll new render jobs", isOn: $automaticPollingEnabled)

                if pollAttempts > 0 {
                    Text("Automatic polls: \(pollAttempts)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Text(renderStatus)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Create")
        .task {
            loadLocalRecoveryState()
        }
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
    @State var apiBaseOverride = ""
    @State var apiBaseStatus = "Uses production unless a debug override is saved."

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
                Button {
                    activeSheet = .push
                } label: {
                    Label("Register push token", systemImage: "bell.badge")
                }
                Button {
                    activeSheet = .voiceEnrollment
                } label: {
                    Label("Open voice enrollment", systemImage: "mic.badge.plus")
                }
            }

            Section("Appearance") {
                Picker("Appearance", selection: $appearance) {
                    Text("System").tag("")
                    Text("Light").tag("light")
                    Text("Dark").tag("dark")
                }
            }

            #if DEBUG
            Section("Backend target") {
                HStack {
                    Text("Active")
                    Spacer()
                    Text(AndroidAppConfig.apiBaseURL)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                TextField("https://api.porizo.co", text: $apiBaseOverride)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                HStack {
                    Button {
                        AndroidAppConfig.saveDebugAPIBaseURLOverride(apiBaseOverride)
                        apiBaseStatus = "Saved. Reopen a screen to create clients with the new API base."
                    } label: {
                        Label("Save API base", systemImage: "network")
                    }
                    Spacer()
                    Button(role: .destructive) {
                        apiBaseOverride = ""
                        AndroidAppConfig.saveDebugAPIBaseURLOverride("")
                        apiBaseStatus = "Cleared. New clients use production."
                    } label: {
                        Label("Clear", systemImage: "xmark.circle")
                    }
                }
                Text(apiBaseStatus)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            #endif

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

            Section("Phone test readiness") {
                ForEach(AndroidNativeCapability.allCases) { capability in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(capability.label)
                            Spacer()
                            Text(capability.status)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Text(capability.detail)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }
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
                        Label("Send verification code", systemImage: "message.badge")
                    }
                    .disabled(isWorking || phoneNumber.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                    Button {
                        Task { await verifyCode() }
                    } label: {
                        Label("Verify code", systemImage: "checkmark.message")
                    }
                    .disabled(isWorking || phoneNumber.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || verificationCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                    Button {
                        Task { await registerAccount() }
                    } label: {
                        Label("Register new phone account", systemImage: "person.badge.plus")
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
                        Label("Register Android device", systemImage: "lock.shield")
                    }
                    .disabled(isWorking)

                    Button(role: .destructive) {
                        clearSession()
                    } label: {
                        Label("Clear local auth session", systemImage: "person.crop.circle.badge.xmark")
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
                        Label("Load entitlements", systemImage: "arrow.clockwise")
                    }
                    .disabled(isWorking)

                    Button {
                        Task { await loadSubscriptionStatus() }
                    } label: {
                        Label("Load subscription status", systemImage: "person.text.rectangle")
                    }
                    .disabled(isWorking)
                }

                Section("Plans and Play products") {
                    Button {
                        Task { await loadBillingCatalog() }
                    } label: {
                        Label("Load plans and Play products", systemImage: "list.bullet.rectangle")
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
                        Label("Refresh Play purchases", systemImage: "arrow.triangle.2.circlepath")
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
                        Label("Sync Google receipt with backend", systemImage: "checkmark.seal")
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
                        Label("Initialize OneSignal", systemImage: "bell.and.waves.left.and.right")
                    }
                    .disabled(isWorking)

                    Button {
                        requestPermission()
                    } label: {
                        Label("Request notification permission", systemImage: "checkmark.shield")
                    }
                    .disabled(isWorking)

                    Button {
                        optInAndReadToken()
                    } label: {
                        Label("Read OneSignal token", systemImage: "key.viewfinder")
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
                        Label("Register token", systemImage: "bell.badge")
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
                        Label(isWorking ? "Starting..." : "Start voice enrollment", systemImage: "mic.badge.plus")
                    }
                    .disabled(isWorking || !consentAccepted)

                    Button {
                        Task { await loadVoiceProfile() }
                    } label: {
                        Label("Check voice profile", systemImage: "person.wave.2")
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
                            Label("Request microphone permission", systemImage: "checkmark.shield")
                        }
                        .disabled(isWorking || isRecording)

                        Button {
                            startRecording()
                        } label: {
                            Label("Start recording", systemImage: "record.circle")
                        }
                        .disabled(isWorking || isRecording)

                        Button {
                            stopRecording()
                        } label: {
                            Label("Stop recording", systemImage: "stop.circle")
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
                            Label("Upload current prompt", systemImage: "icloud.and.arrow.up")
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
                        Label("Complete enrollment", systemImage: "checkmark.seal")
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
            Image(systemName: "mic.circle")
            VStack(alignment: .leading, spacing: 4) {
                Text("Voice enrollment adapter")
                Text("Android WAV recording is wired through the Settings voice sheet.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
