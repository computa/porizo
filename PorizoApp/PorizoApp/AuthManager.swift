//
//  AuthManager.swift
//  PorizoApp
//
//  Manages user authentication state, token storage, and session lifecycle.
//  Handles signup, login, logout, and automatic token refresh.
//

import Foundation
import AuthenticationServices
import Combine  // For ObservableObject, @Published
import UIKit    // For UIApplication.isProtectedDataAvailable

// MARK: - Auth Models

/// Response from auth endpoints (signup/login)
struct AuthResponse: Codable {
    let userId: String
    let accessToken: String
    let refreshToken: String
    let expiresIn: Int
    let isNewUser: Bool?

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresIn = "expires_in"
        case isNewUser = "is_new_user"
    }
}

/// Response from refresh endpoint
struct RefreshResponse: Codable {
    let accessToken: String
    let refreshToken: String
    let expiresIn: Int

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresIn = "expires_in"
    }
}

/// Current user info
struct AuthUser: Codable {
    let id: String
    let email: String?
    let displayName: String?
    let avatarUrl: String?
    let emailVerified: Bool
    let providers: [String]
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id = "user_id"
        case email
        case displayName = "display_name"
        case avatarUrl = "avatar_url"
        case emailVerified = "email_verified"
        case providers
        case createdAt = "created_at"
    }
}

/// Auth error types
enum AuthError: Error, LocalizedError {
    case invalidCredentials
    case emailExists
    case weakPassword
    case invalidEmail
    case networkError(String)
    case tokenExpired
    case notAuthenticated
    case serverError(String)
    case keychainSaveFailed
    case phoneVerificationFailed(String)
    case registrationFailed(String)

    var errorDescription: String? {
        switch self {
        case .invalidCredentials:
            return "Invalid email or password"
        case .emailExists:
            return "An account with this email already exists"
        case .weakPassword:
            return "Password must be at least 8 characters"
        case .invalidEmail:
            return "Please enter a valid email address"
        case .networkError(let msg):
            return "Network error: \(msg)"
        case .tokenExpired:
            return "Session expired. Please log in again."
        case .notAuthenticated:
            return "Not authenticated"
        case .serverError(let msg):
            return "Server error: \(msg)"
        case .keychainSaveFailed:
            return "Failed to save credentials securely. Please try again."
        case .phoneVerificationFailed(let msg):
            return msg
        case .registrationFailed(let msg):
            return msg
        }
    }
}

/// Phone authentication flow state
enum PhoneAuthState: Sendable, Equatable {
    /// Not in phone auth flow
    case idle
    /// User is entering phone number
    case phoneEntry
    /// User is entering verification code
    case phoneVerification(phoneNumber: String)
    /// New user selecting username after verification
    case usernameSelection(registrationToken: String, phoneNumber: String)
}

// MARK: - AuthManager

/// Manages authentication state and token lifecycle
/// Provides auth tokens to APIClient via closure for Bearer token auth
@MainActor
class AuthManager: ObservableObject {

    // MARK: - Published State

    @Published private(set) var isAuthenticated: Bool = false
    @Published private(set) var currentUser: AuthUser?
    @Published private(set) var isLoading: Bool = false
    @Published private(set) var hasValidatedSession: Bool = false

    /// Phone authentication flow state
    @Published private(set) var phoneAuthState: PhoneAuthState = .idle

    /// Phone number being authenticated (E.164 format)
    @Published var phoneNumber: String = ""

    /// Registration token for new users after phone verification
    @Published private(set) var registrationToken: String?

    /// User ID from authentication (for AuthTokenProvider conformance)
    var authenticatedUserId: String? {
        currentUser?.id ?? KeychainHelper.loadString(key: Self.userIdKey)
    }

    // MARK: - Configuration

    private let baseURL: String
    private let session: URLSession

