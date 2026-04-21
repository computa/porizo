//
//  AuthManager.swift
//  PorizoApp
//
//  Manages user authentication state, token storage, and session lifecycle.
//  Handles signup, login, logout, and automatic token refresh.
//

import Foundation
import AuthenticationServices
import OneSignalFramework
import Observation
import UIKit    // For UIApplication.isProtectedDataAvailable

// MARK: - AuthManager

/// Manages authentication state and token lifecycle
/// Provides auth tokens to APIClient via closure for Bearer token auth
@MainActor
@Observable
class AuthManager {
    struct PendingSocialLinkRequest {
        let provider: String
        let body: [String: Any]
        let appleUserIdentifier: String?
    }

    // MARK: - Observable State

    private(set) var isAuthenticated: Bool = false
    private(set) var currentUser: AuthUser?
    private(set) var isLoading: Bool = false
    private(set) var hasValidatedSession: Bool = false
    private(set) var needsProfileCompletion: Bool = false

    /// Phone authentication flow state
    private(set) var phoneAuthState: PhoneAuthState = .idle

    /// Phone number being authenticated (E.164 format)
    private(set) var phoneNumber: String = ""

    /// Registration token for new users after phone verification
    private(set) var registrationToken: String?

    /// Phone number pending auto-link after cross-identifier sign-in.
    /// Persisted to Keychain so it survives app kills during sign-in flow.
    private(set) var pendingPhoneLink: String? {
        didSet {
            guard !isRestoringFromKeychain else { return }
            if let phone = pendingPhoneLink {
                _ = KeychainHelper.saveString(key: Self.pendingPhoneLinkKey, value: phone)
                // Store expiry: 15 minutes from now (matches server-side verification window)
                let expiry = String(Date().addingTimeInterval(15 * 60).timeIntervalSince1970)
                _ = KeychainHelper.saveString(key: Self.pendingPhoneLinkExpiryKey, value: expiry)
            } else {
                KeychainHelper.delete(key: Self.pendingPhoneLinkKey)
                KeychainHelper.delete(key: Self.pendingPhoneLinkExpiryKey)
            }
        }
    }

    private(set) var pendingSocialLinkRequest: PendingSocialLinkRequest?

    /// Suppresses didSet Keychain writes during restoration to avoid resetting TTL
    @ObservationIgnored private var isRestoringFromKeychain = false

    /// User ID from authentication (for AuthTokenProvider conformance)
    var authenticatedUserId: String? {
        currentUser?.id ?? tokenLock.withLock {
            if let cachedUserId, !cachedUserId.isEmpty {
                return cachedUserId
            }
            let storedUserId = KeychainHelper.loadString(key: Self.userIdKey)
            cachedUserId = storedUserId
            return storedUserId
        }
    }

    /// Auth provider string for analytics (e.g. "apple", "phone", "google").
    /// Returns nil if the provider key has never been written.
    var authProvider: String? {
        KeychainHelper.loadString(key: Self.authProviderKey)
    }

    // MARK: - Configuration

    @ObservationIgnored private let baseURL: String
    @ObservationIgnored private let session: URLSession

    // Keychain keys
    private static let accessTokenKey = "porizo_access_token"
    private static let refreshTokenKey = "porizo_refresh_token"
    private static let tokenExpiryKey = "porizo_token_expiry"
    private static let userIdKey = "porizo_auth_user_id"
    private static let deviceTokenKey = "porizo_device_token"
    private static let deviceTokenExpiryKey = "porizo_device_token_expiry"
    private static let appleUserIdKey = "porizo_apple_user_id"
    private static let authProviderKey = "porizo_auth_provider"
    private static let pendingPhoneLinkKey = "porizo_pending_phone_link"
    private static let pendingPhoneLinkExpiryKey = "porizo_pending_phone_link_expiry"

    // Token refresh threshold (refresh if less than 2 minutes remaining)
    @ObservationIgnored private let refreshThreshold: TimeInterval = 120

    // Foreground refresh threshold (refresh if less than 10 minutes remaining)
    // More aggressive when returning from background to ensure smooth UX
    @ObservationIgnored private let foregroundRefreshThreshold: TimeInterval = 600

    // MARK: - Refresh Deduplication
    // Ensures only one refresh is in flight at a time; concurrent callers await the same task
    @ObservationIgnored private var refreshTask: Task<String, Error>?

    // Lock for atomic refreshTask check-and-set to prevent race conditions
    // where two threads both see refreshTask == nil and create duplicate tasks
    @ObservationIgnored private let refreshLock = NSLock()

    // MARK: - Token Synchronization
    // NSLock ensures atomic read/write of token + expiry to prevent race conditions
    // where one thread reads stale expiry while another is mid-write
    @ObservationIgnored private let tokenLock = NSLock()
    @ObservationIgnored private var cachedAccessToken: String?
    @ObservationIgnored private var cachedRefreshToken: String?
    @ObservationIgnored private var cachedTokenExpiryEpoch: Double?
    @ObservationIgnored private var cachedUserId: String?

    // MARK: - Notification Observers
    @ObservationIgnored private var credentialRevokedObserver: NSObjectProtocol?
    @ObservationIgnored private var protectedDataObserver: NSObjectProtocol?

    // MARK: - Protected Data Handling (iOS 15+ Fix)

    /// Waits for protected data to become available before reading Keychain.
    /// On iOS 15+, Keychain reads can fail if device hasn't been unlocked since restart.
    /// Returns true if data is available, false if timeout (5 seconds).
    func waitForProtectedData() async -> Bool {
        // If already available, return immediately
        if UIApplication.shared.isProtectedDataAvailable {
            return true
        }

        print("[Auth] Waiting for protected data to become available...")

        let becameAvailable = await withTaskGroup(of: Bool.self) { group in
            group.addTask {
                for await _ in NotificationCenter.default.notifications(
                    named: UIApplication.protectedDataDidBecomeAvailableNotification
                ) {
                    return true
                }
                return false
            }

            group.addTask {
                try? await Task.sleep(for: .seconds(5))
                return false
            }

            let result = await group.next() ?? false
            group.cancelAll()
            return result
        }

        if becameAvailable {
            print("[Auth] Protected data now available")
        } else {
            print("[Auth] Protected data timeout - proceeding without auth")
        }
        return becameAvailable
    }

