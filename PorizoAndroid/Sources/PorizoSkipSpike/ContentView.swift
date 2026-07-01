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
        }
    }

    private func renderFullVersion() async {
        await runCreateAction {
            let render = try await apiClient.renderFull(trackId: clean(trackId), versionNum: versionNum)
            jobId = render.jobId ?? ""
            persistPendingRender(renderType: "full")
            renderStatus = "Full render queued. Job: \(jobId.isEmpty ? "unknown" : jobId)."
        }
    }

    private func pollRenderStatus() async {
        await runCreateAction {
            let status = try await apiClient.getJobStatus(jobId: clean(jobId))
            let progressText = status.progress.map { "\($0)%" } ?? "progress unknown"
            renderStatus = "Job \(status.status): \(progressText). \(status.errorMessage ?? status.step ?? "")"
            if status.status == "completed" || status.status == "failed" {
                renderStore.clear()
            } else {
                persistPendingRender(renderType: status.workflowType ?? "render")
            }
        }
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
            case .push:
                PushTokenSheetView()
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
                        Text(deviceToken.isEmpty ? "not registered" : "stored")
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
    @State var purchaseToken = ""
    @State var subscriptionId = "porizo_plus_monthly"
    @State var statusText = "Load entitlements after sign-in. Validate Google receipts with a Play Billing purchase token."
    @State var isWorking = false
    private let apiClient = AndroidAPIClient()

    var body: some View {
        NavigationStack {
            Form {
                Section("Entitlement") {
                    HStack {
                        Text("Plan")
                        Spacer()
                        Text(entitlements?.tier ?? "unknown")
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
                }
                Section("Android purchase proof") {
                    TextField("Purchase token", text: $purchaseToken)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Subscription ID", text: $subscriptionId)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button {
                        Task { await validateGoogleReceipt() }
                    } label: {
                        Label("Validate Google receipt", systemImage: "cart.badge.checkmark")
                    }
                    .disabled(isWorking || purchaseToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || subscriptionId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                    Text(statusText)
                        .font(.footnote)
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

    private func loadEntitlements() async {
        await runBillingAction {
            entitlements = try await apiClient.getBillingEntitlements()
            statusText = "Entitlements loaded."
        }
    }

    private func validateGoogleReceipt() async {
        await runBillingAction {
            let response = try await apiClient.validateGoogleSubscription(
                purchaseToken: purchaseToken.trimmingCharacters(in: .whitespacesAndNewlines),
                subscriptionId: subscriptionId.trimmingCharacters(in: .whitespacesAndNewlines)
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
    @State var statusText = "Paste the token from the chosen Android push provider. The backend stores it through /device/register."
    @State var isWorking = false
    private let apiClient = AndroidAPIClient()

    var body: some View {
        NavigationStack {
            Form {
                Section("Android push boundary") {
                    TextField("FCM or OneSignal device token", text: $pushToken)
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