    // Keychain keys
    private static let accessTokenKey = "porizo_access_token"
    private static let refreshTokenKey = "porizo_refresh_token"
    private static let tokenExpiryKey = "porizo_token_expiry"
    private static let userIdKey = "porizo_auth_user_id"
    private static let deviceTokenKey = "porizo_device_token"
    private static let deviceTokenExpiryKey = "porizo_device_token_expiry"
    private static let appleUserIdKey = "porizo_apple_user_id"
    private static let authProviderKey = "porizo_auth_provider"

    // Token refresh threshold (refresh if less than 2 minutes remaining)
    private let refreshThreshold: TimeInterval = 120

    // Foreground refresh threshold (refresh if less than 10 minutes remaining)
    // More aggressive when returning from background to ensure smooth UX
    private let foregroundRefreshThreshold: TimeInterval = 600

    // MARK: - Refresh Deduplication
    // Ensures only one refresh is in flight at a time; concurrent callers await the same task
    private var refreshTask: Task<Void, Error>?

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

        // Wait for notification with timeout
        return await withCheckedContinuation { continuation in
            var didResume = false
            var observer: NSObjectProtocol?

            // Timeout task
            let timeoutTask = Task { @MainActor in
                try? await Task.sleep(nanoseconds: 5_000_000_000) // 5 seconds
                if !didResume {
                    didResume = true
                    if let obs = observer {
                        NotificationCenter.default.removeObserver(obs)
                    }
                    print("[Auth] Protected data timeout - proceeding without auth")
                    continuation.resume(returning: false)
                }
            }

            // Listen for protected data notification
            observer = NotificationCenter.default.addObserver(
                forName: UIApplication.protectedDataDidBecomeAvailableNotification,
                object: nil,
                queue: .main
            ) { _ in
                if !didResume {
                    didResume = true
                    timeoutTask.cancel()
                    if let obs = observer {
                        NotificationCenter.default.removeObserver(obs)
                    }
                    print("[Auth] Protected data now available")
                    continuation.resume(returning: true)
                }
            }
        }
    }

    // MARK: - Initialization

    init(baseURL: String? = nil) {
        self.baseURL = baseURL ?? AppConfig.apiBaseURL

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        self.session = URLSession(configuration: config)

        // Listen for Apple credential revocation (Apple's WWDC20 requirement)
        // This fires when user revokes access via Settings → Apple ID → Apps Using Apple ID
        NotificationCenter.default.addObserver(
            forName: ASAuthorizationAppleIDProvider.credentialRevokedNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            print("[Auth] Apple credential revoked notification received")
            Task { @MainActor in
                self?.logout()
            }
        }

        // Check for existing tokens
        loadAuthState()
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
                // Don't set isAuthenticated = false here - leave it uninitialized
                // User will see loading state, then auth screen only if truly not logged in
                return
            }

            // Already on MainActor (class-level annotation), no wrapper needed
            self.performKeychainAuthLoad()
        }
    }

    /// Performs the actual Keychain read after protected data is available
    /// Must be called on MainActor
    @MainActor
    private func performKeychainAuthLoad() {
        let accessToken = KeychainHelper.loadString(key: Self.accessTokenKey)
        let refreshToken = KeychainHelper.loadString(key: Self.refreshTokenKey)
        let userId = KeychainHelper.loadString(key: Self.userIdKey)
        let appleUserId = KeychainHelper.loadString(key: Self.appleUserIdKey)
        let authProvider = KeychainHelper.loadString(key: Self.authProviderKey)

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
                    await handleLaunchValidationError(error)
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
    func getAccessToken() async throws -> String? {
        guard isAuthenticated else { return nil }

        // If a refresh is already in flight, await it so we don't return a stale token.
        if let existingTask = refreshTask {
            try await existingTask.value
        }

        // Check if token needs refresh
        if shouldRefreshToken() {
            try await refreshTokens()
        }

        return KeychainHelper.loadString(key: Self.accessTokenKey)
    }

    // MARK: - Proactive Token Refresh

    /// Proactive refresh threshold: refresh if token expires within 5 minutes
    /// This is more aggressive than the reactive `refreshThreshold` (2 min) to avoid 401s
    private let proactiveRefreshThreshold: TimeInterval = 300

    /// Ensures access token is valid before making API calls.
    /// Proactively refreshes if token expires within 5 minutes.
    /// - Returns: Valid access token
    /// - Throws: AuthError.notAuthenticated if unable to get valid token
    func ensureValidAccessToken() async throws -> String {
        // Early exit if not authenticated (matches getAccessToken behavior)
        guard isAuthenticated else {
            throw AuthError.notAuthenticated
        }

        // Check if we have a token at all
        guard let currentToken = KeychainHelper.loadString(key: Self.accessTokenKey) else {
            throw AuthError.notAuthenticated
        }

        // Check expiry with 5-minute buffer (proactive refresh)
        if shouldRefreshToken(threshold: proactiveRefreshThreshold) {
            // Token expires within 5 minutes - refresh proactively
            print("[Auth] Token expires in <5 min, refreshing proactively")
            try await refreshTokens()
        }

        // Return the (possibly refreshed) token
        guard let validToken = KeychainHelper.loadString(key: Self.accessTokenKey) else {
            throw AuthError.notAuthenticated
        }

        return validToken
    }

    /// Get the token expiry date from keychain
    private func tokenExpiryDate() -> Date? {
        guard let expiryString = KeychainHelper.loadString(key: Self.tokenExpiryKey),
              let expiry = Double(expiryString) else {
            return nil
        }
        return Date(timeIntervalSince1970: expiry)
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
            // Don't logout on refresh failure when returning from background
            // The token might still be valid - let API calls determine if re-login needed
            print("[Auth] Foreground refresh failed (will retry on next API call): \(error.localizedDescription)")
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

    // MARK: - Signup

    /// Create a new account with email and password
    func signup(email: String, password: String, name: String? = nil) async throws {
        isLoading = true
        defer { isLoading = false }

        let url = URL(string: "\(baseURL)/auth/signup")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        var body: [String: Any] = [
            "email": email.lowercased().trimmingCharacters(in: .whitespaces),
            "password": password
        ]
        if let name = name, !name.isEmpty {
            body["name"] = name
        }

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw AuthError.networkError("Invalid response")
        }

        switch httpResponse.statusCode {
        case 201:
            let authResponse = try JSONDecoder().decode(AuthResponse.self, from: data)
            try saveTokens(authResponse)
            setAuthProvider("password")
            isAuthenticated = true
            try await fetchCurrentUser()

        case 400:
            if let errorResponse = try? JSONDecoder().decode(ErrorResponse.self, from: data) {
                if errorResponse.error == "INVALID_EMAIL" || errorResponse.message?.contains("email") == true {
                    throw AuthError.invalidEmail
                } else if errorResponse.error == "WEAK_PASSWORD" || errorResponse.message?.contains("password") == true {
                    throw AuthError.weakPassword
                }
            }
            throw AuthError.invalidCredentials

        case 409:
            throw AuthError.emailExists

        case 429:
            throw AuthError.serverError("Too many attempts. Please try again later.")

        default:
            throw AuthError.serverError("Signup failed (HTTP \(httpResponse.statusCode))")
        }
    }

    // MARK: - Login

    /// Login with email and password
    func login(email: String, password: String) async throws {
        isLoading = true
        defer { isLoading = false }

        let url = URL(string: "\(baseURL)/auth/login")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "email": email.lowercased().trimmingCharacters(in: .whitespaces),
            "password": password
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw AuthError.networkError("Invalid response")
        }

        switch httpResponse.statusCode {
        case 200:
            let authResponse = try JSONDecoder().decode(AuthResponse.self, from: data)
            try saveTokens(authResponse)
            setAuthProvider("password")
            isAuthenticated = true
            try await fetchCurrentUser()

        case 401:
            throw AuthError.invalidCredentials

        case 423:
            throw AuthError.serverError("Account temporarily locked. Please try again later.")

        case 429:
            throw AuthError.serverError("Too many attempts. Please try again later.")

        default:
            throw AuthError.serverError("Login failed (HTTP \(httpResponse.statusCode))")
        }
    }

    // MARK: - Social Auth (Apple)

    /// Handle Sign in with Apple
    func handleAppleSignIn(authorization: ASAuthorization, nonce: String) async throws {
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
            let authResponse = try JSONDecoder().decode(AuthResponse.self, from: data)
            try saveTokens(authResponse)

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

    /// Handle OAuth authorization code sign-in for Google/Facebook
    func handleOAuthAuthorization(
        provider: String,
        authorizationCode: String,
        codeVerifier: String? = nil,
        redirectUri: String? = nil,
        name: String? = nil
    ) async throws {
        isLoading = true
        defer { isLoading = false }

        let url = URL(string: "\(baseURL)/auth/social")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        var body: [String: Any] = [
            "provider": provider,
            "authorization_code": authorizationCode
        ]

        if let codeVerifier {
            body["code_verifier"] = codeVerifier
        }

        if let redirectUri {
            body["redirect_uri"] = redirectUri
        }

        if let name, !name.isEmpty {
            body["name"] = name
        }

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw AuthError.networkError("Invalid response")
        }

        switch httpResponse.statusCode {
        case 200, 201:
            let authResponse = try JSONDecoder().decode(AuthResponse.self, from: data)
            try saveTokens(authResponse)
            setAuthProvider(provider)
            isAuthenticated = true
            try await fetchCurrentUser()

        case 501:
            throw AuthError.serverError("\(provider.capitalized) authentication is not configured.")

        case 400:
            let error = try? JSONDecoder().decode(ErrorResponse.self, from: data)
            throw AuthError.serverError(error?.message ?? "Invalid \(provider) authorization.")

        default:
            throw AuthError.serverError("\(provider.capitalized) sign-in failed (HTTP \(httpResponse.statusCode))")
        }
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
    /// Routes to either:
    /// - Authenticated state (existing user with tokens)
    /// - Username selection (new user with registration token)
    /// - Parameters:
    ///   - response: The verification response from the API
    func handlePhoneVerification(_ response: VerifyPhoneCodeResponse) async throws {
        guard response.verified else {
            throw AuthError.phoneVerificationFailed("Verification failed")
        }

        // Case 1: Existing user - response contains auth tokens
        if let accessToken = response.accessToken,
           let refreshToken = response.refreshToken,
           let userId = response.userId {
            print("[Auth] Phone verification: existing user, logging in")

            // Create AuthResponse-compatible structure for token saving
            let expiresIn = 3600 // Default 1 hour, backend should return this
            let authResponse = AuthResponse(
                userId: userId,
                accessToken: accessToken,
                refreshToken: refreshToken,
                expiresIn: expiresIn,
                isNewUser: response.isNewUser
            )

            try saveTokens(authResponse)
            setAuthProvider("phone")

            // Clear phone auth state
            phoneAuthState = .idle
            registrationToken = nil

            isAuthenticated = true
            try await fetchCurrentUser()
            print("[Auth] Phone login successful for existing user")
            return
        }

        // Case 2: New user - response contains registration token
        if let regToken = response.registrationToken {
            print("[Auth] Phone verification: new user, proceeding to username selection")
            registrationToken = regToken
            phoneAuthState = .usernameSelection(registrationToken: regToken, phoneNumber: phoneNumber)
            return
        }

        // Neither case matched - unexpected response
        throw AuthError.phoneVerificationFailed("Invalid verification response")
    }

    /// Complete phone registration for new users
    /// Called after user selects username in UsernameView
    /// - Parameters:
    ///   - username: The chosen username
    ///   - name: Optional display name
    ///   - apiClient: The APIClient to use for registration
    func completePhoneRegistration(username: String, name: String?, apiClient: APIClient) async throws {
        guard let regToken = registrationToken else {
            throw AuthError.registrationFailed("No registration token available")
        }

        isLoading = true
        defer { isLoading = false }

        print("[Auth] Completing phone registration for username: \(username)")

        let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "completePhoneRegistration") {
            try await apiClient.registerWithPhone(
                registrationToken: regToken,
                username: username,
                name: name
            )
        }

        // Save tokens from registration response
        // PhoneRegisterResponse doesn't have expiresIn, so we use a reasonable default
        let expiresIn = 3600 // 1 hour default
        let authResponse = AuthResponse(
            userId: response.userId,
            accessToken: response.accessToken,
            refreshToken: response.refreshToken,
            expiresIn: expiresIn,
            isNewUser: true
        )

        try saveTokens(authResponse)
        setAuthProvider("phone")

        // Clear phone auth state
        phoneAuthState = .idle
        phoneNumber = ""
        registrationToken = nil

        isAuthenticated = true
        try await fetchCurrentUser()
        print("[Auth] Phone registration completed successfully")
    }

    /// Save phone registration response from UsernameView
    func handlePhoneRegistrationResponse(_ response: PhoneRegisterResponse) async throws {
        let expiresIn = 3600 // 1 hour default
        let authResponse = AuthResponse(
            userId: response.userId,
            accessToken: response.accessToken,
            refreshToken: response.refreshToken,
            expiresIn: expiresIn,
            isNewUser: true
        )

        try saveTokens(authResponse)
        setAuthProvider("phone")
        phoneAuthState = .idle
        phoneNumber = ""
        registrationToken = nil

        isAuthenticated = true
        try await fetchCurrentUser()
        print("[Auth] Phone registration completed successfully")
    }

    /// Go back one step in phone auth flow
    func phoneAuthGoBack() {
        switch phoneAuthState {
        case .idle:
            break // Already idle
        case .phoneEntry:
            phoneAuthState = .idle
        case .phoneVerification:
            phoneAuthState = .phoneEntry
        case .usernameSelection:
            // Can't go back from username selection to verification
            // (verification code would be expired)
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
    func refreshTokens() async throws {
        // Check if a refresh is already in progress - if so, await it
        if let existingTask = refreshTask {
            print("[Auth] Refresh already in progress, awaiting existing task")
            try await existingTask.value
            return
        }

        // Create a new refresh task and store it for deduplication
        // Note: Task captures self strongly during execution, which is safe since
        // we clear refreshTask after the task completes (not in defer)
        let task = Task<Void, Error> {
            try await self.performRefresh()
        }
        refreshTask = task

        // Await the refresh and clear the task reference AFTER completion
        // This is critical: defer would clear it BEFORE await completes,
        // allowing duplicate tasks to be created during execution
        do {
            try await task.value
            refreshTask = nil
        } catch {
            refreshTask = nil
            throw error
        }
    }

    /// Internal refresh implementation - called only by the deduplicated wrapper
    private func performRefresh() async throws {
        guard let refreshToken = KeychainHelper.loadString(key: Self.refreshTokenKey) else {
            // Missing refresh token is a critical state - log before taking action
            print("[Auth] CRITICAL: No refresh token in keychain during refresh attempt")
            logout()
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
            try saveRefreshedTokens(refreshResponse)
            print("[Auth] Token refresh successful")

        case 401:
            print("[Auth] Refresh returned 401")
            // Check if this is a definitive rejection (token reuse, revoked)
            // vs a temporary issue we should retry
            if let errorBody = try? JSONDecoder().decode(RefreshErrorResponse.self, from: data) {
                print("[Auth] Refresh error: \(errorBody.error ?? "unknown") - \(errorBody.message ?? "no message")")

                // These errors mean the token is definitively invalid - must re-login
                let definitiveErrors = [
                    "TOKEN_REUSE_DETECTED",
                    "TOKEN_REVOKED",
                    "TOKEN_EXPIRED",
                    "INVALID_TOKEN",
                    "INVALID_REFRESH_TOKEN",
                    "TOKEN_ALREADY_ROTATED",
                    "TOKEN_FAMILY_COMPROMISED"
                ]

                if definitiveErrors.contains(errorBody.error ?? "") {
                    print("[Auth] Definitive token rejection: \(errorBody.error ?? "unknown") - logging out")
                    logout()
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
        if let token = KeychainHelper.loadString(key: Self.accessTokenKey) {
            Task {
                let url = URL(string: "\(baseURL)/auth/logout")!
                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                try? await session.data(for: request)
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

        isAuthenticated = false
        hasValidatedSession = false
        currentUser = nil
    }

    // MARK: - Current User

    /// Fetch current user details
    func fetchCurrentUser() async throws {
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
            currentUser = try JSONDecoder().decode(AuthUser.self, from: data)
            hasValidatedSession = true
            print("[Auth] fetchCurrentUser success: user=\(currentUser?.id ?? "nil")")
        } else if httpResponse.statusCode == 401 {
            // Token expired, try refresh
            print("[Auth] fetchCurrentUser got 401, attempting refresh")
            try await refreshTokens()
            try await fetchCurrentUser()
        } else {
            print("[Auth] fetchCurrentUser unexpected status: \(httpResponse.statusCode)")
            throw AuthError.serverError("Failed to fetch user (HTTP \(httpResponse.statusCode))")
        }
    }

    // MARK: - Password Reset

    /// Request password reset email
    func requestPasswordReset(email: String) async throws {
        let url = URL(string: "\(baseURL)/auth/forgot-password")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = ["email": email.lowercased().trimmingCharacters(in: .whitespaces)]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (_, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw AuthError.serverError("Failed to send reset email")
        }
        // Always succeeds to prevent email enumeration
    }

    // MARK: - Account Deletion

    /// Delete user account and all associated data
    /// This is irreversible and required for App Store compliance
    func deleteAccount() async throws {
        guard let token = KeychainHelper.loadString(key: Self.accessTokenKey) else {
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

    private func saveTokens(_ response: AuthResponse) throws {
        guard KeychainHelper.saveString(key: Self.accessTokenKey, value: response.accessToken),
              KeychainHelper.saveString(key: Self.refreshTokenKey, value: response.refreshToken),
              KeychainHelper.saveString(key: Self.userIdKey, value: response.userId) else {
            print("[Auth] ERROR: Failed to save tokens to keychain")
            throw AuthError.keychainSaveFailed
        }

        // Calculate expiry time
        let expiry = Date().addingTimeInterval(TimeInterval(response.expiresIn))
        guard KeychainHelper.saveString(key: Self.tokenExpiryKey, value: String(expiry.timeIntervalSince1970)) else {
            print("[Auth] ERROR: Failed to save token expiry to keychain")
            throw AuthError.keychainSaveFailed
        }

        print("[Auth] All tokens saved successfully")
    }

    private func saveRefreshedTokens(_ response: RefreshResponse) throws {
        guard KeychainHelper.saveString(key: Self.accessTokenKey, value: response.accessToken),
              KeychainHelper.saveString(key: Self.refreshTokenKey, value: response.refreshToken) else {
            print("[Auth] ERROR: Failed to save refreshed tokens to keychain")
            throw AuthError.keychainSaveFailed
        }

        let expiry = Date().addingTimeInterval(TimeInterval(response.expiresIn))
        guard KeychainHelper.saveString(key: Self.tokenExpiryKey, value: String(expiry.timeIntervalSince1970)) else {
            print("[Auth] ERROR: Failed to save token expiry to keychain")
            throw AuthError.keychainSaveFailed
        }

        print("[Auth] Refreshed tokens saved successfully")
    }

    private func setAuthProvider(_ provider: String) {
        let saved = KeychainHelper.saveString(key: Self.authProviderKey, value: provider)
        if !saved {
            print("[Auth] ERROR: Failed to save auth provider \(provider)")
        }
    }
}

// MARK: - Error Response

private struct ErrorResponse: Codable {
    let error: String?
    let message: String?
}