    // MARK: - Initialization

    init(baseURL: String? = nil) {
        self.baseURL = baseURL ?? AppConfig.apiBaseURL

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        self.session = URLSession(configuration: config)

        // Listen for Apple credential revocation (Apple's WWDC20 requirement)
        // This fires when user revokes access via Settings → Apple ID → Apps Using Apple ID
        credentialRevokedObserver = NotificationCenter.default.addObserver(
            forName: ASAuthorizationAppleIDProvider.credentialRevokedNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            guard let self else { return }
            print("[Auth] Apple credential revoked notification received")
            MainActor.assumeIsolated {
                self.logout()
            }
        }

        // Check for existing tokens
        loadAuthState()
    }

    deinit {
        if let observer = credentialRevokedObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        if let observer = protectedDataObserver {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    // MARK: - Auth State

    /// Loads existing auth state from Keychain
    /// Implements Apple's WWDC20 recommendation: validate credential state on every launch
    /// iOS 15+ fix: Waits for protected data before reading Keychain
    private func loadAuthState() {
        Task {
            // iOS 15+ fix: Wait for protected data before reading Keychain
            // This prevents false logouts when app launches with device locked
            let protectedDataAvailable = await waitForProtectedData()
            if !protectedDataAvailable {
                print("[Auth] Protected data not available after timeout - skipping auth load")
                // Defer auth load instead of forcing a perceived logout on cold boot.
                scheduleDeferredAuthLoadWhenProtectedDataAvailable()
                return
            }

            // Already on MainActor (class-level annotation), no wrapper needed
            self.performKeychainAuthLoad()
        }
    }

    /// If protected data is unavailable at launch, retry loading auth state once iOS unlocks keychain access.
    @MainActor
    private func scheduleDeferredAuthLoadWhenProtectedDataAvailable() {
        guard protectedDataObserver == nil else { return }

        protectedDataObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.protectedDataDidBecomeAvailableNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self = self else { return }
                print("[Auth] Protected data became available - retrying auth load")
                if let observer = self.protectedDataObserver {
                    NotificationCenter.default.removeObserver(observer)
                    self.protectedDataObserver = nil
                }
                self.performKeychainAuthLoad()
            }
        }
    }

    /// Performs the actual Keychain read after protected data is available
    /// Must be called on MainActor
    @MainActor
    private func performKeychainAuthLoad() {
        let accessToken = KeychainHelper.loadString(key: Self.accessTokenKey)
        let refreshToken = KeychainHelper.loadString(key: Self.refreshTokenKey)
        let tokenExpiry = KeychainHelper.loadString(key: Self.tokenExpiryKey).flatMap(Double.init)
        let userId = KeychainHelper.loadString(key: Self.userIdKey)
        let appleUserId = KeychainHelper.loadString(key: Self.appleUserIdKey)
        let authProvider = KeychainHelper.loadString(key: Self.authProviderKey)

        tokenLock.withLock {
            cachedAccessToken = accessToken
            cachedRefreshToken = refreshToken
            cachedTokenExpiryEpoch = tokenExpiry
            cachedUserId = userId
        }

        // Restore pendingPhoneLink from Keychain (survives app kills during sign-in flow)
        // Use isRestoringFromKeychain flag to suppress didSet (avoids resetting TTL on restore)
        if let savedPhone = KeychainHelper.loadString(key: Self.pendingPhoneLinkKey),
           let expiryStr = KeychainHelper.loadString(key: Self.pendingPhoneLinkExpiryKey),
           let expiryEpoch = Double(expiryStr),
           Date().timeIntervalSince1970 < expiryEpoch {
            isRestoringFromKeychain = true
            pendingPhoneLink = savedPhone
            isRestoringFromKeychain = false
            print("[Auth] Restored pendingPhoneLink from Keychain")
        } else {
            // Expired or missing — clean up
            KeychainHelper.delete(key: Self.pendingPhoneLinkKey)
            KeychainHelper.delete(key: Self.pendingPhoneLinkExpiryKey)
        }

        print("[Auth] loadAuthState: access=\(accessToken != nil), refresh=\(refreshToken != nil), userId=\(userId != nil), appleUserId=\(appleUserId != nil), provider=\(authProvider ?? "none"))")

        // If this session is Apple-authenticated, validate credential FIRST (WWDC20 requirement)
        // getCredentialState is a LOCAL call (no network) - very fast
        if authProvider == "apple", let appleUserId = appleUserId {
            Task {
                let credentialValid = await validateAppleCredential(appleUserId: appleUserId)
                await MainActor.run {
                    if credentialValid {
                        print("[Auth] Apple credential valid - proceeding with token check")
                        self.completeAuthStateLoad(accessToken: accessToken, refreshToken: refreshToken, userId: userId)
                    } else {
                        print("[Auth] Apple credential invalid - forcing re-login")
                        self.logout()
                    }
                }
            }
        } else {
            // Non-Apple session (or legacy session without provider)
            print("[Auth] Apple credential check skipped (provider=\(authProvider ?? "none"))")
            completeAuthStateLoad(accessToken: accessToken, refreshToken: refreshToken, userId: userId)
        }
    }

    /// Complete auth state loading after credential validation
    private func completeAuthStateLoad(accessToken: String?, refreshToken: String?, userId: String?) {
        if accessToken != nil, refreshToken != nil, userId != nil {
            print("[Auth] All tokens found, restoring session optimistically...")
            isAuthenticated = true
            hasValidatedSession = false
            isLoading = false
            // Validate session in the background; only definitive failures should log out
            Task {
                do {
                    try await fetchCurrentUser()
                    print("[Auth] Session validated on launch")
                } catch {
                    handleLaunchValidationError(error)
                }
            }
        } else if accessToken != nil || refreshToken != nil || userId != nil {
            // Partial auth state is invalid; clear stored credentials
            print("[Auth] PARTIAL STATE DETECTED - calling logout()")
            logout()
        } else {
            print("[Auth] No tokens found")
        }
    }

