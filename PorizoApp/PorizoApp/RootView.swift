//
//  RootView.swift
//  PorizoApp
//
//  Root view that handles app state: splash → onboarding → main app.
//  Light mode design for love and friendship.
//

import SwiftUI

func emailVerificationToken(from url: URL) -> String? {
    guard url.host == "verify-email" || url.path.hasPrefix("/verify-email") else {
        return nil
    }

    return URLComponents(url: url, resolvingAgainstBaseURL: false)?
        .queryItems?.first(where: { $0.name == "token" })?.value
}

struct CreateDeepLinkContext: Equatable, Sendable {
    let type: CreateFlowKind
    let occasion: Occasion?
    let recipientName: String?
}

enum ShareDeepLinkRoute: Equatable {
    case present
    case authenticate(message: String)
}

func resolveShareDeepLinkRoute(isPoem: Bool, canPresentClaim: Bool) -> ShareDeepLinkRoute {
    if canPresentClaim {
        return .present
    }
    return .authenticate(
        message: isPoem
            ? "Sign in to read your shared poem"
            : "Sign in to listen to your shared song"
    )
}

func parseCreateDeepLink(from url: URL) -> CreateDeepLinkContext? {
    guard url.host == "create" || url.pathComponents.contains("create") else {
        return nil
    }

    let queryItems = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
    func queryValue(_ names: String...) -> String? {
        for name in names {
            if let value = queryItems.first(where: { $0.name == name })?.value?
                .trimmingCharacters(in: .whitespacesAndNewlines),
               !value.isEmpty {
                return value
            }
        }
        return nil
    }

    let typeRaw = queryValue("type", "kind")?.lowercased()
    let type = typeRaw.flatMap(CreateFlowKind.init(rawValue:)) ?? .song
    let occasion = queryValue("occasion").flatMap(occasionFromDeepLinkValue)
    let recipientName = queryValue("recipient", "recipient_name", "name")

    return CreateDeepLinkContext(
        type: type,
        occasion: occasion,
        recipientName: recipientName
    )
}

private func occasionFromDeepLinkValue(_ value: String) -> Occasion? {
    let normalized = value
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .lowercased()
        .replacingOccurrences(of: "'", with: "")
        .replacingOccurrences(of: " ", with: "_")
        .replacingOccurrences(of: "-", with: "_")

    switch normalized {
    case "mothersday", "mothers_day", "mother_day":
        return .mothersDay
    default:
        return Occasion(rawValue: normalized)
            ?? Occasion.allCases.first { $0.displayName.lowercased() == value.lowercased() }
    }
}

struct RootAppConfigState: Equatable, Sendable {
    var onboardingSampleURL: String?
    var onboardingSplashRecipient: String?
    var onboardingSplashLyricsPreview: String?
    var launchFlashSampleURL: String?
    var launchFlashTitle: String?
    var launchFlashRecipient: String?
    var launchFlashLyricsPreview: String?
    var onboardingGraphVersion: Int?
    var onboardingGraphUrl: String?

    init(response: AppConfigResponse? = nil) {
        onboardingSampleURL = response?.onboarding?.sampleAudioUrl
        onboardingSplashRecipient = response?.onboarding?.splashDemoRecipient
        onboardingSplashLyricsPreview = response?.onboarding?.splashLyricsPreview
        launchFlashSampleURL = response?.onboarding?.launchFlashAudioUrl
        launchFlashTitle = response?.onboarding?.launchFlashTitle
        launchFlashRecipient = response?.onboarding?.launchFlashRecipient
        launchFlashLyricsPreview = response?.onboarding?.launchFlashLyricsPreview
        onboardingGraphVersion = response?.onboarding?.questionGraphVersion
        onboardingGraphUrl = response?.onboarding?.questionGraphUrl
    }

    var onboardingConfig: OnboardingConfig {
        OnboardingConfig(
            sampleAudioUrl: onboardingSampleURL,
            sampleLabel: nil,
            splashDemoRecipient: onboardingSplashRecipient,
            splashLyricsPreview: onboardingSplashLyricsPreview,
            launchFlashAudioUrl: launchFlashSampleURL,
            launchFlashTitle: launchFlashTitle,
            launchFlashRecipient: launchFlashRecipient,
            launchFlashLyricsPreview: launchFlashLyricsPreview,
            questionGraphVersion: onboardingGraphVersion,
            questionGraphUrl: onboardingGraphUrl
        )
    }
}

