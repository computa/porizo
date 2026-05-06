//
//  APIClient.swift
//  PorizoApp
//
//  HTTP client for communicating with the Porizo backend.
//  Core infrastructure: configuration, auth, request building, retry logic, response validation.
//
//  Domain-specific API methods are in extensions:
//  - APIClient+Auth.swift      - Phone authentication
//  - APIClient+Enrollment.swift - Voice enrollment and device registration
//  - APIClient+Tracks.swift    - Track creation, rendering, lyrics, reroll
//  - APIClient+Share.swift     - Track sharing
//  - APIClient+Poems.swift     - Poem creation and sharing
//  - APIClient+Story.swift     - Story Q&A flow
//  - APIClient+Billing.swift   - Billing and subscriptions
//

import Foundation
import UIKit  // For BackgroundTaskManager

/// Closure type for providing auth tokens from AuthManager
/// Using closure avoids actor isolation issues between APIClient (actor) and AuthManager (@MainActor)
typealias AuthTokenClosure = @Sendable () async -> (token: String?, userId: String?)
/// Closure type for refreshing auth tokens (called by APIClient on 401)
typealias AuthRefreshClosure = @Sendable () async throws -> String
/// Closure type for handling auth failures (401/missing token)
typealias AuthFailureClosure = @MainActor @Sendable () -> Void
/// Closure type for proactive token validation (refreshes if near expiry, returns valid token)
typealias AuthProactiveRefreshClosure = @Sendable () async throws -> String

