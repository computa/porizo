//
//  RootView.swift
//  PorizoApp
//
//  Root view that handles app state: splash → onboarding → main app.
//  Light mode design for love and friendship.
//

import SwiftUI
import CryptoKit

struct RootView: View {
    @EnvironmentObject var authManager: AuthManager
    @State private var appState: RootState = .splash
    @State private var apiClient: APIClient?
    @State private var sttRouter: STTRouter?
    @State private var shareContext: ShareContext?
    @State private var pendingShareId: String?
    @State private var pendingShareIsPoem: Bool = false
    @AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding = false
    @State private var hasSkippedProfileCompletionInSession = false

    // Configuration
    // Auth is required in all builds to avoid showing main tabs when logged out.
    // DEBUG-only bypass for local validation (set PORIZO_BYPASS_AUTH=1).
    private let skipAuth: Bool = {
        #if DEBUG
        let envEnabled = ProcessInfo.processInfo.environment["PORIZO_BYPASS_AUTH"] == "1"
        let argEnabled = ProcessInfo.processInfo.arguments.contains("--bypass-auth")
        return envEnabled || argEnabled
        #else
        return false
        #endif
    }()
    private let serverURL = AppConfig.apiBaseURL

    enum RootState {
        case splash
        case onboarding
        case landing
        case auth
        case main
        #if DEBUG
        case designSamples
        #endif
    }

    #if DEBUG
    private let showDesignSamples: Bool = {
        ProcessInfo.processInfo.arguments.contains("--design-samples")
        || UserDefaults.standard.bool(forKey: "showDesignSamples")
    }()
    #endif

    struct ShareContext: Identifiable {
        let id = UUID()
        let shareId: String
        let isPoem: Bool  // true = poem share, false = track share
    }

