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
    @State private var shareContext: ShareContext?
    @State private var pendingShareId: String?
    @State private var pendingShareIsPoem: Bool = false
    @AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding = false

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
    }

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

                        // Wire AuthManager to APIClient for Bearer token auth
                        // This allows authenticated users to use JWT tokens instead of device ID
                        // Using closure to bridge @MainActor (AuthManager) and actor (APIClient) isolation

                        // Transition after splash animation (1.5 seconds)
                        Task { @MainActor in
                            try? await Task.sleep(for: .seconds(1.5))
                            withAnimation(.easeInOut(duration: 0.5)) {
                                if hasCompletedOnboarding {
                                    appState = (skipAuth || authManager.isAuthenticated) ? .main : .landing
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
                    onBeginCreating: {
                        // Go to main app in guest mode (device ID auth)
                        withAnimation(.easeInOut(duration: 0.5)) {
                            appState = .main
                        }
                    },
                    onSignIn: {
                        // Show sign-in flow
                        withAnimation(.easeInOut(duration: 0.5)) {
                            appState = .auth
                        }
                    }
                )

            case .main:
                if let client = apiClient {
                    MainTabView(apiClient: client)
                } else {
                    // Fallback - create client if needed
                    MainTabView(apiClient: makeAPIClient(deviceId: getOrCreateDeviceId()))
                }
            case .auth:
                AuthView()
            }
        }
        .onOpenURL { url in
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
        .onChange(of: authManager.isAuthenticated) { _, isAuthenticated in
            if isAuthenticated {
                Task {
                    if let client = apiClient {
                        try? await client.ensureDeviceToken()
                    }
                }
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
            } else if appState == .main && !skipAuth {
                withAnimation(.easeInOut(duration: 0.3)) {
                    appState = .auth
                }
            }
        }
    }

    private func completeOnboarding() {
        hasCompletedOnboarding = true
        withAnimation(.easeInOut(duration: 0.5)) {
            appState = (skipAuth || authManager.isAuthenticated) ? .main : .landing
        }
    }

    private func getOrCreateDeviceId() -> String {
        let key = "porizo_device_id"
        if let existing = UserDefaults.standard.string(forKey: key) {
            return existing
        }
        let newId = "ios_\(UUID().uuidString.prefix(12).lowercased())"
        UserDefaults.standard.set(newId, forKey: key)
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
                try await authManager.refreshTokens()
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
    let onComplete: () -> Void

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

    // Task references for proper cancellation on view disappear
    @State private var enrollmentTask: Task<Void, Never>?
    @State private var pollingTask: Task<Void, Never>?

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

            // Recording button
            Button {
                if recorder.isRecording {
                    stopRecording()
                } else {
                    startRecording()
                }
            } label: {
                ZStack {
                    Circle()
                        .fill(recorder.isRecording ? DesignTokens.error : DesignTokens.gold)
                        .frame(width: 80, height: 80)
                        .accentShadow(color: recorder.isRecording ? DesignTokens.error : DesignTokens.gold)

                    if recorder.isRecording {
                        RoundedRectangle(cornerRadius: 4)
                            .fill(.white)
                            .frame(width: 24, height: 24)
                    } else {
                        Circle()
                            .fill(.white)
                            .frame(width: 24, height: 24)
                    }
                }
            }

            Text(recorder.isRecording ? "Tap to stop" : "Tap to record")
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

            ZStack {
                Circle()
                    .fill(DesignTokens.success.opacity(0.1))
                    .frame(width: 120, height: 120)

                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 64))
                    .foregroundColor(DesignTokens.success)
            }

            VStack(spacing: 12) {
                Text("Voice Profile Ready!")
                    .font(.title.bold())
                    .foregroundColor(DesignTokens.textPrimary)

                if let score = qualityScore {
                    Text("Quality score: \(score)%")
                        .foregroundColor(DesignTokens.textSecondary)
                }

                Text("You can now create personalized songs that sound like you.")
                    .multilineTextAlignment(.center)
                    .foregroundColor(DesignTokens.textSecondary)
                    .padding(.horizontal, 32)
            }

            Spacer()

            Button {
                onComplete()
            } label: {
                Text("Start Creating")
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

    // MARK: - Actions

    private func startEnrollment() {
        isLoading = true
        enrollmentTask = Task {
            do {
                let response = try await apiClient.startEnrollment()
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

    private func startRecording() {
        do {
            try recorder.startRecording()
        } catch {
            errorMessage = error.localizedDescription
            showingError = true
        }
    }

    private func stopRecording() {
        _ = recorder.stopRecording()
        uploadCurrentRecording()
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
                let response = try await apiClient.uploadChunk(
                    sessionId: sessionId,
                    chunkId: prompt.id,
                    audioData: data,
                    uploadUrl: uploadUrl,
                    durationSec: durationSec,
                    checksum: checksum
                )

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
                _ = try await apiClient.completeEnrollment(sessionId: sessionId)
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
        for _ in 0..<60 { // 2 minutes max
            // Check for cancellation before sleeping
            guard !Task.isCancelled else { return }

            try? await Task.sleep(nanoseconds: 2_000_000_000) // 2 seconds

            // Check again after sleep (in case cancelled while sleeping)
            guard !Task.isCancelled else { return }

            do {
                let status = try await apiClient.getVoiceProfile()
                if status.hasProfile, let score = status.qualityScore {
                    await MainActor.run {
                        qualityScore = Int(score)
                        withAnimation {
                            currentStep = .completed
                        }
                    }
                    return
                }
            } catch {
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