    /// Handle launch-time session validation failures without forcing logout on transient errors
    private func handleLaunchValidationError(_ error: Error) {
        if let authError = error as? AuthError {
            switch authError {
            case .tokenExpired, .notAuthenticated:
                print("[Auth] Launch validation failed definitively - logging out")
                logout()
            default:
                print("[Auth] Launch validation failed (non-fatal): \(authError.localizedDescription)")
            }
        } else {
            print("[Auth] Launch validation failed (unknown error): \(error.localizedDescription)")
        }
    }

    /// Get the current access token, refreshing if needed
    /// Uses tokenLock for atomic read to prevent reading stale token during concurrent refresh
    func getAccessToken() async throws -> String? {
        guard isAuthenticated else { return nil }

        // Track whether we awaited an existing refresh task
        var didAwaitRefresh = false

        // Check for in-flight refresh atomically
        let existingTask = refreshLock.withLock { refreshTask }

        // If a refresh is already in flight, await it so we don't return a stale token.
        if let existingTask = existingTask {
            print("[Auth] getAccessToken: awaiting in-flight refresh")
            _ = try await existingTask.value
            didAwaitRefresh = true
        }

        // Skip refresh check if we just awaited - token is guaranteed fresh
        // This prevents the secondary race condition where we read stale expiry
        // between the time the refresh completed and wrote the new expiry
        if !didAwaitRefresh && shouldRefreshToken() {
            print("[Auth] getAccessToken: token needs refresh")
            try await refreshTokens()
        }

        // Atomic read of token to prevent reading during concurrent write
        let token: String? = tokenLock.withLock { () -> String? in
            if let cachedAccessToken, !cachedAccessToken.isEmpty {
                return cachedAccessToken
            }
            let storedToken = KeychainHelper.loadString(key: Self.accessTokenKey)
            cachedAccessToken = storedToken
            return storedToken
        }
        if let t = token {
            print("[Auth] getAccessToken returning: \(String(t.prefix(20)))...")
        } else {
            print("[Auth] getAccessToken: Keychain returned nil!")
        }
        return token
    }

    // MARK: - Proactive Token Refresh

    /// Proactive refresh threshold: refresh if token expires within 5 minutes
    /// This is more aggressive than the reactive `refreshThreshold` (2 min) to avoid 401s
    @ObservationIgnored private let proactiveRefreshThreshold: TimeInterval = 300

    /// Ensures access token is valid before making API calls.
    /// Proactively refreshes if token expires within 5 minutes.
    /// Uses tokenLock for atomic reads to prevent race conditions.
    /// - Returns: Valid access token
    /// - Throws: AuthError.notAuthenticated if unable to get valid token
    func ensureValidAccessToken() async throws -> String {
        // Early exit if not authenticated (matches getAccessToken behavior)
        guard isAuthenticated else {
            throw AuthError.notAuthenticated
        }

        // Atomic read of current token and expiry
        let (currentToken, timeRemaining): (String?, TimeInterval) = tokenLock.withLock {
            let token: String? = {
                if let cachedAccessToken, !cachedAccessToken.isEmpty {
                    return cachedAccessToken
                }
                let storedToken = KeychainHelper.loadString(key: Self.accessTokenKey)
                cachedAccessToken = storedToken
                return storedToken
            }()

            let expiryEpoch: Double? = {
                if let cachedTokenExpiryEpoch {
                    return cachedTokenExpiryEpoch
                }
                guard let expiryString = KeychainHelper.loadString(key: Self.tokenExpiryKey),
                      let expiry = Double(expiryString) else {
                    return nil
                }
                cachedTokenExpiryEpoch = expiry
                return expiry
            }()

            guard let expiryEpoch else {
                return (token, 0)
            }
            return (token, Date(timeIntervalSince1970: expiryEpoch).timeIntervalSinceNow)
        }

        // Check if we have a token at all
        guard currentToken != nil else {
            throw AuthError.notAuthenticated
        }

        // Log expiry check details
        print("[Auth] Token expiry check: \(Int(timeRemaining))s remaining, buffer=\(Int(proactiveRefreshThreshold))s")

        // Check expiry with 5-minute buffer (proactive refresh)
        if timeRemaining < proactiveRefreshThreshold {
            // Token expires within 5 minutes - refresh proactively
            print("[Auth] Token expires in <5 min (\(Int(timeRemaining))s), refreshing proactively")
            try await refreshTokens()
            print("[Auth] Proactive refresh completed")
        }

        // Atomic read of the (possibly refreshed) token
        let validToken: String? = tokenLock.withLock { () -> String? in
            if let cachedAccessToken, !cachedAccessToken.isEmpty {
                return cachedAccessToken
            }
            let storedToken = KeychainHelper.loadString(key: Self.accessTokenKey)
            cachedAccessToken = storedToken
            return storedToken
        }

        guard let validToken = validToken else {
            print("[Auth] ensureValidAccessToken: Keychain returned nil!")
            throw AuthError.notAuthenticated
        }

        print("[Auth] ensureValidAccessToken returning: \(String(validToken.prefix(20)))...")
        return validToken
    }

    /// Get the token expiry date from in-memory cache with keychain fallback.
    /// Uses tokenLock for atomic read to prevent race with saveRefreshedTokens.
    private func tokenExpiryDate() -> Date? {
        tokenLock.withLock {
            if let cachedTokenExpiryEpoch {
                return Date(timeIntervalSince1970: cachedTokenExpiryEpoch)
            }

            guard let expiryString = KeychainHelper.loadString(key: Self.tokenExpiryKey),
                  let expiry = Double(expiryString) else {
                return nil
            }
            cachedTokenExpiryEpoch = expiry
            return Date(timeIntervalSince1970: expiry)
        }
    }

