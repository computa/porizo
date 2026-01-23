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
        }
    }
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

    // Token refresh threshold (refresh if less than 2 minutes remaining)
    private let refreshThreshold: TimeInterval = 120

    // Foreground refresh threshold (refresh if less than 10 minutes remaining)
    // More aggressive when returning from background to ensure smooth UX
    private let foregroundRefreshThreshold: TimeInterval = 600

    // MARK: - Initialization

    init(baseURL: String? = nil) {
        // Use provided URL or app configuration
        if let baseURL = baseURL {
            self.baseURL = baseURL
        } else {
            self.baseURL = AppConfig.apiBaseURL
        }

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        self.session = URLSession(configuration: config)

        // Check for existing tokens
        loadAuthState()
    }

    // MARK: - Auth State

    /// Loads existing auth state from Keychain
    private func loadAuthState() {
        if let _ = KeychainHelper.loadString(key: Self.accessTokenKey),
           let userId = KeychainHelper.loadString(key: Self.userIdKey) {
            isAuthenticated = true
            // Load user details in background
            Task {
                try? await fetchCurrentUser()
            }
        }
    }

    /// Get the current access token, refreshing if needed
    func getAccessToken() async throws -> String? {
        guard isAuthenticated else { return nil }

        // Check if token needs refresh
        if shouldRefreshToken() {
            try await refreshTokens()
        }

        return KeychainHelper.loadString(key: Self.accessTokenKey)
    }

    /// Check if token should be refreshed
    private func shouldRefreshToken(threshold: TimeInterval? = nil) -> Bool {
        guard let expiryString = KeychainHelper.loadString(key: Self.tokenExpiryKey),
              let expiry = Double(expiryString) else {
            return true
        }

        let expiryDate = Date(timeIntervalSince1970: expiry)
        return expiryDate.timeIntervalSinceNow < (threshold ?? refreshThreshold)
    }

    /// Check if token is actually expired (not just needing refresh)
    private func isTokenExpired() -> Bool {
        guard let expiryString = KeychainHelper.loadString(key: Self.tokenExpiryKey),
              let expiry = Double(expiryString) else {
            return true
        }

        let expiryDate = Date(timeIntervalSince1970: expiry)
        return expiryDate.timeIntervalSinceNow <= 0
    }

    // MARK: - Foreground Refresh

    /// Called when app returns to foreground to proactively refresh tokens
    /// This enables Spotify-style persistent login where users never see re-login prompts
    func refreshTokensIfNeeded() async {
        guard isAuthenticated else { return }

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
            saveTokens(authResponse)
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
            saveTokens(authResponse)
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
    func handleAppleSignIn(authorization: ASAuthorization) async throws {
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
            "id_token": tokenString
        ]

        // Apple only provides name on first sign-in
        if let fullName = credential.fullName {
            let name = [fullName.givenName, fullName.familyName]
                .compactMap { $0 }
                .joined(separator: " ")
            if !name.isEmpty {
                body["name"] = name
            }
        }

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw AuthError.networkError("Invalid response")
        }

        switch httpResponse.statusCode {
        case 200, 201:
            let authResponse = try JSONDecoder().decode(AuthResponse.self, from: data)
            saveTokens(authResponse)
            isAuthenticated = true
            try await fetchCurrentUser()

        case 400:
            throw AuthError.serverError("Invalid Apple token")

        default:
            throw AuthError.serverError("Apple sign-in failed (HTTP \(httpResponse.statusCode))")
        }
    }

    // MARK: - Token Refresh

    /// Refresh the access token using refresh token
    /// Implements graceful error handling:
    /// - Only logs out on definitive token rejection (reuse, revoked)
    /// - Network/server errors don't trigger logout (token may still be valid)
    func refreshTokens() async throws {
        guard let refreshToken = KeychainHelper.loadString(key: Self.refreshTokenKey) else {
            logout()
            throw AuthError.notAuthenticated
        }

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
            saveRefreshedTokens(refreshResponse)

        case 401:
            // Check if this is a definitive rejection (token reuse, revoked)
            // vs a temporary issue we should retry
            if let errorBody = try? JSONDecoder().decode(RefreshErrorResponse.self, from: data) {
                // These errors mean the token is definitively invalid - must re-login
                let definitiveErrors = ["TOKEN_REUSE_DETECTED", "TOKEN_REVOKED", "TOKEN_EXPIRED", "INVALID_TOKEN"]
                if definitiveErrors.contains(errorBody.error ?? "") {
                    print("[Auth] Definitive token rejection: \(errorBody.error ?? "unknown")")
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

        isAuthenticated = false
        currentUser = nil
    }

    // MARK: - Current User

    /// Fetch current user details
    func fetchCurrentUser() async throws {
        guard let token = KeychainHelper.loadString(key: Self.accessTokenKey) else {
            throw AuthError.notAuthenticated
        }

        let url = URL(string: "\(baseURL)/auth/me")!
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw AuthError.networkError("Invalid response")
        }

        if httpResponse.statusCode == 200 {
            currentUser = try JSONDecoder().decode(AuthUser.self, from: data)
        } else if httpResponse.statusCode == 401 {
            // Token expired, try refresh
            try await refreshTokens()
            try await fetchCurrentUser()
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

    private func saveTokens(_ response: AuthResponse) {
        _ = KeychainHelper.saveString(key: Self.accessTokenKey, value: response.accessToken)
        _ = KeychainHelper.saveString(key: Self.refreshTokenKey, value: response.refreshToken)
        _ = KeychainHelper.saveString(key: Self.userIdKey, value: response.userId)

        // Calculate expiry time
        let expiry = Date().addingTimeInterval(TimeInterval(response.expiresIn))
        _ = KeychainHelper.saveString(key: Self.tokenExpiryKey, value: String(expiry.timeIntervalSince1970))
    }

    private func saveRefreshedTokens(_ response: RefreshResponse) {
        _ = KeychainHelper.saveString(key: Self.accessTokenKey, value: response.accessToken)
        _ = KeychainHelper.saveString(key: Self.refreshTokenKey, value: response.refreshToken)

        let expiry = Date().addingTimeInterval(TimeInterval(response.expiresIn))
        _ = KeychainHelper.saveString(key: Self.tokenExpiryKey, value: String(expiry.timeIntervalSince1970))
    }
}

// MARK: - Error Response

private struct ErrorResponse: Codable {
    let error: String?
    let message: String?
}