/// API client for Porizo backend
actor APIClient {

    // MARK: - Configuration

    /// Base URL for the API.
    let baseURL: String

    /// Device ID (generated once, stored in Keychain)
    /// Used for device registration and share binding
    let deviceUserId: String

    /// Optional closure for getting auth tokens
    /// When set, API calls use Bearer tokens
    private var getAuthToken: AuthTokenClosure?
    /// Optional closure for refreshing auth tokens (called on 401 before logout)
    private var getAuthRefresh: AuthRefreshClosure?
    /// Optional closure for proactive token validation (refreshes if near expiry)
    private var getProactiveToken: AuthProactiveRefreshClosure?
    /// Optional handler invoked when auth fails definitively
    private var onAuthFailure: AuthFailureClosure?

    /// Shared JSON decoder configured for API responses
    /// NOTE: Do NOT use .convertFromSnakeCase here - our models have explicit
    /// CodingKeys that already map snake_case to camelCase. Using both causes
    /// double-conversion where keys become unrecognized.
    static let jsonDecoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        // Explicit CodingKeys in models handle snake_case -> camelCase mapping
        return decoder
    }()

    /// URLSession with configured timeouts
    static let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 120  // 120s per request (LLM pipeline can exceed 60s)
        config.timeoutIntervalForResource = 300  // 5min total (for large uploads)
        config.waitsForConnectivity = false  // Fail fast instead of hanging on poor network
        return URLSession(configuration: config)
    }()

    // MARK: - Initialization

    init(baseURL: String = AppConfig.apiBaseURL, userId: String? = nil, authTokenProvider: AuthTokenClosure? = nil) {
        self.baseURL = baseURL
        #if DEBUG
        let debugOverrideUserId = ProcessInfo.processInfo.environment["PORIZO_BYPASS_USER_ID"]?.trimmingCharacters(in: .whitespacesAndNewlines)
        #else
        let debugOverrideUserId: String? = nil
        #endif
        if let debugOverrideUserId, !debugOverrideUserId.isEmpty {
            self.deviceUserId = debugOverrideUserId
        } else if let userId, !userId.isEmpty {
            self.deviceUserId = userId
        } else {
            self.deviceUserId = Self.getOrCreateUserId()
        }
        self.getAuthToken = authTokenProvider
    }

    /// Set the auth token provider after initialization
    /// Call this when AuthManager becomes available
    func setAuthTokenProvider(_ provider: @escaping AuthTokenClosure) {
        self.getAuthToken = provider
    }

    /// Set the auth refresh provider (called on 401 to attempt token refresh before logout)
    func setAuthRefreshProvider(_ provider: @escaping AuthRefreshClosure) {
        self.getAuthRefresh = provider
    }

    /// Set the proactive token provider (validates token and refreshes if near expiry)
    /// This enables proactive refresh BEFORE API calls to avoid 401s
    func setProactiveTokenProvider(_ provider: @escaping AuthProactiveRefreshClosure) {
        self.getProactiveToken = provider
    }

    /// Call this to be notified when auth fails definitively (after refresh attempt)
    func setAuthFailureHandler(_ handler: @escaping AuthFailureClosure) {
        self.onAuthFailure = handler
    }

    /// Clear the auth provider (e.g., on logout)
    func clearAuthTokenProvider() {
        self.getAuthToken = nil
    }

    /// Get current auth headers for streaming (e.g., AudioPlayerService)
    func streamingAuthHeaders() async -> [String: String]? {
        guard let token = await currentAuthToken() else { return nil }
        return ["Authorization": "Bearer \(token)"]
    }

    // MARK: - User ID Management

    private static let userIdKey = "porizo_user_id"
    private static let deviceTokenKey = "porizo_device_token"
    private static let deviceTokenExpiryKey = "porizo_device_token_expiry"

    /// Gets or creates a user ID. This is nonisolated because:
    /// 1. It's called from the actor's nonisolated init
    /// 2. KeychainHelper uses thread-safe Security framework
    /// 3. UserDefaults is also thread-safe for reads
    private nonisolated static func getOrCreateUserId() -> String {
        // Try to get existing ID from Keychain (secure storage)
        if let existingId = KeychainHelper.loadString(key: userIdKey) {
            return existingId
        }

        // Migration: Check UserDefaults for existing ID (from previous versions)
        if let legacyId = UserDefaults.standard.string(forKey: userIdKey),
           isValidUserId(legacyId) {
            // Migrate to Keychain
            _ = KeychainHelper.saveString(key: userIdKey, value: legacyId)
            // Clean up UserDefaults
            UserDefaults.standard.removeObject(forKey: userIdKey)
            return legacyId
        } else if UserDefaults.standard.string(forKey: userIdKey) != nil {
            // Invalid format - clean up and generate new ID
            UserDefaults.standard.removeObject(forKey: userIdKey)
        }

        // Generate new device-bound ID
        // TODO: Future - replace with bearer auth after OAuth integration
        let newId = "ios_\(UUID().uuidString.lowercased().prefix(12))"
        _ = KeychainHelper.saveString(key: userIdKey, value: newId)
        return newId
    }

    func getUserId() -> String {
        return deviceUserId
    }

    // MARK: - Device Token

    func currentDeviceToken() -> String? {
        KeychainHelper.loadString(key: Self.deviceTokenKey)
    }

    func storeDeviceToken(_ token: String, expiresAt: String) {
        _ = KeychainHelper.saveString(key: Self.deviceTokenKey, value: token)
        _ = KeychainHelper.saveString(key: Self.deviceTokenExpiryKey, value: expiresAt)
    }

    func deviceTokenIsValid() -> Bool {
        guard let expiry = KeychainHelper.loadString(key: Self.deviceTokenExpiryKey) else {
            return false
        }
        guard let expiryDate = try? Date(expiry, strategy: .iso8601) else {
            return false
        }
        return expiryDate.timeIntervalSinceNow > 60
    }

    func clearDeviceToken() {
        KeychainHelper.delete(key: Self.deviceTokenKey)
        KeychainHelper.delete(key: Self.deviceTokenExpiryKey)
    }

    /// Validates user ID format before migration
    /// - Format: 8-64 characters, alphanumeric with underscores/hyphens
    /// - New format: ios_xxxxxxxxxxxx (ios_ prefix + 12 hex chars)
    /// - Legacy formats also accepted if they meet basic constraints
    private nonisolated static func isValidUserId(_ id: String) -> Bool {
        // Must have reasonable length
        guard id.count >= 8 && id.count <= 64 else { return false }

        // Must contain only safe characters (alphanumeric, underscore, hyphen)
        let allowedCharacters = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "_-"))
        guard id.unicodeScalars.allSatisfy({ allowedCharacters.contains($0) }) else { return false }

        return true
    }

    func shouldRetryDeviceToken(httpResponse: HTTPURLResponse, data: Data) -> Bool {
        guard httpResponse.statusCode == 401 else { return false }
        if let apiError = try? Self.jsonDecoder.decode(APIError.self, from: data) {
            return apiError.error == "INVALID_DEVICE_TOKEN" || apiError.error == "DEVICE_TOKEN_REQUIRED"
        }
        return false
    }

    // MARK: - Logging Sanitization

    /// Sensitive field patterns to redact from error logs
    private static let sensitivePatterns: [(pattern: String, replacement: String)] = [
        ("\"token\"\\s*:\\s*\"[^\"]+\"", "\"token\":\"[REDACTED]\""),
        ("\"access_token\"\\s*:\\s*\"[^\"]+\"", "\"access_token\":\"[REDACTED]\""),
        ("\"refresh_token\"\\s*:\\s*\"[^\"]+\"", "\"refresh_token\":\"[REDACTED]\""),
        ("\"password\"\\s*:\\s*\"[^\"]+\"", "\"password\":\"[REDACTED]\""),
        ("\"secret\"\\s*:\\s*\"[^\"]+\"", "\"secret\":\"[REDACTED]\""),
        ("\"api_key\"\\s*:\\s*\"[^\"]+\"", "\"api_key\":\"[REDACTED]\""),
        ("\"receipt\"\\s*:\\s*\"[^\"]+\"", "\"receipt\":\"[REDACTED]\""),
        ("\"email\"\\s*:\\s*\"[^\"]+\"", "\"email\":\"[REDACTED]\""),
    ]

    /// Sanitizes response text for logging by redacting sensitive fields
    static func sanitizeForLogging(_ text: String, maxLength: Int = 200) -> String {
        var sanitized = text

        for (pattern, replacement) in sensitivePatterns {
            if let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) {
                sanitized = regex.stringByReplacingMatches(
                    in: sanitized,
                    range: NSRange(sanitized.startIndex..., in: sanitized),
                    withTemplate: replacement
                )
            }
        }

        // Truncate to max length
        if sanitized.count > maxLength {
            return String(sanitized.prefix(maxLength)) + "...[truncated]"
        }
        return sanitized
    }

    // MARK: - Request Building

    /// App version for User-Agent header
    static let appVersion: String = {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "PorizoApp/\(version)(\(build))"
    }()

    /// Applies authorization headers to a request.
    /// Uses proactive token refresh if available (refreshes if near expiry).
    /// Falls back to existing token, then x-user-id for development.
    func applyAuthHeaders(_ request: inout URLRequest, requiresAuth: Bool = true) async throws {
        #if DEBUG
        if ProcessInfo.processInfo.environment["PORIZO_BYPASS_AUTH"] == "1" {
            request.setValue(deviceUserId, forHTTPHeaderField: "x-user-id")
            request.setValue(nil, forHTTPHeaderField: "Authorization")
            return
        }
        #endif

        // STEP 1: Try proactive token validation (refreshes if near expiry)
        // This prevents 401s by ensuring token is valid BEFORE the request
        if let proactiveProvider = getProactiveToken {
            do {
                let token = try await proactiveProvider()
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                #if DEBUG
                print("[APIClient] Applied proactive token: \(String(token.prefix(20)))...")
                #endif
                return
            } catch AuthError.notAuthenticated {
                // No authenticated session - fall through to existing handling
                print("[APIClient] No authenticated session for proactive token check")
            } catch {
                // Proactive refresh failed - log but try with existing token
                // The 401 retry logic will handle it if the token is actually expired
                print("[APIClient] Proactive refresh failed: \(error.localizedDescription)")
            }
        }

        // STEP 2: Fall back to existing token provider (no proactive refresh)
        if let authClosure = getAuthToken {
            let authResult = await authClosure()
            if let token = authResult.token {
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                #if DEBUG
                print("[APIClient] Applied fallback token: \(String(token.prefix(20)))...")
                #endif
                return
            }

            // No token available; attempt refresh before failing
            if requiresAuth, let refreshProvider = getAuthRefresh {
                do {
                    print("[APIClient] Missing token - attempting refresh before request")
                    let refreshedToken = try await refreshProvider()
                    if !refreshedToken.isEmpty {
                        request.setValue("Bearer \(refreshedToken)", forHTTPHeaderField: "Authorization")
                        return
                    }

                    // Defensive fallback: if refresh succeeded but returned empty token,
                    // attempt one keychain-backed token read.
                    let refreshed = await authClosure()
                    if let token = refreshed.token {
                        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                        return
                    }
                } catch {
                    #if DEBUG
                    // In DEBUG builds, allow falling through to x-user-id when user isn't authenticated yet
                    // This is NOT a failed auth - just "no auth yet" in development
                    if case AuthError.notAuthenticated = error {
                        print("[APIClient] Not authenticated in DEBUG - falling back to x-user-id")
                        // Fall through to x-user-id block below
                    } else {
                        // Other errors (tokenExpired, transient failures) still throw in DEBUG
                        let isDefinitiveFailure: Bool = {
                            if case AuthError.tokenExpired = error { return true }
                            if case AuthError.keychainSaveFailed = error { return true }
                            return false
                        }()

                        if isDefinitiveFailure {
                            notifyAuthFailure()
                            throw APIClientError.notAuthenticated
                        }
                        throw APIClientError.authRefreshFailed
                    }
                    #else
                    // Production: handle all auth failures strictly
                    let isDefinitiveFailure: Bool = {
                        if case AuthError.tokenExpired = error { return true }
                        if case AuthError.notAuthenticated = error { return true }
                        if case AuthError.keychainSaveFailed = error { return true }
                        return false
                    }()

                    if isDefinitiveFailure {
                        notifyAuthFailure()
                        throw APIClientError.notAuthenticated
                    }

                    // Transient refresh failure - don't logout here
                    throw APIClientError.authRefreshFailed
                    #endif
                }
            }
        }

        // STEP 3: Fallback to x-user-id header for development (when ALLOW_ANON_USER_ID=true on backend)
        #if DEBUG
        request.setValue(deviceUserId, forHTTPHeaderField: "x-user-id")
        #else
        if requiresAuth {
            notifyAuthFailure()
            throw APIClientError.notAuthenticated
        }
        #endif
    }

    /// Creates a URLRequest with common headers
    func makeRequest(url: URL, method: String = "GET", requiresAuth: Bool = true) async throws -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(Self.appVersion, forHTTPHeaderField: "User-Agent")
        try await applyAuthHeaders(&request, requiresAuth: requiresAuth)
        return request
    }

    // MARK: - Response Decoding

    /// Decode a response or throw a detailed decodingError.
    /// Replaces the 60+ copy-pasted decode-or-throw blocks across all APIClient extensions.
    func decodeResponse<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try Self.jsonDecoder.decode(type, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("\(type): \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    // MARK: - Retry Logic

    /// Retries an async operation with exponential backoff on transient errors.
    /// - Parameters:
    ///   - maxAttempts: Maximum number of attempts (default: 3)
    ///   - initialDelay: Initial delay in seconds (default: 1.0)
    ///   - operation: The async throwing operation to retry
    /// - Returns: The result of the operation
    func withRetry<T>(
        maxAttempts: Int = 3,
        initialDelay: TimeInterval = 1.0,
        operation: () async throws -> T
    ) async throws -> T {
        var lastError: Error?
        var delay = initialDelay

        for attempt in 1...maxAttempts {
            do {
                return try await operation()
            } catch {
                lastError = error

                // Don't retry on non-transient errors
                guard isTransientError(error) else {
                    throw error
                }

                // Don't retry if this was the last attempt
                guard attempt < maxAttempts else {
                    break
                }

                // Respect Retry-After header for rate limiting, otherwise use exponential backoff
                var retryDelay = delay
                if case APIClientError.rateLimited(let retryAfter) = error,
                   let seconds = retryAfter {
                    retryDelay = max(Double(seconds), delay)
                }

                // Wait with backoff, capped at 3 seconds max (reduced for faster failure)
                try? await Task.sleep(for: .seconds(min(retryDelay, 3.0)))
                delay = min(delay * 2, 3.0)  // Double delay for next attempt, capped
            }
        }

        throw lastError ?? APIClientError.invalidResponse
    }

    /// Determines if an error is transient and worth retrying
    private func isTransientError(_ error: Error) -> Bool {
        // Network errors are transient
        if let urlError = error as? URLError {
            switch urlError.code {
            case .timedOut, .networkConnectionLost, .notConnectedToInternet,
                 .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed:
                return true
            default:
                return false
            }
        }

        // Server errors (5xx) and rate limiting (429) are transient
        if case APIClientError.httpError(let statusCode, _) = error {
            // Retry on 5xx server errors and 429 rate limit (defense-in-depth)
            return statusCode >= 500 || statusCode == 429
        }

        // Rate limiting is transient - should retry after delay
        if case APIClientError.rateLimited = error {
            return true
        }

        return false
    }

    // MARK: - Auth Refresh and Retry

    /// Executes a request with automatic refresh-and-retry on 401
    /// - Parameter request: The URLRequest to execute
    /// - Parameter allowedStatusCodes: Non-2xx status codes that should be treated as valid
    /// - Returns: Tuple of response data and HTTP response
    func executeWithAuthRetry(
        request: URLRequest,
        allowedStatusCodes: Set<Int> = []
    ) async throws -> (Data, URLResponse) {
        let requestEpoch = await RefreshCoordinator.shared.currentEpoch()
        let originalToken = bearerToken(from: request)
        let (data, response) = try await Self.session.data(for: request)

        do {
            try validateResponse(response, data: data, isRetry: false, allowedStatusCodes: allowedStatusCodes)
            return (data, response)
        } catch APIClientError.authRefreshNeeded {
            // If another request already refreshed the token, retry once with the newest token.
            if let usedToken = originalToken, let currentToken = await currentAuthToken(), currentToken != usedToken {
                print("[APIClient] 401 with stale token - retrying with newer token")
                return try await executeRetry(
                    request: request,
                    token: currentToken,
                    allowedStatusCodes: allowedStatusCodes
                )
            }

            // If a refresh completed after this request started, retry once with the latest token.
            let currentEpoch = await RefreshCoordinator.shared.currentEpoch()
            if currentEpoch > requestEpoch, let currentToken = await currentAuthToken() {
                if let usedToken = originalToken, currentToken == usedToken {
                    print("[APIClient] Refresh epoch advanced but token unchanged - continuing to refresh path")
                } else {
                    print("[APIClient] 401 after refresh epoch advanced (\(requestEpoch) -> \(currentEpoch)) - retrying")
                    return try await executeRetry(
                        request: request,
                        token: currentToken,
                        allowedStatusCodes: allowedStatusCodes
                    )
                }
            }

            // 401 received - attempt token refresh if we have a refresh provider
            guard let refreshProvider = getAuthRefresh else {
                print("[APIClient] No refresh provider - triggering auth failure")
                notifyAuthFailure()
                throw APIClientError.notAuthenticated
            }

            do {
                print("[APIClient] Attempting coordinated token refresh before retry")
                let refreshResult = try await RefreshCoordinator.shared.coordinatedRefresh(using: refreshProvider)
                if refreshResult.didRefresh {
                    print("[APIClient] Token refresh successful - retrying request")
                } else {
                    print("[APIClient] Piggybacked on concurrent refresh - retrying request")
                }

                let refreshedToken = refreshResult.accessToken.isEmpty
                    ? (try await requireAuthTokenForRetry())
                    : refreshResult.accessToken

                return try await executeRetry(
                    request: request,
                    token: refreshedToken,
                    allowedStatusCodes: allowedStatusCodes
                )
            } catch {
                var terminalError: Error = error

                // One recovery cycle: if the first retry still hit 401, force a new coordinated
                // refresh and retry once more before declaring definitive auth failure.
                if case APIClientError.notAuthenticated = terminalError {
                    do {
                        let recoveryRefresh = try await RefreshCoordinator.shared.coordinatedRefresh(using: refreshProvider)
                        let recoveryToken = recoveryRefresh.accessToken.isEmpty
                            ? (try await requireAuthTokenForRetry())
                            : recoveryRefresh.accessToken

                        print("[APIClient] Retry 401 after refresh - forcing one more refresh/retry cycle")
                        return try await executeRetry(
                            request: request,
                            token: recoveryToken,
                            allowedStatusCodes: allowedStatusCodes
                        )
                    } catch {
                        terminalError = error
                    }
                }

                // If retry failed after refresh, one final best-effort retry with current token.
                if let latestToken = await currentAuthToken(),
                   latestToken != originalToken {
                    do {
                        print("[APIClient] Retrying once more with latest token after refresh failure")
                        return try await executeRetry(
                            request: request,
                            token: latestToken,
                            allowedStatusCodes: allowedStatusCodes
                        )
                    } catch {
                        terminalError = error
                    }
                }
                // Check if this is a definitive auth failure
                let isDefinitiveFailure: Bool = {
                    if case AuthError.tokenExpired = terminalError { return true }
                    if case AuthError.notAuthenticated = terminalError { return true }
                    if case AuthError.keychainSaveFailed = terminalError { return true }
                    if case APIClientError.notAuthenticated = terminalError { return true }
                    return false
                }()

                if isDefinitiveFailure {
                    notifyAuthFailure()
                    throw APIClientError.notAuthenticated
                }

                // Transient refresh failure - don't logout, propagate error
                print("[APIClient] Transient refresh failure: \(terminalError.localizedDescription)")
                throw APIClientError.authRefreshFailed
            }
        }
    }

    private func bearerToken(from request: URLRequest) -> String? {
        guard let authHeader = request.value(forHTTPHeaderField: "Authorization"),
              authHeader.hasPrefix("Bearer ") else {
            return nil
        }
        return String(authHeader.dropFirst("Bearer ".count))
    }

    private func currentAuthToken() async -> String? {
        guard let authClosure = getAuthToken else { return nil }
        let authResult = await authClosure()
        return authResult.token
    }

    private func requireAuthTokenForRetry() async throws -> String {
        guard let token = await currentAuthToken() else {
            print("[APIClient] Missing token after refresh - retry cannot continue")
            throw APIClientError.notAuthenticated
        }
        return token
    }

    private func applyBearerToken(_ token: String, to request: inout URLRequest) {
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        #if DEBUG
        let preview = String(token.prefix(20))
        print("[APIClient] Retry using token: Bearer \(preview)...")
        #endif
    }

    private func executeRetry(
        request: URLRequest,
        token: String,
        allowedStatusCodes: Set<Int>
    ) async throws -> (Data, URLResponse) {
        var retryRequest = request
        applyBearerToken(token, to: &retryRequest)
        let (retryData, retryResponse) = try await Self.session.data(for: retryRequest)
        try validateResponse(
            retryResponse,
            data: retryData,
            isRetry: true,
            allowedStatusCodes: allowedStatusCodes
        )
        return (retryData, retryResponse)
    }

    // MARK: - Response Validation

    /// Maximum response size to prevent memory issues (10MB)
    private static let maxResponseSize = 10 * 1024 * 1024

    /// Validates HTTP response - throws authRefreshNeeded on 401 for refresh-and-retry handling
    /// - Parameters:
    ///   - response: The URL response to validate
    ///   - data: Response body data
    ///   - isRetry: If true, 401 triggers immediate auth failure instead of refresh attempt
    ///   - allowedStatusCodes: Non-2xx status codes to treat as valid responses
    func validateResponse(
        _ response: URLResponse,
        data: Data,
        isRetry: Bool = false,
        allowedStatusCodes: Set<Int> = []
    ) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }

        // Validate response size to prevent memory attacks
        guard data.count <= Self.maxResponseSize else {
            throw APIClientError.invalidResponse
        }

        // Validate Content-Type for JSON endpoints (allow missing for legacy compatibility)
        if let contentType = httpResponse.value(forHTTPHeaderField: "Content-Type"),
           !contentType.isEmpty {
            // Accept application/json or text/json (some servers use non-standard types)
            let isJson = contentType.lowercased().contains("json") ||
                         contentType.lowercased().contains("text/plain")
            if !isJson {
                print("Warning: Unexpected Content-Type: \(contentType)")
                // Don't throw - some endpoints may return non-standard types
            }
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            if allowedStatusCodes.contains(httpResponse.statusCode) {
                return
            }
            if httpResponse.statusCode == 401 {
                // Log the error body for debugging
                if let errorBody = String(data: data, encoding: .utf8) {
                    print("[APIClient] 401 error body: \(errorBody.prefix(200))")
                }
                if isRetry {
                    // Already retried after refresh - bubble up so executeWithAuthRetry
                    // can run final recovery and decide whether logout is definitive.
                    print("[APIClient] 401 after retry - retry cycle exhausted")
                    throw APIClientError.notAuthenticated
                }
                // First 401 - signal that refresh should be attempted
                print("[APIClient] 401 received - signaling refresh needed")
                throw APIClientError.authRefreshNeeded
            }
            // Handle rate limiting specifically for better UX
            if httpResponse.statusCode == 429 {
                let retryAfter = httpResponse.value(forHTTPHeaderField: "Retry-After")
                    .flatMap { Int($0) }
                throw APIClientError.rateLimited(retryAfter: retryAfter)
            }

            // Try to parse error response
            if let apiError = try? Self.jsonDecoder.decode(APIError.self, from: data) {
                if apiError.error == "AI_UNAVAILABLE" {
                    throw APIClientError.aiUnavailable(message: apiError.message)
                }
                var message = apiError.message
                if let reason = apiError.details?["reason"], !reason.isEmpty {
                    message = "\(message) (Reason: \(reason))"
                }
                throw APIClientError.serverError(message: message, code: apiError.error, details: apiError.details)
            }
            // Try to get raw response text for debugging
            let responseText = String(data: data, encoding: .utf8) ?? "No response body"
            throw APIClientError.httpError(statusCode: httpResponse.statusCode, body: responseText)
        }
    }

    private func notifyAuthFailure() {
        guard let handler = onAuthFailure else { return }
        Task { @MainActor in
            handler()
        }
    }
}