    /// Check if token should be refreshed
    private func shouldRefreshToken(threshold: TimeInterval? = nil) -> Bool {
        guard let expiryDate = tokenExpiryDate() else {
            return true
        }
        return expiryDate.timeIntervalSinceNow < (threshold ?? refreshThreshold)
    }

    /// Check if token is actually expired (not just needing refresh)
    private func isTokenExpired() -> Bool {
        guard let expiryDate = tokenExpiryDate() else {
            return true
        }
        return expiryDate.timeIntervalSinceNow <= 0
    }

    // MARK: - Foreground Refresh

    /// Called when app returns to foreground to proactively refresh tokens
    /// This enables Spotify-style persistent login where users never see re-login prompts
    /// Also validates Apple credential per WWDC20 guidance (check on every foreground)
    func refreshTokensIfNeeded() async {
        guard isAuthenticated else { return }

        // Apple's WWDC20 requirement: validate credential on every foreground transition
        // getCredentialState is LOCAL (no network) so this is fast
        if KeychainHelper.loadString(key: Self.authProviderKey) == "apple",
           let appleUserId = KeychainHelper.loadString(key: Self.appleUserIdKey) {
            let credentialValid = await validateAppleCredential(appleUserId: appleUserId)
            if !credentialValid {
                print("[Auth] Apple credential invalid on foreground - logging out")
                logout()
                return
            }
        }

        // Refresh if token expires within 10 minutes (more aggressive than API call threshold)
        guard shouldRefreshToken(threshold: foregroundRefreshThreshold) else {
            return
        }

        do {
            try await refreshTokens()
            print("[Auth] Foreground token refresh successful")
        } catch {
            // Only force logout on definitive auth failures.
            if let authError = error as? AuthError {
                switch authError {
                case .tokenExpired, .notAuthenticated, .keychainSaveFailed:
                    print("[Auth] Foreground refresh failed definitively - logging out")
                    logout()
                    return
                default:
                    break
                }
            }

            // Transient failures should not end the session.
            print("[Auth] Foreground refresh failed (transient): \(error.localizedDescription)")
        }
    }

    /// Validate Apple credential state (LOCAL call, no network required)
    /// Returns true if credential is authorized, false if revoked/not found
    private func validateAppleCredential(appleUserId: String) async -> Bool {
        let provider = ASAuthorizationAppleIDProvider()
        do {
            let state = try await provider.credentialState(forUserID: appleUserId)
            switch state {
            case .authorized:
                return true
            case .revoked, .notFound, .transferred:
                print("[Auth] Apple credential state: \(state)")
                return false
            @unknown default:
                return true // Don't logout on unknown states
            }
        } catch {
            // getCredentialState is local, shouldn't fail - don't logout on error
            print("[Auth] validateAppleCredential error: \(error)")
            return true
        }
    }

    // MARK: - Social Auth (Apple)

    /// Handle Sign in with Apple
    func handleAppleSignIn(authorization: ASAuthorization, nonce: String) async throws {
        pendingSocialLinkRequest = nil
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let identityToken = credential.identityToken,
              let tokenString = String(data: identityToken, encoding: .utf8) else {
            throw AuthError.serverError("Invalid Apple credential")
        }

        isLoading = true
        defer { isLoading = false }

        let url = URL(string: "\(baseURL)/auth/social")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        var body: [String: Any] = [
            "provider": "apple",
            "id_token": tokenString,
            // Best practice: send the raw nonce so the backend can verify
            // it matches the hashed nonce embedded in the Apple ID token.
            "nonce": nonce
        ]

        if let authorizationCode = credential.authorizationCode,
           let authCodeString = String(data: authorizationCode, encoding: .utf8),
           !authCodeString.isEmpty {
            body["authorization_code"] = authCodeString
        }

        // Auto-link pending phone from cross-identifier flow
        if let phone = pendingPhoneLink {
            body["pending_phone_link"] = phone
        }

        // Apple only provides name on first sign-in
        if let fullName = credential.fullName {
            let name = [fullName.givenName, fullName.familyName]
                .compactMap { $0 }
                .joined(separator: " ")
            if !name.isEmpty {
                body["name"] = name
            }
        }

        // Apple provides a stable user identifier; include it for future hardening.
        if !credential.user.isEmpty {
            body["provider_user_id"] = credential.user
        }

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw AuthError.networkError("Invalid response")
        }