    var body: some View {
        Group {
            switch appState {
            case .splash:
                SplashView()
                    .onAppear {
                        // Initialize API client with device ID as fallback
                        let deviceId = getOrCreateDeviceId()
                        let client = makeAPIClient(deviceId: deviceId)
                        apiClient = client

                        // Initialize STT router with the authenticated API client
                        let router = STTRouter(apiClient: client)
                        sttRouter = router

                        // Wire AuthManager to APIClient for Bearer token auth
                        // This allows authenticated users to use JWT tokens instead of device ID
                        // Using closure to bridge @MainActor (AuthManager) and actor (APIClient) isolation

                        // Transition after splash animation (1.5 seconds)
                        // Also fetch STT config in parallel for faster first transcription
                        Task { @MainActor in
                            // Fetch STT config while splash is showing
                            await router.fetchConfig()

                            try? await Task.sleep(for: .seconds(1.5))
                            withAnimation(.easeInOut(duration: 0.5)) {
                                #if DEBUG
                                if showDesignSamples {
                                    appState = .designSamples
                                    return
                                }
                                #endif
                                if hasCompletedOnboarding {
                                    appState = (skipAuth || authManager.isAuthenticated) ? .main : .auth
                                } else {
                                    appState = .onboarding
                                }
                            }
                        }
                    }

            case .onboarding:
                OnboardingView(
                    onComplete: completeOnboarding,
                    onSkip: completeOnboarding
                )

            case .landing:
                LandingView(
                    onCreateAccount: {
                        // No guest access; route to auth
                        withAnimation(.easeInOut(duration: 0.5)) {
                            appState = .auth
                        }
                    },
                    onSignIn: {
                        // Show sign-in flow
                        withAnimation(.easeInOut(duration: 0.5)) {
                            appState = .auth
                        }
                    }
                )

            #if DEBUG
            case .designSamples:
                DesignSampleView()
            #endif

            case .main:
                if let client = apiClient, let router = sttRouter {
                    MainTabView(apiClient: client)
                        .environmentObject(router)
                } else {
                    // Fallback - create client if needed
                    let fallbackClient = makeAPIClient(deviceId: getOrCreateDeviceId())
                    MainTabView(apiClient: fallbackClient)
                        .environmentObject(sttRouter ?? STTRouter(apiClient: fallbackClient))
                }
            case .auth:
                if let client = apiClient {
                    AuthView()
                        .environmentObject(APIClientWrapper(client: client))
                } else {
                    AuthView()
                        .environmentObject(APIClientWrapper(baseURL: serverURL))
                }
            }
        }
        .onOpenURL { url in
            handleIncomingURL(url)
        }
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { userActivity in
            guard let url = userActivity.webpageURL else { return }
            handleIncomingURL(url)
        }
        .sheet(item: $shareContext) { context in
            let deviceId = getOrCreateDeviceId()
            let client = apiClient ?? makeAPIClient(deviceId: deviceId)
            if context.isPoem {
                PoemClaimView(
                    apiClient: client,
                    shareId: context.shareId
                )
            } else {
                ShareClaimView(
                    apiClient: client,
                    shareId: context.shareId,
                    deviceId: deviceId
                )
            }
        }
        .sheet(isPresented: Binding(
            get: { authManager.needsProfileCompletion && !hasSkippedProfileCompletionInSession },
            set: { newValue in
                if !newValue && authManager.needsProfileCompletion {
                    // Session-only skip: show the sheet again on next app launch.
                    hasSkippedProfileCompletionInSession = true
                    authManager.dismissProfileCompletion()
                }
            }
        )) {
            if let client = apiClient {
                ProfileCompletionView(apiClient: client)
                    .environmentObject(authManager)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .trackRenderCompleted)) { notification in
            // Handle render completion at app level (e.g., from push notification)
            // Views like MySongsView will also receive this and refresh their data
            print("[RootView] Received trackRenderCompleted notification")
        }
        .onChange(of: authManager.isAuthenticated) { _, isAuthenticated in
            if isAuthenticated {
                hasSkippedProfileCompletionInSession = false
                if let pendingShareId {
                    shareContext = ShareContext(shareId: pendingShareId, isPoem: pendingShareIsPoem)
                    self.pendingShareId = nil
                    self.pendingShareIsPoem = false
                }
                if appState == .auth {
                    withAnimation(.easeInOut(duration: 0.3)) {
                        appState = .main
                    }
                }
            } else if hasCompletedOnboarding && !skipAuth && appState != .auth {
                withAnimation(.easeInOut(duration: 0.3)) {
                    appState = .auth
                }
            }
        }
        .onChange(of: authManager.hasValidatedSession) { _, hasValidated in
            guard hasValidated else { return }
            Task {
                if let client = apiClient {
                    try? await client.ensureDeviceToken()
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .pushTokenUpdated)) { _ in
            // Re-register device when APNs token changes (ensures server has latest push token)
            guard authManager.isAuthenticated, let client = apiClient else { return }
            Task { _ = try? await client.registerDevice(appVersion: APIClient.appVersion) }
        }
    }

    private func completeOnboarding() {
        hasCompletedOnboarding = true
        withAnimation(.easeInOut(duration: 0.5)) {
            appState = (skipAuth || authManager.isAuthenticated) ? .main : .auth
        }
    }

    private func handleIncomingURL(_ url: URL) {
        // First pass to TikTok SDK so Share Kit callbacks are resolved.
        if TikTokShareService.shared.handleIncomingURL(url) {
            return
        }

        guard let parsed = parseShareUrl(from: url) else { return }
        let deviceId = getOrCreateDeviceId()
        if apiClient == nil {
            apiClient = makeAPIClient(deviceId: deviceId)
        }
        if authManager.isAuthenticated {
            shareContext = ShareContext(shareId: parsed.shareId, isPoem: parsed.isPoem)
        } else {
            pendingShareId = parsed.shareId
            pendingShareIsPoem = parsed.isPoem
            appState = .auth
        }
    }

    private func getOrCreateDeviceId() -> String {
        let key = "porizo_device_id"

        // Try Keychain first (secure storage)
        if let existing = KeychainHelper.loadString(key: key) {
            return existing
        }

        // Migrate from UserDefaults if exists (one-time migration)
        if let legacyId = UserDefaults.standard.string(forKey: key) {
            _ = KeychainHelper.saveString(key: key, value: legacyId)
            UserDefaults.standard.removeObject(forKey: key)
            return legacyId
        }

        // Generate new ID and store in Keychain
        let newId = "ios_\(UUID().uuidString.prefix(12).lowercased())"
        _ = KeychainHelper.saveString(key: key, value: newId)
        return newId
    }

    /// Parses a share URL and returns the share ID and type
    /// - Track shares: /play/:id, /s/:id
    /// - Poem shares: /poem/:id, /p/:id, /poem-share/:id
    private func parseShareUrl(from url: URL) -> (shareId: String, isPoem: Bool)? {
        let trackPrefixes: Set<String> = ["play", "s"]
        let poemPrefixes: Set<String> = ["poem", "p", "poem-share"]

        // Try path-based URL first, then host-based
        let components = url.pathComponents.filter { $0 != "/" }
        let prefix = components.first ?? url.host ?? ""
        let shareId = components.last ?? ""

        guard !shareId.isEmpty, shareId != "/" else { return nil }

        if trackPrefixes.contains(prefix) {
            return (shareId, false)
        }
        if poemPrefixes.contains(prefix) {
            return (shareId, true)
        }
        return nil
    }

    private func makeAPIClient(deviceId: String) -> APIClient {
        let client = APIClient(baseURL: serverURL, userId: deviceId)
        Task { @MainActor in
            // Auth token provider - returns current token for API requests
            await client.setAuthTokenProvider { [weak authManager] in
                guard let authManager = authManager else { return (nil, nil) }
                let token: String?
                do {
                    token = try await authManager.getAccessToken()
                } catch {
                    print("[Auth] Token fetch failed: \(error.localizedDescription)")
                    token = nil
                }
                let userId = await authManager.authenticatedUserId
                return (token, userId)
            }

            // Auth refresh provider - allows APIClient to trigger token refresh on 401
            await client.setAuthRefreshProvider { [weak authManager] in
                guard let authManager = authManager else {
                    throw AuthError.notAuthenticated
                }
                return try await authManager.refreshTokens()
            }

            // Proactive token provider - validates and refreshes token BEFORE API calls if near expiry
            await client.setProactiveTokenProvider { [weak authManager] in
                guard let authManager = authManager else {
                    throw AuthError.notAuthenticated
                }
                return try await authManager.ensureValidAccessToken()
            }

            // Auth failure handler - only called for definitive auth failures
            await client.setAuthFailureHandler { [weak authManager] in
                authManager?.logout()
            }
        }
        return client
    }
}

// MARK: - Enrollment Flow View (for Settings)

struct EnrollmentFlowView: View {
    let apiClient: APIClient
    let existingScore: Double?  // For re-enrollment comparison display
    let onComplete: () -> Void

