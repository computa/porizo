//
//  RootView.swift
//  PorizoApp
//
//  Root view that handles app state: splash → onboarding → main app.
//  Light mode design for love and friendship.
//

import SwiftUI
import UIKit

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
    @State private var dismissedRecommendedUpdateVersion: String?
    @State private var profileCompletionContext: ProfileCompletionContext?
    @AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding = false
    @AppStorage("onboardingViewCount") private var onboardingViewCount = 0
    @AppStorage("hasCompletedFirstSong") private var hasCompletedFirstSong = false
    @AppStorage("pendingRecipientName") private var pendingRecipientName = ""
    @AppStorage("pendingOccasion") private var pendingOccasion = ""
    @State private var hasSkippedProfileCompletionInSession = false
    @State private var nameEntryHasOwnLyrics = false
    @State private var nameEntryIsInstrumental = false
    @State private var onboardingSampleURL: String?

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
        case nameEntry
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
                                #endif
                                // Show onboarding up to 2 times until first song is generated
                                let shouldShowOnboarding = onboardingViewCount < 2 && !hasCompletedFirstSong
                                if hasCompletedOnboarding && !shouldShowOnboarding {
                                    appState = (skipAuth || authManager.isAuthenticated) ? .main : .auth
                                } else {
                                    appState = .onboarding
                                }
                            }
                        }
                    }

            case .onboarding:
                OnboardingView(
                    sampleAudioURL: onboardingSampleURL,
                    onComplete: completeOnboarding,
                    onSkip: completeOnboarding
                )

            case .nameEntry:
                InlineNamePromptView(
                    selectedType: nil,
                    hasOwnLyrics: $nameEntryHasOwnLyrics,
                    isInstrumental: $nameEntryIsInstrumental,
                    onStart: { name, occasion in
                        pendingRecipientName = name
                        pendingOccasion = occasion?.displayName ?? ""
                        withAnimation(.easeInOut(duration: 0.5)) {
                            appState = (skipAuth || authManager.isAuthenticated) ? .main : .auth
                        }
                        syncProfileCompletionContext()
                    },
                    onCancel: {
                        withAnimation(.easeInOut(duration: 0.3)) {
                            appState = .onboarding
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
                        .environment(router)
                } else {
                    // Fallback - create client if needed
                    let fallbackClient = makeAPIClient(deviceId: getOrCreateDeviceId())
                    MainTabView(apiClient: fallbackClient)
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
                hasSkippedProfileCompletionInSession = true
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
        .onChange(of: authManager.isAuthenticated) { _, isAuthenticated in
            if isAuthenticated {
                hasSkippedProfileCompletionInSession = false
                syncProfileCompletionContext()
                authContextMessage = nil
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
                profileCompletionContext = nil
                withAnimation(.easeInOut(duration: 0.3)) {
                    appState = .auth
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
                    _ = try? await client.ensureDeviceToken()
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .pushTokenUpdated)) { _ in
            // Re-register device when APNs token changes (ensures server has latest push token)
            guard authManager.isAuthenticated, let client = apiClient else { return }
            Task { _ = try? await client.registerDevice(appVersion: APIClient.appVersion) }
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

    private func completeOnboarding() {
        hasCompletedOnboarding = true
        onboardingViewCount += 1
        withAnimation(.easeInOut(duration: 0.5)) {
            appState = .nameEntry
        }
    }

    private func syncProfileCompletionContext() {
        guard authManager.needsProfileCompletion,
              !hasSkippedProfileCompletionInSession,
              let client = apiClient else {
            profileCompletionContext = nil
            return
        }

        if profileCompletionContext == nil {
            profileCompletionContext = ProfileCompletionContext(apiClient: client)
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
            apiClientReady = true
        }
        if authManager.isAuthenticated {
            shareContext = ShareContext(shareId: parsed.shareId, isPoem: parsed.isPoem)
        } else {
            pendingShareId = parsed.shareId
            pendingShareIsPoem = parsed.isPoem
            authContextMessage = parsed.isPoem
                ? "Sign in to read your shared poem"
                : "Sign in to listen to your shared song"
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

            // Extract onboarding sample URL, constructing full URL from relative path
            if let relativePath = response.onboarding?.sampleAudioUrl {
                if relativePath.hasPrefix("http") {
                    onboardingSampleURL = relativePath
                } else {
                    onboardingSampleURL = AppConfig.apiBaseURL + relativePath
                }
            } else {
                onboardingSampleURL = nil
            }

            let nextPrompt = AppUpdatePolicy.evaluate(config: response.appUpdate)
            if let nextPrompt,
               nextPrompt.kind == .recommended,
               dismissedRecommendedUpdateVersion == nextPrompt.targetVersion {
                return
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
}

#Preview {
    RootView()
}