// MARK: - Errors

enum APIClientError: LocalizedError {
    case invalidResponse
    case httpError(statusCode: Int, body: String)
    case networkError(underlying: Error)
    case serverError(message: String, code: String?, details: [String: String]?)
    case decodingError(String)
    case rateLimited(retryAfter: Int?)  // 429 response with optional Retry-After seconds
    case notAuthenticated
    case authRefreshNeeded  // Internal: signals that 401 was received and refresh should be attempted
    case authRefreshFailed  // Transient refresh failure - don't logout
    case aiUnavailable(message: String?)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Invalid response from server"
        case .httpError(let statusCode, let body):
            return "Server error (HTTP \(statusCode)): \(body.prefix(200))"
        case .networkError(let underlying):
            return "Network error: \(underlying.localizedDescription)"
        case .serverError(let message, _, _):
            return message
        case .decodingError(let details):
            return "Failed to parse response: \(details)"
        case .rateLimited(let retryAfter):
            if let seconds = retryAfter {
                return "Too many requests. Please wait \(seconds) seconds."
            }
            return "Too many requests. Please try again later."
        case .notAuthenticated:
            return "Please sign in to continue."
        case .authRefreshNeeded:
            return "Authentication refresh required"  // Internal use only
        case .authRefreshFailed:
            return "Authentication refresh failed. Please try again."
        case .aiUnavailable(let message):
            return message ?? "Our AI songwriter is temporarily unavailable. Please try again soon."
        }
    }
}