    init(apiClient: APIClient, existingScore: Double? = nil, onComplete: @escaping () -> Void) {
        self.apiClient = apiClient
        self.existingScore = existingScore
        self.onComplete = onComplete
    }

    @StateObject private var recorder = AudioRecorder()

    @State private var currentStep: EnrollmentStep = .welcome
    @State private var sessionId: String?
    @State private var promptSetId: String?
    @State private var prompts: [EnrollmentPrompt] = []
    @State private var currentPromptIndex: Int = 0
    @State private var recordingSettings: RecordingSettings?
    @State private var uploadedChunkIds: Set<String> = []
    @State private var uploadUrlsByChunkId: [String: UploadURL] = [:]
    @State private var qualityScore: Int?
    @State private var consentGranted = false

    @State private var isLoading = false
    @State private var showingError = false
    @State private var errorMessage = ""

    // Enrollment outcome for re-enrollment flow
    @State private var enrollmentOutcome: EnrollmentOutcome?
    @State private var newScore: Double?

    // Task references for proper cancellation on view disappear
    @State private var enrollmentTask: Task<Void, Never>?
    @State private var pollingTask: Task<Void, Never>?
    @State private var countdownTask: Task<Void, Never>?

    // Countdown timer state
    @State private var countdownSeconds: Int = 0
    @State private var isCountingDown: Bool = false
    private let recordingDuration: Int = 5  // seconds per recording

