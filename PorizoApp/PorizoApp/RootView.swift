//
//  RootView.swift
//  PorizoApp
//
//  Root view that handles app state: splash → onboarding → main app.
//  Light mode design for love and friendship.
//

import SwiftUI

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
                    _ = try? await client.ensureDeviceToken()
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

#Preview {
    RootView()
}