struct RootView: View {
    @Environment(AuthManager.self) var authManager
    @State private var appState: RootState = .splash
    @State private var apiClient: APIClient?
    @State private var apiWrapper: APIClientWrapper?
    @State private var sttRouter: STTRouter?
    @State private var shareContext: ShareContext?
    @State private var pendingShareId: String?
    @State private var pendingShareIsPoem: Bool = false
    @State private var apiClientReady: Bool = false
    @State private var authContextMessage: String?
    @Environment(StyleStore.self) private var styleStore
    @State private var appUpdatePrompt: AppUpdatePrompt?
    // Persists across cold launches so tapping "Later" on the recommended-update
    // sheet actually suppresses re-prompts until a newer version arrives.
    @AppStorage("dismissedRecommendedUpdateVersion") private var dismissedRecommendedUpdateVersion: String = ""
    @State private var profileCompletionContext: ProfileCompletionContext?
    @AppStorage("onboardingCompletionVersion") private var onboardingCompletionVersion = 0
    @AppStorage("pendingRecipientName") private var pendingRecipientName = ""
    @AppStorage("pendingOccasion") private var pendingOccasion = ""
    @AppStorage("pendingCreateType") private var pendingCreateType = ""
    @AppStorage("pendingEmotionalSeed") private var pendingEmotionalSeed = ""
    @AppStorage("pendingRelationshipType") private var pendingRelationshipType = ""
    @AppStorage("pendingSuggestion") private var pendingSuggestion = ""
    @AppStorage("pendingCreateAutostart") private var pendingCreateAutostart = false
    // Launch Flash state (TikTok-style auto-play on every cold launch / 10+min warm resume)
    @AppStorage("launchFlashMode") private var launchFlashModeRaw: String = "all"
    @AppStorage("launchFlashFailureCount") private var launchFlashFailureCount: Int = 0
    // Epoch of the most recent failure-count increment. Used to age out a stuck
    // breaker — if the user had 3 bad launches days ago, they shouldn't lose the
    // flash forever. A genuine rapid-kill loop keeps bumping this close to "now".
    @AppStorage("launchFlashLastFailureAtEpoch") private var launchFlashLastFailureAtEpoch: Double = 0
    @AppStorage("lastBackgroundedAtEpoch") private var lastBackgroundedAtEpoch: Double = 0
    @State private var pendingLaunchFlashContent: LaunchFlashContent?
    @State private var launchFlashShownAt: Date?
    @State private var previousScenePhase: ScenePhase = .active
    @Environment(\.scenePhase) private var scenePhase
    // Persists across cold launches so dismissing the sheet suppresses it for 7 days
    // instead of re-firing every app start. Stored as Unix epoch; 0 means never skipped.
    @AppStorage("profileCompletionSkippedAtEpoch") private var profileCompletionSkippedAtEpoch: Double = 0
    @State private var appConfigState = RootAppConfigState()

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
        case onboardingV2
        case launchFlash
        case auth
        case main
        #if DEBUG
        case designSamples
        #endif
    }

    private var launchFlashMode: LaunchFlashMode {
        LaunchFlashMode(rawValue: launchFlashModeRaw) ?? .all
    }

    #if DEBUG
    private let showDesignSamples: Bool = {
        ProcessInfo.processInfo.arguments.contains("--design-samples")
        || UserDefaults.standard.bool(forKey: "showDesignSamples")
    }()

    /// Reset onboarding state for validation testing.
    /// Usage: launch_app_sim(args: ["--reset-onboarding", "--bypass-auth"])
    private let resetOnboarding: Bool = ProcessInfo.processInfo.arguments.contains("--reset-onboarding")
    private let launchesValidationFixture: Bool = {
        let args = ProcessInfo.processInfo.arguments
        return args.contains("--fixture-reveal")
            || args.contains("--fixture-reveal-ready")
            || args.contains("--fixture-creating")
    }()
    #endif

    struct ShareContext: Identifiable {
        let id = UUID()
        let shareId: String
        let isPoem: Bool  // true = poem share, false = track share
    }

    struct ProfileCompletionContext: Identifiable {
        let id = UUID()
        let apiClient: APIClient
    }

    var body: some View {
        Group {
            switch appState {
            case .splash:
                SplashView()
                    .onAppear {
                        #if DEBUG
                        if resetOnboarding {
                            let keys = ["hasCompletedOnboarding", "onboardingCompletionVersion", "pendingRecipientName", "pendingOccasion",
                                         "pendingCreateType", "pendingEmotionalSeed", "pendingRelationshipType",
                                         "pendingSuggestion", "pendingCreateAutostart",
                                         // Launch flash state — reset for clean test runs
                                         "recentLaunchFlashTrackIds", "lastBackgroundedAtEpoch",
                                         "launchFlashFailureCount", "launchFlashLastFailureAtEpoch",
                                         "pendingSuggestionShowCount", "pendingSuggestionSetAt"]
                            keys.forEach { UserDefaults.standard.removeObject(forKey: $0) }
                        }
                        #endif

                        // Initialize API client with device ID as fallback
                        let deviceId = getOrCreateDeviceId()
                        let client = makeAPIClient(deviceId: deviceId)
                        apiClient = client
                        apiClientReady = true
                        apiWrapper = APIClientWrapper(client: client)
                        syncProfileCompletionContext()

                        // Initialize STT router with the authenticated API client
                        let router = STTRouter(apiClient: client)
                        sttRouter = router

                        // Wire AuthManager to APIClient for Bearer token auth
                        // This allows authenticated users to use JWT tokens instead of device ID
                        // Using closure to bridge @MainActor (AuthManager) and actor (APIClient) isolation

                        // Transition after splash animation (1.5 seconds)
                        // Also fetch STT config in parallel for faster first transcription
                        Task { @MainActor in
                            // Non-blocking: styles have compiled-in defaults, picker updates reactively
                            Task { await styleStore.load(from: client) }
                            await refreshAppConfig(using: client, router: router)

                            try? await Task.sleep(for: .seconds(1.5))
                            withAnimation(.easeInOut(duration: 0.5)) {
                                #if DEBUG
                                if showDesignSamples {
                                    appState = .designSamples
                                    return
                                }
                                if launchesValidationFixture {
                                    appState = .main
                                    return
                                }
                                #endif
                                normalizeLegacyOnboardingCompletionIfNeeded()
                                if hasCompletedOnboardingFlow {
                                    appState = nextStateAfterSplash()
                                } else {
                                    appState = .onboardingV2
                                }
                            }
                        }
                    }

            case .launchFlash:
                if let content = pendingLaunchFlashContent {
                    LaunchFlashView(
                        content: content,
                        apiClient: apiClient,
                        onDismiss: { dismissLaunchFlash() },
                        onPrimaryActionRequested: { handleLaunchFlashPrimaryAction() },
                        onDisableRequested: {
                            launchFlashModeRaw = LaunchFlashMode.off.rawValue
                            AnalyticsService.shared.log(.launchFlashDisabled, properties: [
                                "source": "long_press"
                            ])
                        }
                    )
                } else {
                    // Safety: should never render .launchFlash without content — fall through
                    SplashView()
                        .onAppear {
                            appState = routeToMainOrAuth()
                        }
                }

            case .onboardingV2:
                if let client = apiClient {
                    OnboardingV2View(
                        splashDemoURL: appConfigState.onboardingSampleURL,
                        splashRecipientLabel: appConfigState.onboardingSplashRecipient,
                        splashLyricsPreview: appConfigState.onboardingSplashLyricsPreview,
                        questionGraphVersion: appConfigState.onboardingGraphVersion,
                        questionGraphUrl: appConfigState.onboardingGraphUrl,
                        apiClient: client,
                        onComplete: { result in completeOnboardingV2(result) },
                        onSkip: { partial in skipOnboardingV2(partial) }
                    )
                } else {
                    SplashView()
                }

            #if DEBUG
            case .designSamples:
                DesignSampleView()
            #endif

            case .main:
                if let client = apiClient, let router = sttRouter {
                    MainTabView(
                        apiClient: client,
                        pendingRecipientName: pendingRecipientName.isEmpty ? nil : pendingRecipientName,
                        pendingOccasion: resolvedPendingOccasion,
                        pendingType: resolvedPendingCreateType,
                        pendingEmotionalSeed: pendingEmotionalSeed.isEmpty ? nil : pendingEmotionalSeed,
                        pendingRelationshipType: pendingRelationshipType.isEmpty ? nil : pendingRelationshipType,
                        shouldAutoLaunchPendingCreate: pendingCreateAutostart,
                        onConsumePendingCreateContext: clearPendingCreateContext
                    )
                        .environment(router)
                } else {
                    // Fallback - create client if needed
                    let fallbackClient = makeAPIClient(deviceId: getOrCreateDeviceId())
                    MainTabView(
                        apiClient: fallbackClient,
                        pendingRecipientName: pendingRecipientName.isEmpty ? nil : pendingRecipientName,
                        pendingOccasion: resolvedPendingOccasion,
                        pendingType: resolvedPendingCreateType,
                        pendingEmotionalSeed: pendingEmotionalSeed.isEmpty ? nil : pendingEmotionalSeed,
                        pendingRelationshipType: pendingRelationshipType.isEmpty ? nil : pendingRelationshipType,
                        shouldAutoLaunchPendingCreate: pendingCreateAutostart,
                        onConsumePendingCreateContext: clearPendingCreateContext
                    )
                        .environment(sttRouter ?? STTRouter(apiClient: fallbackClient))
                }
            case .auth:
                if let apiWrapper {
                    AuthView(contextMessage: authContextMessage)
                        .environment(apiWrapper)
                } else {
                    AuthView(contextMessage: authContextMessage)
                        .environment(APIClientWrapper(baseURL: serverURL))
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
            if context.isPoem {
                PoemClaimView(
                    apiClient: shareClient,
                    shareId: context.shareId
                )
            } else {
                ShareClaimView(
                    apiClient: shareClient,
                    shareId: context.shareId,
                    deviceId: getOrCreateDeviceId()
                )
            }
        }
        .sheet(item: $profileCompletionContext, onDismiss: {
            if authManager.needsProfileCompletion {
                profileCompletionSkippedAtEpoch = Date().timeIntervalSince1970
                authManager.dismissProfileCompletion()
            }
        }) { context in
            ProfileCompletionView(apiClient: context.apiClient)
                .environment(authManager)
        }
        .onReceive(NotificationCenter.default.publisher(for: .trackRenderCompleted)) { notification in
            // Handle render completion at app level (e.g., from push notification)
            // Views like MySongsView will also receive this and refresh their data
            #if DEBUG
            print("[RootView] Received trackRenderCompleted notification")
            #endif
        }
        .onChange(of: scenePhase) { _, newPhase in
            handleScenePhaseChange(to: newPhase)
        }
        .onChange(of: authManager.isAuthenticated) { _, isAuthenticated in
            if isAuthenticated {
                // Retention metric: fires on cold-launch session restore AND
                // fresh sign-in (both are session starts). Distinct from
                // auth_completed which is acquisition-only (fresh sign-ins).
                AnalyticsService.shared.log(
                    .sessionResumed,
                    properties: ["trigger": "auth_change"]
                )
                profileCompletionSkippedAtEpoch = 0
                syncProfileCompletionContext()
                authContextMessage = nil
                if appState == .launchFlash {
                    dismissLaunchFlash(reason: "auth_change", routeOverride: .main, shouldLog: true)
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
            } else if hasCompletedOnboardingFlow && !skipAuth && appState != .auth {
                clearPendingCreateContext()
                profileCompletionContext = nil
                authContextMessage = nil
                if appState == .launchFlash {
                    dismissLaunchFlash(reason: "auth_change", routeOverride: .auth, shouldLog: true)
                } else {
                    withAnimation(.easeInOut(duration: 0.3)) {
                        appState = .auth
                    }
                }
            }
        }
        .onChange(of: authManager.needsProfileCompletion) { _, _ in
            syncProfileCompletionContext()
        }
        .onChange(of: apiClientReady) { _, _ in
            syncProfileCompletionContext()
        }
        .onChange(of: authManager.hasValidatedSession) { _, hasValidated in
            guard hasValidated else { return }
            Task {
                if let client = apiClient {
                    await registerDeviceIfReady(using: client, reason: "session_validated", needsShareToken: true)
                    await AppleAdsAttributionService.submitPendingIfPossible(
                        using: client,
                        isAuthenticated: authManager.isAuthenticated
                    )
                    await JobRecoveryService.checkPendingRenders(using: client)
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .appleAdsAttributionTokenCaptured)) { notification in
            guard let token = notification.userInfo?["token"] as? String else { return }
            AppleAdsAttributionService.storePendingToken(token)
            Task {
                await AppleAdsAttributionService.submitPendingIfPossible(
                    using: apiClient,
                    isAuthenticated: authManager.isAuthenticated
                )
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .pushTokenUpdated)) { _ in
            // Re-register device when APNs token changes (ensures server has latest push token)
            guard authManager.isAuthenticated, let client = apiClient else { return }
            Task {
                await registerDeviceIfReady(using: client, reason: "push_token_updated", needsShareToken: false)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .appReturnedToForeground)) { _ in
            guard let client = apiClient else { return }
            Task { @MainActor in
                await refreshAppConfig(using: client, router: nil)
            }
        }
        .fullScreenCover(item: requiredUpdateBinding) { prompt in
            AppUpdatePromptView(
                prompt: prompt,
                onUpdate: { openAppStore(for: prompt) },
                onLater: nil
            )
            .interactiveDismissDisabled(true)
        }
        .sheet(item: recommendedUpdateBinding) { prompt in
            AppUpdatePromptView(
                prompt: prompt,
                onUpdate: { openAppStore(for: prompt) },
                onLater: {
                    dismissedRecommendedUpdateVersion = prompt.targetVersion
                    appUpdatePrompt = nil
                }
            )
            .presentationDetents([.medium])
        }
    }

    // MARK: - Computed Bindings (extracted from presentation modifiers)

    /// APIClient for share sheets — uses existing @State client, avoids creating objects in ViewBuilder.
    private var shareClient: APIClient {
        apiClient ?? makeAPIClient(deviceId: getOrCreateDeviceId())
    }

    private var requiredUpdateBinding: Binding<AppUpdatePrompt?> {
        Binding(
            get: { appUpdatePrompt?.kind == .required ? appUpdatePrompt : nil },
            set: { _ in }
        )
    }

    private var recommendedUpdateBinding: Binding<AppUpdatePrompt?> {
        Binding(
            get: { appUpdatePrompt?.kind == .recommended ? appUpdatePrompt : nil },
            set: { newValue in
                if newValue == nil, let prompt = appUpdatePrompt, prompt.kind == .recommended {
                    dismissedRecommendedUpdateVersion = prompt.targetVersion
                    appUpdatePrompt = nil
                }
            }
        )
    }

    private var resolvedPendingOccasion: Occasion? {
        guard !pendingOccasion.isEmpty else { return nil }
        return Occasion(rawValue: pendingOccasion)
            ?? Occasion.allCases.first { $0.displayName == pendingOccasion }
    }

    private var resolvedPendingCreateType: CreateFlowKind? {
        guard !pendingCreateType.isEmpty else { return nil }
        return CreateFlowKind(rawValue: pendingCreateType)
    }

    private func completeOnboardingV2(_ result: OnboardingResult) {
        pendingRecipientName = result.recipientName
        pendingOccasion = result.occasion ?? ""
        pendingEmotionalSeed = result.emotionalSeed
        pendingRelationshipType = result.relationshipType
        pendingCreateType = CreateFlowKind.song.rawValue
        pendingCreateAutostart = true

        if let suggestion = result.suggestion {
            PendingSuggestionStore.store(
                suggestion: suggestion,
                recipientName: result.recipientName,
                occasion: result.occasion,
                emotionalSeed: result.emotionalSeed,
                relationshipType: result.relationshipType,
                createTypeRaw: CreateFlowKind.song.rawValue
            )
            if let encoded = try? JSONEncoder().encode(suggestion),
               let json = String(data: encoded, encoding: .utf8) {
                pendingSuggestion = json
            }
        } else {
            PendingSuggestionStore.clear()
            pendingSuggestion = ""
        }

        markOnboardingCompleted()

        withAnimation(.easeInOut(duration: 0.5)) {
            if authManager.isAuthenticated {
                appState = .main
            } else {
                authContextMessage = "Sign in to make this song for \(result.recipientName)"
                appState = .auth
            }
        }
        syncProfileCompletionContext()
    }

    private func skipOnboardingV2(_ partial: PartialOnboardingResult?) {
        markOnboardingCompleted()

        if let partial {
            PendingSuggestionStore.store(
                suggestion: partial.suggestion,
                recipientName: partial.recipientName,
                occasion: partial.occasion,
                emotionalSeed: partial.emotionalSeed,
                relationshipType: partial.relationshipType,
                createTypeRaw: CreateFlowKind.song.rawValue
            )
            if let encoded = try? JSONEncoder().encode(partial.suggestion),
               let json = String(data: encoded, encoding: .utf8) {
                pendingSuggestion = json
            }
            pendingRecipientName = partial.recipientName
            pendingOccasion = partial.occasion ?? ""
            pendingEmotionalSeed = partial.emotionalSeed
            pendingRelationshipType = partial.relationshipType
            pendingCreateType = CreateFlowKind.song.rawValue
        } else {
            PendingSuggestionStore.clear()
            pendingSuggestion = ""
            pendingRecipientName = ""
            pendingOccasion = ""
            pendingEmotionalSeed = ""
            pendingRelationshipType = ""
            pendingCreateType = ""
        }
        pendingCreateAutostart = false

        withAnimation(.easeInOut(duration: 0.5)) {
            appState = .main
        }
    }

    private func clearPendingCreateContext() {
        PendingSuggestionStore.clear()
        pendingRecipientName = ""
        pendingOccasion = ""
        pendingCreateType = ""
        pendingEmotionalSeed = ""
        pendingRelationshipType = ""
        pendingSuggestion = ""
        pendingCreateAutostart = false
    }

    // MARK: - Launch Flash

    /// Decide whether to show the launch flash on splash dismiss, or skip
    /// straight to main/auth. Follows priority from design doc §"State Machine".
    private func nextStateAfterSplash() -> RootState {
        #if DEBUG
        // DEBUG fixture flags always bypass the launch flash.
        if launchesValidationFixture { return .main }
        #endif

        // Age-out the breaker: if the last failure is stale (>6h) — or the
        // timestamp was never recorded, which is the case for devices that
        // tripped the breaker before this code shipped — treat the stored
        // count as stale and reset. A real rapid-kill loop keeps the timestamp
        // fresh, so this only recovers stuck state.
        let failureAgeSeconds = Date().timeIntervalSince1970 - launchFlashLastFailureAtEpoch
        let breakerIsStale = launchFlashFailureCount > 0
            && (launchFlashLastFailureAtEpoch == 0 || failureAgeSeconds > 6 * 60 * 60)
        if breakerIsStale {
            launchFlashFailureCount = 0
        }

        let shouldAttemptFlash = LaunchFlashGate.shouldAttemptFlash(
            hasPendingNavigationIntent: pendingShareId != nil,
            isAuthenticated: authManager.isAuthenticated,
            skipAuth: skipAuth,
            mode: launchFlashMode,
            failureCount: launchFlashFailureCount
        )
        guard shouldAttemptFlash else {
            if launchFlashFailureCount >= 3 {
                AnalyticsService.shared.log(.launchFlashFailed, properties: [
                    "error_type": "circuit_breaker_open",
                    "failure_count": "\(launchFlashFailureCount)"
                ])
            }
            return routeToMainOrAuth()
        }

        // Resolve content — if nothing to show, skip flash without
        // touching the circuit breaker. Empty libraries / missing demo
        // config aren't failures.
        let onboardingConfig = makeOnboardingConfigForResolver()
        let resolver = LaunchFlashResolver(
            source: LiveLaunchFlashContentSource(),
            onboardingConfig: onboardingConfig
        )
        guard let content = resolver.resolve(mode: launchFlashMode) else {
            return routeToMainOrAuth()
        }

        // Bump failure count BEFORE risky work; dismissLaunchFlash() resets
        // on successful completion. Doing this AFTER the resolve guard means
        // an empty-library + fast-kill loop can never trip the breaker for a
        // user who never actually got a flash.
        launchFlashFailureCount += 1
        launchFlashLastFailureAtEpoch = Date().timeIntervalSince1970

        #if DEBUG
        print("[LaunchFlash] Resolved content — source: \(content.source.rawValue), trackId: \(content.trackId ?? "nil"), audioURL: \(content.audioURL?.absoluteString ?? "nil"), title: \(content.title)")
        #endif

        // Record history at decision time (per spec: guarantees rotation even on fast-kill)
        LaunchFlashHistory.record(trackId: content.trackId)

        // If the suggestion was shown, increment its counter so the 5-show cap can fire
        if content.source == .suggestion {
            PendingSuggestionStore.markShown()
        }

        // Store content for the view and transition
        pendingLaunchFlashContent = content
        launchFlashShownAt = Date()

        // audio_attempted == true if we have a URL OR we'll lazy-fetch one (owned tracks)
        let willAttemptAudio = content.audioURL != nil || content.trackId != nil
        AnalyticsService.shared.log(.launchFlashShown, properties: [
            "source": content.source.rawValue,
            "audio_attempted": willAttemptAudio ? "true" : "false",
            "track_id": content.trackId ?? ""
        ])

        return .launchFlash
    }

    /// Helper for the non-flash path after splash (or failure path).
    private func routeToMainOrAuth() -> RootState {
        (skipAuth || authManager.isAuthenticated) ? .main : .auth
    }

    /// Transition out of the launch flash to the main app or auth.
    private func dismissLaunchFlash(
        reason: String = "tap",
        routeOverride: RootState? = nil,
        shouldLog: Bool = false
    ) {
        if shouldLog {
            let durationMs = launchFlashShownAt.map { Int(Date().timeIntervalSince($0) * 1000) } ?? 0
            AnalyticsService.shared.log(.launchFlashDismissed, properties: [
                "duration_ms": "\(durationMs)",
                "audio_finished_naturally": "false",
                "dismissal_type": reason,
            ])
        }
        // Reset failure count on successful completion
        if launchFlashFailureCount > 0 {
            launchFlashFailureCount = 0
            launchFlashLastFailureAtEpoch = 0
        }
        pendingLaunchFlashContent = nil
        launchFlashShownAt = nil
        withAnimation(.easeInOut(duration: 0.35)) {
            appState = routeOverride ?? routeToMainOrAuth()
        }
    }

    private func handleLaunchFlashPrimaryAction() {
        guard pendingLaunchFlashContent?.source == .suggestion else {
            dismissLaunchFlash()
            return
        }
        if let context = PendingSuggestionStore.loadIfActive() {
            pendingRecipientName = context.recipientName
            pendingOccasion = context.occasion ?? ""
            pendingEmotionalSeed = context.emotionalSeed ?? ""
            pendingRelationshipType = context.relationshipType ?? ""
            pendingCreateType = context.createTypeRaw ?? CreateFlowKind.song.rawValue
        }
        pendingCreateAutostart = true
        dismissLaunchFlash(reason: "primary_cta", routeOverride: .main, shouldLog: true)
    }

    /// Build an OnboardingConfig for the resolver using the cached splash demo fields.
    /// The resolver reads these for the .demo content path.
    private func makeOnboardingConfigForResolver() -> OnboardingConfig {
        appConfigState.onboardingConfig
    }

    /// Scene phase handler: tracks `lastBackgroundedAtEpoch` for warm resume detection.
    /// iOS delivers transitions as .active→.inactive→.background and .background→.inactive→.active.
    /// We track the LAST STABLE phase (.active or .background) so .inactive interim states
    /// don't clobber our state. Without this, the .background→.inactive→.active sequence
    /// would update `previousScenePhase` to .inactive mid-stream and the read branch
    /// (.background → .active) would never match.
    private func handleScenePhaseChange(to newPhase: ScenePhase) {
        // Skip .inactive entirely — it's a transient state, not a destination
        guard newPhase != .inactive else { return }

        defer { previousScenePhase = newPhase }

        // Write timestamp on entering .background (from any prior stable phase)
        if newPhase == .background {
            lastBackgroundedAtEpoch = Date().timeIntervalSince1970
        }

        // On returning to .active from background, evaluate warm-resume flash
        if previousScenePhase == .background && newPhase == .active {
            evaluateWarmResumeForLaunchFlash()
            // Retention metric — counts warm resumes for authenticated users.
            // Cold-launch path is covered by the isAuthenticated onChange emit,
            // so these two hooks partition the space without double-counting.
            if authManager.isAuthenticated {
                AnalyticsService.shared.log(
                    .sessionResumed,
                    properties: ["trigger": "warm_resume"]
                )
            }
        }
    }

    /// On warm resume past the 10-minute threshold, re-show the launch flash.
    /// Only applies when the user is in .main or .auth (not .onboardingV2, .launchFlash, .splash).
    private func evaluateWarmResumeForLaunchFlash() {
        guard hasCompletedOnboardingFlow else { return }
        guard appState == .main || appState == .auth else { return }
        guard launchFlashMode != .off else { return }

        // No prior backgrounded timestamp = no warm resume to evaluate (cold launch
        // path is handled by splash.onAppear). Return cleanly without re-firing.
        guard lastBackgroundedAtEpoch > 0 else { return }

        let now = Date().timeIntervalSince1970
        let delta = now - lastBackgroundedAtEpoch

        // Sanity clamp: negative (clock went back) treats as cold; otherwise 10-min threshold.
        let isFreshSession = delta < 0 || delta >= 600
        guard isFreshSession else { return }

        appState = nextStateAfterSplash()
    }

    private func syncProfileCompletionContext() {
        // Suppress the sheet for 7 days after the user dismisses it, so users who
        // genuinely have nothing on file still have a path to "skip and get on with it"
        // without being re-prompted on every cold launch.
        let skipWindowSeconds: TimeInterval = 7 * 24 * 60 * 60
        let secondsSinceSkip = Date().timeIntervalSince1970 - profileCompletionSkippedAtEpoch
        // Reject negative deltas (device clock moved backward) so a rollback can't
        // indefinitely extend the suppression.
        let isWithinSkipWindow = profileCompletionSkippedAtEpoch > 0
            && secondsSinceSkip >= 0
            && secondsSinceSkip < skipWindowSeconds

        guard authManager.needsProfileCompletion,
              !isWithinSkipWindow,
              let client = apiClient else {
            profileCompletionContext = nil
            return
        }

        if profileCompletionContext == nil {
            profileCompletionContext = ProfileCompletionContext(apiClient: client)
        }
    }

    private var legacyHasCompletedOnboarding: Bool {
        UserDefaults.standard.object(forKey: "hasCompletedOnboarding") as? Bool ?? false
    }

    private var hasCompletedOnboardingFlow: Bool {
        OnboardingCompletionGate.isCompleted(
            completionVersion: onboardingCompletionVersion,
            legacyCompleted: legacyHasCompletedOnboarding,
            isAuthenticated: authManager.isAuthenticated,
            hasPendingSuggestion: !pendingSuggestion.isEmpty,
            hasPendingRecipient: !pendingRecipientName.isEmpty,
            hasPendingAutostart: pendingCreateAutostart
        )
    }

    private func normalizeLegacyOnboardingCompletionIfNeeded() {
        guard onboardingCompletionVersion < OnboardingCompletionGate.currentVersion else { return }
        guard OnboardingCompletionGate.shouldMigrateLegacyCompletion(
            legacyCompleted: legacyHasCompletedOnboarding,
            isAuthenticated: authManager.isAuthenticated,
            hasPendingSuggestion: !pendingSuggestion.isEmpty,
            hasPendingRecipient: !pendingRecipientName.isEmpty,
            hasPendingAutostart: pendingCreateAutostart
        ) else { return }

        onboardingCompletionVersion = OnboardingCompletionGate.currentVersion
        UserDefaults.standard.removeObject(forKey: "hasCompletedOnboarding")
    }

    private func markOnboardingCompleted() {
        onboardingCompletionVersion = OnboardingCompletionGate.currentVersion
        UserDefaults.standard.removeObject(forKey: "hasCompletedOnboarding")
    }

    private func handleEmailVerification(token: String) {
        guard let client = apiClient else {
            ToastService.shared.error("Please reopen the verification link after the app finishes loading.")
            return
        }
        Task { @MainActor in
            do {
                try await client.verifyEmailToken(token)
                try? await authManager.fetchCurrentUser()
                profileCompletionContext = nil
                ToastService.shared.success("Email verified!")
            } catch let error as APIClientError {
                if case .serverError(_, let code, _) = error, code == "E119_EMAIL_CONFLICT" {
                    ToastService.shared.error("This email is already linked to another account.")
                } else {
                    ToastService.shared.error("Verification failed. The link may have expired.")
                }
            } catch {
                ToastService.shared.error("Verification failed. Please check your connection.")
            }
        }
    }

    private func handleIncomingURL(_ url: URL) {
        // First pass to TikTok SDK so Share Kit callbacks are resolved.
        if TikTokShareService.shared.handleIncomingURL(url) {
            return
        }

        // Handle email verification deep link: porizo://verify-email?token=XXX
        if let token = emailVerificationToken(from: url) {
            if !token.isEmpty {
                handleEmailVerification(token: token)
            } else {
                ToastService.shared.error("Invalid verification link. Please request a new one.")
            }
            return
        }

        if let createContext = parseCreateDeepLink(from: url) {
            handleCreateDeepLink(createContext)
            return
        }

        guard let parsed = parseShareUrl(from: url) else { return }
        let deviceId = getOrCreateDeviceId()
        if apiClient == nil {
            apiClient = makeAPIClient(deviceId: deviceId)
            apiClientReady = true
        }
        switch resolveShareDeepLinkRoute(isPoem: parsed.isPoem, canPresentClaim: skipAuth || authManager.isAuthenticated) {
        case .present:
            if appState == .launchFlash {
                dismissLaunchFlash(reason: "deep_link", routeOverride: .main, shouldLog: true)
            }
            shareContext = ShareContext(shareId: parsed.shareId, isPoem: parsed.isPoem)
        case .authenticate(let message):
            pendingShareId = parsed.shareId
            pendingShareIsPoem = parsed.isPoem
            authContextMessage = message
            if appState == .launchFlash {
                dismissLaunchFlash(reason: "deep_link", routeOverride: .auth, shouldLog: true)
            } else {
                appState = .auth
            }
        }
    }

    private func handleCreateDeepLink(_ context: CreateDeepLinkContext) {
        pendingCreateType = context.type.rawValue
        pendingOccasion = context.occasion?.rawValue ?? ""
        if let recipientName = context.recipientName {
            pendingRecipientName = recipientName
        }
        pendingCreateAutostart = true
        authContextMessage = nil

        if appState == .launchFlash {
            dismissLaunchFlash(reason: "create_deep_link", routeOverride: routeToMainOrAuth(), shouldLog: true)
        } else {
            appState = routeToMainOrAuth()
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

    /// Creates an APIClient and asynchronously wires auth providers on the next MainActor tick.
    /// The client handles missing providers gracefully (returns nil token) so the brief race
    /// window before providers are set is acceptable — no requests fire before the splash completes.
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
                    #if DEBUG
                    print("[Auth] Token fetch failed: \(error.localizedDescription)")
                    #endif
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

    @MainActor
    private func refreshAppConfig(using client: APIClient, router: STTRouter?) async {
        do {
            let response = try await client.getAppConfig()
            router?.applyAppConfig(response)

            // Amplitude iOS client key is served via remote config so it can
            // be rotated or killed without shipping a new App Store build.
            // Nil / missing key keeps Amplitude disabled; no other path changes.
            AnalyticsService.shared.configureAmplitude(apiKey: response.analytics?.amplitudeApiKey)
            appConfigState = RootAppConfigState(response: response)

            let nextPrompt = AppUpdatePolicy.evaluate(config: response.appUpdate)
            if let nextPrompt,
               nextPrompt.kind == .recommended,
               !dismissedRecommendedUpdateVersion.isEmpty,
               dismissedRecommendedUpdateVersion == nextPrompt.targetVersion {
                return
            }
            // Clear a stale dismissal once the user is on (or past) the dismissed version —
            // prevents future genuine prompts from being suppressed by an old cached value.
            if AppUpdatePolicy.shouldClearDismissal(dismissedRecommendedUpdateVersion) {
                dismissedRecommendedUpdateVersion = ""
            }
            appUpdatePrompt = nextPrompt
        } catch {
            if let router {
                await router.fetchConfig()
            }
        }
    }

    private func openAppStore(for prompt: AppUpdatePrompt) {
        UIApplication.shared.open(prompt.appStoreURL)
    }

    @MainActor
    private func registerDeviceIfReady(
        using client: APIClient,
        reason: String,
        needsShareToken: Bool
    ) async {
        guard authManager.isAuthenticated else { return }
        do {
            if needsShareToken {
                _ = try await client.ensureDeviceToken()
            } else {
                _ = try await client.registerDevice(appVersion: APIClient.appVersion)
            }
            #if DEBUG
            print("[Push] Device registration succeeded (\(reason))")
            #endif
        } catch {
            print("[Push] Device registration failed (\(reason)): \(error.localizedDescription)")
        }
    }
}

#Preview {
    RootView()
}