    enum EnrollmentStep {
        case welcome
        case recording
        case processing
        case completed
    }

    var body: some View {
        NavigationStack {
            ZStack {
                DesignTokens.background.ignoresSafeArea()

                VStack {
                    switch currentStep {
                    case .welcome:
                        welcomeView

                    case .recording:
                        recordingView

                    case .processing:
                        processingView

                    case .completed:
                        completedView
                    }
                }
            }
            .navigationTitle(navigationTitle)
            .navigationBarTitleDisplayMode(.inline)
            .alert("Error", isPresented: $showingError) {
                Button("OK", role: .cancel) { }
            } message: {
                Text(errorMessage)
            }
            .onDisappear {
                // Cancel any running tasks to prevent resource leaks
                enrollmentTask?.cancel()
                pollingTask?.cancel()
                countdownTask?.cancel()
                if recorder.isRecording {
                    _ = recorder.stopRecording()
                }
            }
        }
    }

    private var navigationTitle: String {
        switch currentStep {
        case .welcome: return "Voice Enrollment"
        case .recording: return "Record Your Voice"
        case .processing: return "Processing"
        case .completed: return "Complete"
        }
    }

    // MARK: - Welcome View

    private var welcomeView: some View {
        VStack(spacing: DesignTokens.spacing28) {
            Spacer()

            // Icon
            ZStack {
                Circle()
                    .fill(DesignTokens.gold.opacity(0.15))
                    .frame(width: 120, height: 120)
                Image(systemName: "waveform.circle.fill")
                    .font(.system(size: 56))
                    .foregroundColor(DesignTokens.gold)
            }

            // Title + Subtitle
            VStack(spacing: DesignTokens.spacing12) {
                Text("Let's Set Up Your Voice")
                    .font(.title.bold())
                    .foregroundColor(DesignTokens.textPrimary)

                Text("Record a few phrases so your songs can sound like you singing. This takes about 2 minutes.")
                    .font(.body)
                    .foregroundColor(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(4)
            }
            .padding(.horizontal, DesignTokens.spacing16)

            Spacer()

            // Requirements Card
            VStack(alignment: .leading, spacing: DesignTokens.spacing8) {
                Text("BEFORE YOU BEGIN")
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundColor(DesignTokens.textTertiary)
                    .padding(.horizontal, DesignTokens.spacing4)

                VStack(spacing: 0) {
                    // Info row (always checked)
                    HStack(spacing: DesignTokens.spacing12) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 20))
                            .foregroundColor(DesignTokens.success)
                        Text("Find a quiet environment")
                            .font(.body)
                            .foregroundColor(DesignTokens.textPrimary)
                        Spacer()
                    }
                    .padding(DesignTokens.spacing16)

                    Divider().padding(.leading, 48)

                    // Consent toggle row (entire row tappable)
                    Button {
                        consentGranted.toggle()
                    } label: {
                        HStack(spacing: DesignTokens.spacing12) {
                            Image(systemName: consentGranted ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 20))
                                .foregroundColor(consentGranted ? DesignTokens.success : DesignTokens.textTertiary)
                            Text("Consent to voice use")
                                .font(.body)
                                .foregroundColor(DesignTokens.textPrimary)
                            Spacer()
                            Toggle("", isOn: $consentGranted)
                                .labelsHidden()
                                .tint(DesignTokens.gold)
                        }
                        .padding(DesignTokens.spacing16)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
                .background(DesignTokens.surface)
                .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusLarge))
                .elevation(.level1)
            }
            .padding(.horizontal, DesignTokens.spacing16)

            // CTA Button (gradient when enabled)
            Button {
                startEnrollment()
            } label: {
                Text("Get Started")
                    .font(.headline)
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(
                        Group {
                            if consentGranted && !isLoading {
                                LinearGradient(
                                    colors: [DesignTokens.gold, DesignTokens.gold],
                                    startPoint: .leading,
                                    endPoint: .trailing
                                )
                            } else {
                                Color(DesignTokens.textTertiary)
                            }
                        }
                    )
                    .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
            }
            .disabled(!consentGranted || isLoading)
            .padding(.horizontal, DesignTokens.spacing16)
            // Apply accent shadow only when enabled
            .shadow(
                color: (consentGranted && !isLoading) ? DesignTokens.gold.opacity(0.3) : .clear,
                radius: 8,
                y: 4
            )