        switch httpResponse.statusCode {
        case 200, 201:
            // Check if this is a link confirmation prompt (not a login response)
            if let linkResponse = try? JSONDecoder().decode(LinkConfirmationResponse.self, from: data),
               linkResponse.requiresLinkConfirmation == true {
                pendingSocialLinkRequest = PendingSocialLinkRequest(
                    provider: "apple",
                    body: body,
                    appleUserIdentifier: credential.user.isEmpty ? nil : credential.user
                )
                throw AuthError.requiresLinkConfirmation(
                    provider: linkResponse.provider ?? "apple",
                    maskedEmail: linkResponse.existingAccountEmail ?? "existing account"
                )
            } else {
                let authResponse = try JSONDecoder().decode(AuthResponse.self, from: data)
                try saveTokens(authResponse)
            }

            // Store Apple userIdentifier for credential validation on launch (Apple's WWDC20 requirement)
            // This is the key to persistent sessions - we use this to call getCredentialState() on each launch
            if !credential.user.isEmpty {
                let saved = KeychainHelper.saveString(key: Self.appleUserIdKey, value: credential.user)
                print("[Auth] Apple userIdentifier saved to Keychain: \(saved)")
            }
            setAuthProvider("apple")

            isAuthenticated = true
            try await fetchCurrentUser()

        case 400:
            throw AuthError.serverError("Invalid Apple token")

        default:
            throw AuthError.serverError("Apple sign-in failed (HTTP \(httpResponse.statusCode))")
        }
    }

    func confirmPendingSocialLink() async throws {
        guard let pending = pendingSocialLinkRequest else {
            throw AuthError.serverError("No pending link confirmation request found.")
        }

        isLoading = true
        defer { isLoading = false }

        let url = URL(string: "\(baseURL)/auth/social")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        var body = pending.body
        body["confirm_link"] = true
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw AuthError.networkError("Invalid response")
        }
        guard (200...201).contains(httpResponse.statusCode) else {
            throw AuthError.serverError("\(pending.provider.capitalized) sign-in link confirmation failed")
        }

        let authResponse = try JSONDecoder().decode(AuthResponse.self, from: data)
        try saveTokens(authResponse)

        if let appleUserIdentifier = pending.appleUserIdentifier {
            let saved = KeychainHelper.saveString(key: Self.appleUserIdKey, value: appleUserIdentifier)
            print("[Auth] Apple userIdentifier saved after confirmed link: \(saved)")
        }

        setAuthProvider(pending.provider)
        pendingSocialLinkRequest = nil
        isAuthenticated = true
        try await fetchCurrentUser()
    }

    func cancelPendingSocialLink() {
        pendingSocialLinkRequest = nil
    }

    // MARK: - Phone Auth

    /// Start the phone authentication flow
    /// Sets phoneAuthState to .phoneEntry
    func startPhoneAuth() {
        phoneNumber = ""
        registrationToken = nil
        phoneAuthState = .phoneEntry
        print("[Auth] Started phone auth flow")
    }

    /// Cancel the phone authentication flow and return to idle
    func cancelPhoneAuth() {
        phoneNumber = ""
        registrationToken = nil
        phoneAuthState = .idle
        print("[Auth] Cancelled phone auth flow")
    }

    /// Called after verification code is successfully sent
    /// Transitions from phoneEntry to phoneVerification state
    /// - Parameter phoneNumber: Phone number in E.164 format (e.g., +15551234567)
    func onPhoneCodeSent(phoneNumber: String) {
        self.phoneNumber = phoneNumber
        phoneAuthState = .phoneVerification(phoneNumber: phoneNumber)
        print("[Auth] Phone code sent to \(phoneNumber)")
    }

    /// Handle phone verification response
    /// Handle phone verification result.
    /// Existing user → login with tokens.
    /// New user → create account directly (no username step).
    func handlePhoneVerification(_ response: VerifyPhoneCodeResponse) async throws {
        guard response.verified else {
            throw AuthError.phoneVerificationFailed("Verification failed")
        }

        // Case 1: Existing user - response contains auth tokens
        if let accessToken = response.accessToken,
           let refreshToken = response.refreshToken,
           let userId = response.userId {
            print("[Auth] Phone verification: existing user, logging in")

            let authResponse = AuthResponse(
                userId: userId,
                accessToken: accessToken,
                refreshToken: refreshToken,
                expiresIn: 3600,
                isNewUser: response.isNewUser
            )

            try saveTokens(authResponse)
            setAuthProvider("phone")
            phoneAuthState = .idle
            registrationToken = nil
            isAuthenticated = true
            try await fetchCurrentUser()
            print("[Auth] Phone login successful for existing user")
            return
        }

        // Case 2: New user - ask if they have an existing account first
        if let regToken = response.registrationToken {
            print("[Auth] Phone verification: new phone, prompting account check")
            registrationToken = regToken
            phoneAuthState = .profileEntry(registrationToken: regToken, phoneNumber: phoneNumber)
            return
        }

        throw AuthError.phoneVerificationFailed("Invalid verification response")
    }

    /// Create phone account with name and optional email
    private func completePhoneRegistrationDirect(registrationToken: String, displayName: String? = nil, email: String? = nil) async throws {
        let url = URL(string: "\(baseURL)/auth/phone/register")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0", forHTTPHeaderField: "User-Agent")

        var body: [String: String] = [
            "registration_token": registrationToken,
            "phone_number": phoneNumber,
        ]
        if let name = displayName, !name.isEmpty { body["name"] = name }
        if let email = email, !email.isEmpty { body["email"] = email }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, httpResponse) = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "phoneRegistration") {
            try await self.session.data(for: request)
        }
        guard let response = httpResponse as? HTTPURLResponse else {
            throw AuthError.networkError("Invalid response")
        }

        // Cross-identifier match: server found existing account linked to this phone
        if response.statusCode == 200 {
            if let accountExists = try? JSONDecoder().decode(AccountExistsResponse.self, from: data),
               accountExists.accountExists {
                phoneAuthState = .accountExists(
                    authMethods: accountExists.authMethods,
                    maskedEmail: accountExists.maskedEmail,
                    maskedPhone: accountExists.maskedPhone,
                    phoneNumber: phoneNumber
                )
                print("[Auth] Cross-identifier match found — prompting user to sign in via existing method")
                return
            }
        }

        if response.statusCode == 409 {
            // Phone already taken (race condition) — parse error
            let errorBody = String(data: data, encoding: .utf8) ?? ""
            if errorBody.contains("E117_PHONE_EXISTS") {
                throw AuthError.registrationFailed("An account with this phone number already exists. Please sign in instead.")
            }
            throw AuthError.registrationFailed("Account conflict. Please try again.")
        }

        guard response.statusCode == 201 else {
            throw AuthError.serverError("Phone registration failed (HTTP \(response.statusCode))")
        }

        let authResponse = try JSONDecoder().decode(AuthResponse.self, from: data)
        try saveTokens(authResponse)
        setAuthProvider("phone")

        phoneAuthState = .idle
        phoneNumber = ""
        self.registrationToken = nil
        isAuthenticated = true
        try await fetchCurrentUser()
        print("[Auth] Phone registration completed successfully (no username)")
    }

    /// Complete phone registration with profile info from PhoneProfileEntryView
    func completePhoneRegistration(displayName: String?, email: String?) async throws {
        guard let regToken = registrationToken else {
            throw AuthError.registrationFailed("No registration token available")
        }
        try await completePhoneRegistrationDirect(registrationToken: regToken, displayName: displayName, email: email)
    }

    /// Store a verified phone number for auto-linking after cross-identifier sign-in
    func setPendingPhoneLink(_ phone: String) {
        pendingPhoneLink = phone
        print("[Auth] Pending phone link set: \(phone.prefix(4))****")
    }

    /// Go back one step in phone auth flow
    func phoneAuthGoBack() {
        switch phoneAuthState {
        case .idle:
            break
        case .phoneEntry:
            phoneAuthState = .idle
        case .phoneVerification:
            phoneAuthState = .phoneEntry
        case .profileEntry:
            phoneAuthState = .phoneEntry
            registrationToken = nil
        case .accountExists(_, _, _, let phone):
            // Preserve phone for auto-link in case user signs in via another method
            setPendingPhoneLink(phone)
            phoneAuthState = .phoneEntry
            registrationToken = nil
        }
        print("[Auth] Phone auth went back to: \(phoneAuthState)")
    }

    // MARK: - Token Refresh

    /// Refresh the access token using refresh token
    /// Implements graceful error handling:
    /// - Only logs out on definitive token rejection (reuse, revoked)
    /// - Network/server errors don't trigger logout (token may still be valid)
    /// - Deduplicates concurrent refresh calls (all callers await the same task)
    /// - Uses refreshLock for atomic check-and-set to prevent race conditions
    /// - Wraps refresh in BackgroundTaskManager for iOS background protection
    @discardableResult
    func refreshTokens() async throws -> String {
        // Atomic check-and-set: prevent race where two threads both see nil
        // and create duplicate refresh tasks
        if let existingTask = refreshLock.withLock({ refreshTask }) {
            print("[Auth] Refresh already in progress, awaiting existing task")
            return try await existingTask.value
        }

        // Create a new refresh task with background execution protection
        // This prevents iOS from suspending the app mid-refresh, which would
        // leave tokens in an inconsistent state
        let task = Task<String, Error> {
            try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "tokenRefresh") {
                try await self.performRefresh()
            }
        }
        refreshLock.withLock {
            refreshTask = task
        }

        // Await the refresh and clear the task reference AFTER completion
        // This is critical: defer would clear it BEFORE await completes,
        // allowing duplicate tasks to be created during execution
        do {
            let refreshedToken = try await task.value
            refreshLock.withLock {
                refreshTask = nil
            }
            return refreshedToken
        } catch {
            refreshLock.withLock {
                refreshTask = nil
            }
            throw error
        }
    }

    /// Internal refresh implementation - called only by the deduplicated wrapper
    private func performRefresh() async throws -> String {
        // Never rotate server-side tokens if keychain writes may fail (locked device).
        // Rotating without persisting the replacement token can orphan the session.
        if !UIApplication.shared.isProtectedDataAvailable {
            print("[Auth] Protected data unavailable - deferring token refresh")
            throw AuthError.networkError("Protected data unavailable")
        }

        let refreshToken = tokenLock.withLock { () -> String? in
            if let cachedRefreshToken, !cachedRefreshToken.isEmpty {
                return cachedRefreshToken
            }
            let storedRefreshToken = KeychainHelper.loadString(key: Self.refreshTokenKey)
            cachedRefreshToken = storedRefreshToken
            return storedRefreshToken
        }

        guard let refreshToken else {
            // Keychain can be transiently unavailable; don't hard-logout immediately.
            if !UIApplication.shared.isProtectedDataAvailable {
                print("[Auth] Refresh token unavailable while protected data is locked")
                throw AuthError.networkError("Protected data unavailable")
            }

            let hasAccessToken = tokenLock.withLock {
                if let cachedAccessToken, !cachedAccessToken.isEmpty {
                    return true
                }
                let storedAccessToken = KeychainHelper.loadString(key: Self.accessTokenKey)
                cachedAccessToken = storedAccessToken
                return storedAccessToken != nil
            }
            if hasAccessToken {
                print("[Auth] Refresh token unavailable but access token exists - treating as transient")
                throw AuthError.serverError("Refresh token temporarily unavailable")
            }

            print("[Auth] No auth tokens available during refresh - not authenticated")
            throw AuthError.notAuthenticated
        }

        print("[Auth] Starting token refresh...")

        let url = URL(string: "\(baseURL)/auth/refresh")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = ["refresh_token": refreshToken]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let data: Data
        let response: URLResponse

        do {
            (data, response) = try await session.data(for: request)
        } catch {
            // Network error - don't logout, token might still be valid
            throw AuthError.networkError("Refresh request failed: \(error.localizedDescription)")
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw AuthError.networkError("Invalid response")
        }

        switch httpResponse.statusCode {
        case 200:
            let refreshResponse = try JSONDecoder().decode(RefreshResponse.self, from: data)
            do {
                try saveRefreshedTokens(refreshResponse)
            } catch AuthError.keychainSaveFailed {
                print("[Auth] Failed to persist refreshed tokens - forcing re-auth")
                throw AuthError.notAuthenticated
            }
            print("[Auth] Token refresh successful")
            return refreshResponse.accessToken

        case 401:
            print("[Auth] Refresh returned 401")
            // Check if this is a definitive rejection (token reuse, revoked)
            // vs a temporary issue we should retry
            if let errorBody = try? JSONDecoder().decode(RefreshErrorResponse.self, from: data) {
                print("[Auth] Refresh error: \(errorBody.error ?? "unknown") - \(errorBody.message ?? "no message")")

                // TOKEN_ALREADY_ROTATED is special: it means a concurrent refresh succeeded
                // If there's a refresh task in flight, await it to get the new token
                // This handles edge cases from the server-side race condition fix
                if errorBody.error == "TOKEN_ALREADY_ROTATED" {
                    print("[Auth] TOKEN_ALREADY_ROTATED - concurrent refresh likely succeeded")

                    // Check if we now have a valid token (with lock for atomic read)
                    let hasValidToken = tokenLock.withLock {
                        let currentToken: String? = {
                            if let cachedAccessToken, !cachedAccessToken.isEmpty {
                                return cachedAccessToken
                            }
                            let storedAccessToken = KeychainHelper.loadString(key: Self.accessTokenKey)
                            cachedAccessToken = storedAccessToken
                            return storedAccessToken
                        }()

                        let expiryEpoch: Double? = {
                            if let cachedTokenExpiryEpoch {
                                return cachedTokenExpiryEpoch
                            }
                            guard let expiryString = KeychainHelper.loadString(key: Self.tokenExpiryKey),
                                  let expiry = Double(expiryString) else {
                                return nil
                            }
                            cachedTokenExpiryEpoch = expiry
                            return expiry
                        }()

                        guard let currentToken, !currentToken.isEmpty, let expiryEpoch else {
                            return false
                        }
                        return Date(timeIntervalSince1970: expiryEpoch).timeIntervalSinceNow > 60
                    }

                    if hasValidToken {
                        print("[Auth] Found valid token after TOKEN_ALREADY_ROTATED - continuing without logout")
                        if let token = tokenLock.withLock({
                            if let cachedAccessToken, !cachedAccessToken.isEmpty {
                                return cachedAccessToken
                            }
                            let storedAccessToken = KeychainHelper.loadString(key: Self.accessTokenKey)
                            cachedAccessToken = storedAccessToken
                            return storedAccessToken
                        }) {
                            return token
                        }
                        throw AuthError.notAuthenticated
                    }

                    // Server reports this refresh token is already rotated and we have no valid access token.
                    // Recovery is not possible client-side; require explicit sign-in.
                    print("[Auth] No valid token after TOKEN_ALREADY_ROTATED - requiring re-auth")
                    throw AuthError.tokenExpired
                }

                // These errors mean the token is definitively invalid - must re-login
                let definitiveErrors = [
                    "TOKEN_REUSE_DETECTED",
                    "TOKEN_REVOKED",
                    "TOKEN_EXPIRED",
                    "INVALID_TOKEN",
                    "INVALID_REFRESH_TOKEN",
                    "TOKEN_FAMILY_COMPROMISED",
                    "SESSION_REVOKED",
                    "SESSION_EXPIRED"
                ]

                if definitiveErrors.contains(errorBody.error ?? "") {
                    print("[Auth] Definitive token rejection: \(errorBody.error ?? "unknown")")
                    throw AuthError.tokenExpired
                }
            }
            // For other 401s, don't immediately logout - could be transient
            // The next API call will also fail and can trigger logout then
            throw AuthError.serverError("Token refresh failed (401)")

        case 500...599:
            // Server error - don't logout, this is likely temporary
            throw AuthError.serverError("Server error during refresh")

        default:
            throw AuthError.serverError("Token refresh failed (HTTP \(httpResponse.statusCode))")
        }
    }

    /// Response structure for refresh errors
    private struct RefreshErrorResponse: Codable {
        let error: String?
        let message: String?
    }

    // MARK: - Logout

    /// Logout and clear all stored credentials
    func logout() {
        // Log the logout for debugging unexpected logouts
        // In production, this helps Crashlytics track logout patterns
        let provider = KeychainHelper.loadString(key: Self.authProviderKey) ?? "unknown"
        print("[Auth] logout() called - provider: \(provider)")
        #if DEBUG
        // In debug builds, log the call stack to help trace unexpected logouts
        Thread.callStackSymbols.prefix(8).forEach { print("[Auth] Stack: \($0)") }
        #endif

        // Call logout endpoint (fire and forget)
        let accessTokenForLogout = tokenLock.withLock { () -> String? in
            if let cachedAccessToken, !cachedAccessToken.isEmpty {
                return cachedAccessToken
            }
            let storedToken = KeychainHelper.loadString(key: Self.accessTokenKey)
            cachedAccessToken = storedToken
            return storedToken
        }
        if let token = accessTokenForLogout {
            Task {
                let url = URL(string: "\(baseURL)/auth/logout")!
                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                _ = try? await session.data(for: request)
            }
        }

        // Clear local state
        KeychainHelper.delete(key: Self.accessTokenKey)
        KeychainHelper.delete(key: Self.refreshTokenKey)
        KeychainHelper.delete(key: Self.tokenExpiryKey)
        KeychainHelper.delete(key: Self.userIdKey)
        KeychainHelper.delete(key: Self.deviceTokenKey)
        KeychainHelper.delete(key: Self.deviceTokenExpiryKey)
        KeychainHelper.delete(key: Self.appleUserIdKey)
        KeychainHelper.delete(key: Self.authProviderKey)
        KeychainHelper.delete(key: Self.pendingPhoneLinkKey)
        KeychainHelper.delete(key: Self.pendingPhoneLinkExpiryKey)
        PendingSuggestionStore.clear()
        tokenLock.withLock {
            cachedAccessToken = nil
            cachedRefreshToken = nil
            cachedTokenExpiryEpoch = nil
            cachedUserId = nil
        }
        pendingPhoneLink = nil
        pendingSocialLinkRequest = nil

        isAuthenticated = false
        hasValidatedSession = false
        needsProfileCompletion = false
        currentUser = nil

        // Disassociate device from OneSignal user so marketing pushes stop
        OneSignal.logout()

        // Reset profile-skip so next user on this device sees the prompt
        UserDefaults.standard.removeObject(forKey: "hasSkippedProfileCompletion")
    }

    // MARK: - Current User

    /// Fetch current user details
    /// - Parameter retryCount: Internal retry counter to prevent infinite recursion (max 2 attempts)
    func fetchCurrentUser(retryCount: Int = 0) async throws {
        // Prevent infinite recursion if server returns corrupted tokens
        guard retryCount < 2 else {
            print("[Auth] fetchCurrentUser exceeded retry limit (\(retryCount) attempts)")
            throw AuthError.tokenExpired
        }

        let token = try await getAccessToken()
        guard let token else { throw AuthError.notAuthenticated }

        let url = URL(string: "\(baseURL)/auth/me")!
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw AuthError.networkError("Invalid response")
        }

        if httpResponse.statusCode == 200 {
            let user = try JSONDecoder().decode(AuthUser.self, from: data)
            currentUser = user
            needsProfileCompletion = user.needsProfileCompletion
            hasValidatedSession = true
            // Clear pending phone link after successful auth (it was sent in the request)
            pendingPhoneLink = nil
            // Link OneSignal external ID so marketing pushes target this user
            OneSignal.login(user.id)
            await LocalNotificationService.shared.ensureAuthorizedForAuthenticatedUser()
            print("[Auth] fetchCurrentUser success: user=\(user.id)")
        } else if httpResponse.statusCode == 401 {
            // Token expired, try refresh
            print("[Auth] fetchCurrentUser got 401 (attempt \(retryCount + 1)/2), attempting refresh")
            try await refreshTokens()
            try await fetchCurrentUser(retryCount: retryCount + 1)
        } else {
            print("[Auth] fetchCurrentUser unexpected status: \(httpResponse.statusCode)")
            throw AuthError.serverError("Failed to fetch user (HTTP \(httpResponse.statusCode))")
        }
    }

    // MARK: - Profile Completion

    /// Dismiss the profile completion prompt without saving
    func dismissProfileCompletion() {
        needsProfileCompletion = false
    }

    /// Update current user after a successful profile update
    func updateCurrentUser(_ user: AuthUser) {
        currentUser = user
        needsProfileCompletion = user.needsProfileCompletion
    }

    // MARK: - Account Deletion

    /// Delete user account and all associated data
    /// This is irreversible and required for App Store compliance
    func deleteAccount() async throws {
        let token = tokenLock.withLock { () -> String? in
            if let cachedAccessToken, !cachedAccessToken.isEmpty {
                return cachedAccessToken
            }
            let storedToken = KeychainHelper.loadString(key: Self.accessTokenKey)
            cachedAccessToken = storedToken
            return storedToken
        }

        guard let token else {
            throw AuthError.notAuthenticated
        }

        isLoading = true
        defer { isLoading = false }

        let url = URL(string: "\(baseURL)/auth/delete-account")!
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (_, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw AuthError.networkError("Invalid response")
        }

        switch httpResponse.statusCode {
        case 200, 204:
            // Account deleted successfully, clear local state
            logout()

        case 401:
            throw AuthError.tokenExpired

        case 403:
            throw AuthError.serverError("Account deletion not permitted")

        default:
            throw AuthError.serverError("Account deletion failed (HTTP \(httpResponse.statusCode))")
        }
    }

    // MARK: - Private Helpers

    /// Saves tokens atomically using tokenLock to prevent race conditions
    private func saveTokens(_ response: AuthResponse) throws {
        try tokenLock.withLock {
            // Write all auth values with rollback to avoid partial-keychain state.
            let expiry = Date.now.addingTimeInterval(TimeInterval(response.expiresIn))
            let values: [(String, String)] = [
                (Self.accessTokenKey, response.accessToken),
                (Self.refreshTokenKey, response.refreshToken),
                (Self.userIdKey, response.userId),
                (Self.tokenExpiryKey, String(expiry.timeIntervalSince1970))
            ]

            guard saveAuthValuesWithRollback(values) else {
                print("[Auth] ERROR: Failed to save tokens to keychain")
                throw AuthError.keychainSaveFailed
            }

            cachedAccessToken = response.accessToken
            cachedRefreshToken = response.refreshToken
            cachedTokenExpiryEpoch = expiry.timeIntervalSince1970
            cachedUserId = response.userId
        }

        print("[Auth] All tokens saved successfully")
    }

    /// Saves refreshed tokens atomically using tokenLock
    /// This prevents race conditions where another thread reads partial state
    private func saveRefreshedTokens(_ response: RefreshResponse) throws {
        try tokenLock.withLock {
            let expiry = Date.now.addingTimeInterval(TimeInterval(response.expiresIn))
            let values: [(String, String)] = [
                (Self.accessTokenKey, response.accessToken),
                (Self.refreshTokenKey, response.refreshToken),
                (Self.tokenExpiryKey, String(expiry.timeIntervalSince1970))
            ]

            guard saveAuthValuesWithRollback(values) else {
                print("[Auth] ERROR: Failed to save refreshed tokens to keychain")
                throw AuthError.keychainSaveFailed
            }

            cachedAccessToken = response.accessToken
            cachedRefreshToken = response.refreshToken
            cachedTokenExpiryEpoch = expiry.timeIntervalSince1970
        }

        // Log token preview for debugging (first 20 chars only)
        let tokenPreview = String(response.accessToken.prefix(20))
        print("[Auth] Refreshed tokens saved: \(tokenPreview)..., expires in \(response.expiresIn)s")
    }

    /// Saves a batch of auth values and restores previous values if any write fails.
    /// Must be called with `tokenLock` already held.
    private func saveAuthValuesWithRollback(_ values: [(String, String)]) -> Bool {
        var previousValues: [String: String?] = [:]
        previousValues.reserveCapacity(values.count)

        for (key, _) in values {
            previousValues[key] = KeychainHelper.loadString(key: key)
        }

        for (key, value) in values {
            guard KeychainHelper.saveString(key: key, value: value) else {
                print("[Auth] Keychain write failed for \(key), restoring previous auth values")
                for (rollbackKey, previousValue) in previousValues {
                    if let previousValue {
                        _ = KeychainHelper.saveString(key: rollbackKey, value: previousValue)
                    } else {
                        KeychainHelper.delete(key: rollbackKey)
                    }
                }
                return false
            }
        }

        return true
    }

    private func setAuthProvider(_ provider: String) {
        let saved = KeychainHelper.saveString(key: Self.authProviderKey, value: provider)
        if !saved {
            print("[Auth] ERROR: Failed to save auth provider \(provider)")
        }
        // Funnel analytics: called from fresh sign-in paths only (apple / phone /
        // social), not from keychain session restoration — gives strict
        // conversion semantics in Amplitude/Firebase.
        AnalyticsService.shared.log(
            .authCompleted,
            properties: ["method": provider]
        )
    }
}

// MARK: - Error Response

private struct ErrorResponse: Codable {
    let error: String?
    let message: String?
}