            // Privacy reassurance
            Text("Your voice data is encrypted and never shared")
                .font(.caption)
                .foregroundColor(DesignTokens.textTertiary)
                .padding(.bottom, DesignTokens.spacing28)
        }
    }

    // MARK: - Recording View

    private var recordingView: some View {
        VStack(spacing: 24) {
            // Progress
            HStack {
                Text("Prompt \(currentPromptIndex + 1) of \(prompts.count)")
                    .font(.subheadline)
                    .foregroundColor(DesignTokens.textSecondary)
                Spacer()
            }
            .padding(.horizontal)

            ProgressView(value: Double(currentPromptIndex), total: Double(prompts.count))
                .tint(DesignTokens.gold)
                .padding(.horizontal)

            Spacer()

            // Current prompt
            if currentPromptIndex < prompts.count {
                let prompt = prompts[currentPromptIndex]

                VStack(spacing: 16) {
                    Text(prompt.type == "spoken" ? "Say this:" : "Sing this:")
                        .font(.subheadline)
                        .foregroundColor(DesignTokens.textSecondary)

                    Text(prompt.text)
                        .font(.title2)
                        .foregroundColor(DesignTokens.textPrimary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                }
            }

            Spacer()

            // Recording button with countdown
            ZStack {
                Button {
                    if recorder.isRecording {
                        cancelCountdownAndStopRecording()
                    } else {
                        startRecordingWithCountdown()
                    }
                } label: {
                    ZStack {
                        Circle()
                            .fill(recorder.isRecording ? DesignTokens.error : DesignTokens.gold)
                            .frame(width: 80, height: 80)
                            .accentShadow(color: recorder.isRecording ? DesignTokens.error : DesignTokens.gold)

                        if recorder.isRecording {
                            // Show countdown number
                            Text("\(countdownSeconds)")
                                .font(.system(size: 32, weight: .bold))
                                .foregroundColor(.white)
                        } else {
                            Circle()
                                .fill(.white)
                                .frame(width: 24, height: 24)
                        }
                    }
                }
                .disabled(isLoading)
            }

            Text(recorder.isRecording ? "Recording... \(countdownSeconds)s" : "Tap to record")
                .font(.subheadline)
                .foregroundColor(DesignTokens.textSecondary)

            Spacer()
        }
        .padding(.top)
    }

    // MARK: - Processing View

    private var processingView: some View {
        VStack(spacing: 24) {
            Spacer()

            ProgressView()
                .scaleEffect(1.5)
                .tint(DesignTokens.gold)

            Text("Creating your voice profile...")
                .font(.headline)
                .foregroundColor(DesignTokens.textPrimary)

            Text("This may take a minute")
                .foregroundColor(DesignTokens.textSecondary)

            Spacer()
        }
    }

    // MARK: - Completed View

    private var completedView: some View {
        VStack(spacing: 24) {
            Spacer()

            // Outcome-specific icon
            ZStack {
                Circle()
                    .fill(outcomeIconColor.opacity(0.1))
                    .frame(width: 120, height: 120)

                Image(systemName: outcomeIcon)
                    .font(.system(size: 64))
                    .foregroundColor(outcomeIconColor)
            }

            VStack(spacing: 12) {
                // Outcome-specific title
                Text(outcomeTitle)
                    .font(.title.bold())
                    .foregroundColor(DesignTokens.textPrimary)

                // Score display (with comparison for re-enrollment)
                if let outcome = enrollmentOutcome,
                   outcome == .keptExisting,
                   let newScoreVal = newScore,
                   let existingScoreVal = existingScore {
                    // Show comparison when existing profile was kept
                    VStack(spacing: 4) {
                        Text("New attempt: \(Int(newScoreVal))%")
                            .foregroundColor(DesignTokens.textTertiary)
                        Text("Your \(Int(existingScoreVal))% profile is better")
                            .foregroundColor(DesignTokens.textSecondary)
                            .fontWeight(.medium)
                    }
                } else if let outcome = enrollmentOutcome,
                          outcome == .upgraded,
                          let existingScoreVal = existingScore,
                          let newScoreVal = qualityScore {
                    // Show improvement for upgraded profile
                    HStack(spacing: 8) {
                        Text("\(Int(existingScoreVal))%")
                            .foregroundColor(DesignTokens.textTertiary)
                            .strikethrough()
                        Image(systemName: "arrow.right")
                            .foregroundColor(DesignTokens.success)
                        Text("\(newScoreVal)%")
                            .foregroundColor(DesignTokens.success)
                            .fontWeight(.semibold)
                    }
                } else if let score = qualityScore {
                    Text("Quality score: \(score)%")
                        .foregroundColor(DesignTokens.textSecondary)
                }

                // Outcome-specific message
                Text(outcomeMessage)
                    .multilineTextAlignment(.center)
                    .foregroundColor(DesignTokens.textSecondary)
                    .padding(.horizontal, 32)
            }

            Spacer()

            Button {
                onComplete()
            } label: {
                Text(outcomeButtonText)
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(DesignTokens.gold)
                    .foregroundColor(.white)
                    .cornerRadius(12)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
    }

    // MARK: - Outcome Helpers

    private var outcomeIcon: String {
        guard let outcome = enrollmentOutcome else {
            return "checkmark.circle.fill"
        }
        return outcome.icon
    }

    private var outcomeIconColor: Color {
        guard let outcome = enrollmentOutcome else {
            return DesignTokens.success
        }
        return outcome.iconColor
    }

    private var outcomeTitle: String {
        guard let outcome = enrollmentOutcome else {
            return "Voice Profile Ready!"
        }
        return outcome.title
    }

    private var outcomeMessage: String {
        guard let outcome = enrollmentOutcome else {
            return "You can now create personalized songs that sound like you."
        }
        switch outcome {
        case .new:
            return "You can now create personalized songs that sound like you."
        case .upgraded:
            return "Nice improvement! Your songs will sound even better now."
        case .keptExisting:
            return "Your existing profile was kept because it has better quality."
        }
    }

    private var outcomeButtonText: String {
        guard let outcome = enrollmentOutcome else {
            return "Start Creating"
        }
        switch outcome {
        case .new, .upgraded:
            return "Start Creating"
        case .keptExisting:
            return "Done"
        }
    }

    // MARK: - Actions

    private func startEnrollment() {
        isLoading = true
        enrollmentTask = Task {
            do {
                let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "startEnrollment") {
                    try await apiClient.startEnrollment()
                }
                await MainActor.run {
                    sessionId = response.sessionId
                    promptSetId = response.promptSetId
                    prompts = response.prompts ?? []
                    recordingSettings = response.recordingSettings
                    uploadUrlsByChunkId = Dictionary(
                        uniqueKeysWithValues: (response.uploadUrls ?? []).map { ($0.chunkId, $0) }
                    )
                    isLoading = false
                    withAnimation {
                        currentStep = .recording
                    }
                }
            } catch {
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    showingError = true
                    isLoading = false
                }
            }
        }
    }

    private func startRecordingWithCountdown() {
        do {
            try recorder.startRecording()
            countdownSeconds = recordingDuration
            isCountingDown = true

            // Start countdown timer
            countdownTask?.cancel()
            countdownTask = Task { @MainActor in
                while countdownSeconds > 0 && !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 1_000_000_000)
                    guard !Task.isCancelled else { return }
                    countdownSeconds -= 1
                }

                // Auto-stop when countdown reaches zero
                guard !Task.isCancelled, recorder.isRecording else { return }
                isCountingDown = false
                _ = recorder.stopRecording()
                uploadCurrentRecording()
            }
        } catch {
            errorMessage = error.localizedDescription
            showingError = true
        }
    }

    private func cancelCountdownAndStopRecording() {
        countdownTask?.cancel()
        countdownTask = nil
        isCountingDown = false
        countdownSeconds = 0

        if recorder.isRecording {
            _ = recorder.stopRecording()
            uploadCurrentRecording()
        }
    }

    private func uploadCurrentRecording() {
        guard let sessionId = sessionId,
              let url = recorder.recordingURL,
              currentPromptIndex < prompts.count else { return }

        let prompt = prompts[currentPromptIndex]
        guard let uploadUrl = uploadUrlsByChunkId[prompt.id] else {
            errorMessage = "Missing upload URL for this prompt. Please restart enrollment."
            showingError = true
            return
        }

        isLoading = true
        Task {
            do {
                let data = try Data(contentsOf: url)
                let durationSec = recorder.recordingDuration() ?? max(0.1, recorder.duration)
                let checksum = SHA256.hash(data: data)
                    .map { String(format: "%02x", $0) }
                    .joined()
                let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "uploadChunk") {
                    try await apiClient.uploadChunk(
                        sessionId: sessionId,
                        chunkId: prompt.id,
                        audioData: data,
                        uploadUrl: uploadUrl,
                        durationSec: durationSec,
                        checksum: checksum
                    )
                }

                await MainActor.run {
                    if response.status == "accepted" {
                        uploadedChunkIds.insert(prompt.id)
                    }
                    recorder.deleteRecording()
                    isLoading = false

                    // Move to next prompt or finish
                    if currentPromptIndex < prompts.count - 1 {
                        currentPromptIndex += 1
                    } else {
                        finalizeEnrollment()
                    }
                }
            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    showingError = true
                    isLoading = false
                }
            }
        }
    }

    private func finalizeEnrollment() {
        guard let sessionId = sessionId else { return }

        withAnimation {
            currentStep = .processing
        }

        pollingTask = Task {
            do {
                let result = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "completeEnrollment") {
                    try await apiClient.completeEnrollment(sessionId: sessionId)
                }

                // Capture outcome from enrollment response
                await MainActor.run {
                    if let outcomeString = result.outcome {
                        enrollmentOutcome = EnrollmentOutcome(rawValue: outcomeString)
                    }
                    if let quality = result.quality {
                        newScore = quality.newScore
                        qualityScore = Int(quality.score)
                    }
                }

                // Poll for completion (check cancellation inside polling loop)
                await pollForVoiceProfile()
            } catch {
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    showingError = true
                    currentStep = .recording
                }
            }
        }
    }

    private func pollForVoiceProfile() async {
        var consecutiveFailures = 0

        for _ in 0..<60 { // 2 minutes max
            // Check for cancellation before sleeping
            guard !Task.isCancelled else { return }

            try? await Task.sleep(nanoseconds: 2_000_000_000) // 2 seconds

            // Check again after sleep (in case cancelled while sleeping)
            guard !Task.isCancelled else { return }

            do {
                let status = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "getVoiceProfile") {
                    try await apiClient.getVoiceProfile()
                }
                consecutiveFailures = 0  // Reset on any successful response

                if status.hasProfile, let score = status.qualityScore {
                    await MainActor.run {
                        // Only update qualityScore if not already set from enrollment response
                        if qualityScore == nil {
                            qualityScore = Int(score)
                        }
                        withAnimation {
                            currentStep = .completed
                        }
                    }
                    return
                }
            } catch {
                consecutiveFailures += 1
                print("[Enrollment] Poll attempt failed (\(consecutiveFailures)): \(error.localizedDescription)")

                // Surface persistent failures after 5 consecutive errors
                if consecutiveFailures >= 5 {
                    await MainActor.run {
                        errorMessage = "Unable to verify voice profile. Please check your connection and try again."
                        showingError = true
                        currentStep = .welcome
                    }
                    return
                }
                continue
            }
        }

        // Timeout (only show if not cancelled)
        guard !Task.isCancelled else { return }
        await MainActor.run {
            errorMessage = "Voice profile processing timed out. Please try again."
            showingError = true
            currentStep = .welcome
        }
    }
}

#Preview {
    RootView()
}
