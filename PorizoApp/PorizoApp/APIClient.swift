//
//  APIClient.swift
//  PorizoApp
//
//  HTTP client for communicating with the Porizo backend.
//  Handles enrollment, upload, and profile management.
//

import Foundation
import Security
import UIKit  // For BackgroundTaskManager

// MARK: - Keychain Helper

/// Secure storage for user credentials using iOS Keychain
/// All methods are nonisolated since Security framework is thread-safe
enum KeychainHelper: Sendable {
    private static let service = "com.porizo.app"

    /// Save data to Keychain
    /// Uses AfterFirstUnlockThisDeviceOnly for persistent login support:
    /// - Items accessible when device is locked (enables background token refresh)
    /// - Still device-bound (no iCloud/backup migration) for security
    /// - Only requires device to have been unlocked once since boot
    nonisolated static func save(key: String, data: Data) -> Bool {
        // Delete existing item first
        delete(key: key)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]

        let status = SecItemAdd(query as CFDictionary, nil)
        return status == errSecSuccess
    }

    /// Load data from Keychain
    nonisolated static func load(key: String) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        if status == errSecSuccess {
            return result as? Data
        }
        return nil
    }

    /// Delete item from Keychain
    @discardableResult
    nonisolated static func delete(key: String) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]

        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }

    /// Save string to Keychain
    nonisolated static func saveString(key: String, value: String) -> Bool {
        guard let data = value.data(using: .utf8) else { return false }
        return save(key: key, data: data)
    }

    /// Load string from Keychain
    nonisolated static func loadString(key: String) -> String? {
        guard let data = load(key: key) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

/// Closure type for providing auth tokens from AuthManager
/// Using closure avoids actor isolation issues between APIClient (actor) and AuthManager (@MainActor)
typealias AuthTokenClosure = @Sendable () async -> (token: String?, userId: String?)
/// Closure type for refreshing auth tokens (called by APIClient on 401)
typealias AuthRefreshClosure = @Sendable () async throws -> Void
/// Closure type for handling auth failures (401/missing token)
typealias AuthFailureClosure = @MainActor @Sendable () -> Void

/// API client for Porizo backend
actor APIClient {

    // MARK: - Configuration

    /// Base URL for the API.
    let baseURL: String

    /// Device ID (generated once, stored in Keychain)
    /// Used for device registration and share binding
    private let deviceUserId: String

    /// Optional closure for getting auth tokens
    /// When set, API calls use Bearer tokens
    private var getAuthToken: AuthTokenClosure?
    /// Optional closure for refreshing auth tokens (called on 401 before logout)
    private var getAuthRefresh: AuthRefreshClosure?
    /// Optional handler invoked when auth fails definitively
    private var onAuthFailure: AuthFailureClosure?

    /// Shared JSON decoder configured for API responses
    /// NOTE: Do NOT use .convertFromSnakeCase here - our models have explicit
    /// CodingKeys that already map snake_case to camelCase. Using both causes
    /// double-conversion where keys become unrecognized.
    private static let jsonDecoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        // Explicit CodingKeys in models handle snake_case → camelCase mapping
        return decoder
    }()

    /// URLSession with configured timeouts
    private static let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 120  // 120s per request (LLM pipeline can exceed 60s)
        config.timeoutIntervalForResource = 300  // 5min total (for large uploads)
        config.waitsForConnectivity = false  // Fail fast instead of hanging on poor network
        return URLSession(configuration: config)
    }()

    // MARK: - Initialization

    init(baseURL: String = AppConfig.apiBaseURL, userId: String? = nil, authTokenProvider: AuthTokenClosure? = nil) {
        self.baseURL = baseURL
        self.deviceUserId = userId ?? Self.getOrCreateUserId()
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

    /// Call this to be notified when auth fails definitively (after refresh attempt)
    func setAuthFailureHandler(_ handler: @escaping AuthFailureClosure) {
        self.onAuthFailure = handler
    }

    /// Clear the auth provider (e.g., on logout)
    func clearAuthTokenProvider() {
        self.getAuthToken = nil
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

    private func storeDeviceToken(_ token: String, expiresAt: String) {
        _ = KeychainHelper.saveString(key: Self.deviceTokenKey, value: token)
        _ = KeychainHelper.saveString(key: Self.deviceTokenExpiryKey, value: expiresAt)
    }

    private func deviceTokenIsValid() -> Bool {
        guard let expiry = KeychainHelper.loadString(key: Self.deviceTokenExpiryKey) else {
            return false
        }
        let formatter = ISO8601DateFormatter()
        guard let expiryDate = formatter.date(from: expiry) else {
            return false
        }
        return expiryDate.timeIntervalSinceNow > 60
    }

    private func clearDeviceToken() {
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

    private func shouldRetryDeviceToken(httpResponse: HTTPURLResponse, data: Data) -> Bool {
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
    private static func sanitizeForLogging(_ text: String, maxLength: Int = 200) -> String {
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
    private static let appVersion: String = {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "PorizoApp/\(version) (build \(build); iOS)"
    }()

    /// Applies authorization headers to a request.
    /// Uses Bearer token if available, falls back to x-user-id for development.
    private func applyAuthHeaders(_ request: inout URLRequest, requiresAuth: Bool = true) async throws {
        if let authClosure = getAuthToken {
            let authResult = await authClosure()
            if let token = authResult.token {
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                return
            }

            // No token available; attempt refresh before failing
            if requiresAuth, let refreshProvider = getAuthRefresh {
                do {
                    print("[APIClient] Missing token - attempting refresh before request")
                    try await refreshProvider()
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

        // Fallback to x-user-id header for development (when ALLOW_ANON_USER_ID=true on backend)
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
    private func makeRequest(url: URL, method: String = "GET", requiresAuth: Bool = true) async throws -> URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(Self.appVersion, forHTTPHeaderField: "User-Agent")
        try await applyAuthHeaders(&request, requiresAuth: requiresAuth)
        return request
    }

    // MARK: - Enrollment API

    /// Start a new voice enrollment session
    func startEnrollment() async throws -> EnrollmentSession {
        let url = URL(string: "\(baseURL)/voice/enrollment/start")!
        var request = try await makeRequest(url: url, method: "POST")

        let body: [String: Any] = [
            "consent_accepted": true,
            "consent_version": "ios_v1"
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        return try await withRetry {
            let (data, _) = try await self.executeWithAuthRetry(request: request)

            do {
                return try Self.jsonDecoder.decode(EnrollmentSession.self, from: data)
            } catch {
                let responseText = String(data: data, encoding: .utf8) ?? "No response"
                throw APIClientError.decodingError("EnrollmentSession: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
            }
        }
    }

    /// Upload a recorded audio chunk via presigned storage URL, then notify backend.
    func uploadChunk(
        sessionId: String,
        chunkId: String,
        audioData: Data,
        uploadUrl: UploadURL,
        durationSec: Double,
        checksum: String?
    ) async throws -> ChunkUploadResponse {
        return try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "uploadChunk") { [self] in
            guard let presignedUrl = URL(string: uploadUrl.url) else {
                throw APIClientError.invalidResponse
            }

            // Step 1: Upload directly to storage using presigned URL
            var uploadRequest = URLRequest(url: presignedUrl)
            uploadRequest.httpMethod = uploadUrl.method ?? "PUT"

            if let headers = uploadUrl.headers {
                for (key, value) in headers {
                    uploadRequest.setValue(value, forHTTPHeaderField: key)
                }
            }

            if uploadRequest.value(forHTTPHeaderField: "Content-Type") == nil {
                uploadRequest.setValue("audio/wav", forHTTPHeaderField: "Content-Type")
            }

            let (_, uploadResponse) = try await Self.session.upload(for: uploadRequest, from: audioData)

            guard let uploadHttp = uploadResponse as? HTTPURLResponse,
                  (200...299).contains(uploadHttp.statusCode) else {
                let status = (uploadResponse as? HTTPURLResponse)?.statusCode ?? -1
                throw APIClientError.httpError(statusCode: status, body: "Upload failed")
            }

            // Step 2: Notify backend that upload is complete
            let notifyUrl = URL(string: "\(baseURL)/voice/enrollment/chunk_uploaded")!
            var notifyRequest = try await makeRequest(url: notifyUrl, method: "POST")

            var payload: [String: Any] = [
                "session_id": sessionId,
                "chunk_id": chunkId,
                "duration_sec": durationSec
            ]
            if let checksum = checksum {
                payload["client_checksum"] = checksum
            }

            notifyRequest.httpBody = try JSONSerialization.data(withJSONObject: payload)

            let (data, _) = try await executeWithAuthRetry(request: notifyRequest)

            do {
                return try Self.jsonDecoder.decode(ChunkUploadResponse.self, from: data)
            } catch {
                let responseText = String(data: data, encoding: .utf8) ?? "No response"
                throw APIClientError.decodingError("ChunkUploadResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
            }
        }
    }

    /// Complete the enrollment session and create voice profile
    func completeEnrollment(sessionId: String) async throws -> VoiceProfile {
        let url = URL(string: "\(baseURL)/voice/enrollment/complete")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        try await applyAuthHeaders(&request)

        let body: [String: Any] = ["session_id": sessionId]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(VoiceProfile.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("VoiceProfile: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Check if user has an existing voice profile
    func getVoiceProfile() async throws -> VoiceProfileStatus {
        let url = URL(string: "\(baseURL)/voice/profile")!

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        try await applyAuthHeaders(&request)

        // Use auth retry wrapper - handles 401 with refresh-and-retry
        let (data, _) = try await executeWithAuthRetry(request: request)

        return try Self.jsonDecoder.decode(VoiceProfileStatus.self, from: data)
    }

    // MARK: - Device API

    /// Register the current device for share binding and receive a device token.
    func registerDevice(appVersion: String) async throws -> DeviceRegistrationResponse {
        let url = URL(string: "\(baseURL)/device/register")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        try await applyAuthHeaders(&request)

        let body: [String: String] = [
            "device_id": deviceUserId,
            "platform": "ios",
            "app_version": appVersion
        ]
        request.httpBody = try JSONEncoder().encode(body)

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(DeviceRegistrationResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("DeviceRegistrationResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Ensure a valid device token is available for share flows.
    func ensureDeviceToken() async throws -> String? {
        if deviceTokenIsValid(), let token = currentDeviceToken() {
            return token
        }

        let registration = try await registerDevice(appVersion: Self.appVersion)
        storeDeviceToken(registration.deviceToken, expiresAt: registration.expiresAt)
        return registration.deviceToken
    }

    // MARK: - Memory Questions API

    /// Generate contextual follow-up questions based on a memory
    /// Used by the story wizard to extract emotional essence for personalized songs
    func generateMemoryQuestions(memory: String, occasion: String?, recipientName: String?) async throws -> MemoryQuestionsResponse {
        let url = URL(string: "\(baseURL)/memory/questions")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        try await applyAuthHeaders(&request)

        let requestBody = MemoryQuestionsRequest(
            memory: memory,
            occasion: occasion,
            recipientName: recipientName
        )
        request.httpBody = try JSONEncoder().encode(requestBody)

        // Question generation may take a few seconds
        request.timeoutInterval = 120

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(MemoryQuestionsResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("MemoryQuestionsResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    // MARK: - Track API

    /// Create a new track
    func createTrack(request trackRequest: CreateTrackRequest) async throws -> CreateTrackResponse {
        return try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "createTrack") { [self] in
            let url = URL(string: "\(baseURL)/tracks")!

            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            try await applyAuthHeaders(&request)
            request.httpBody = try JSONEncoder().encode(trackRequest)

            // Use auth retry wrapper - handles 401 with refresh-and-retry
            let (data, _) = try await executeWithAuthRetry(request: request)

            do {
                return try Self.jsonDecoder.decode(CreateTrackResponse.self, from: data)
            } catch {
                let responseText = String(data: data, encoding: .utf8) ?? "No response"
                throw APIClientError.decodingError("CreateTrackResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
            }
        }
    }

    /// Get tracks for the current user with optional pagination
    /// - Parameters:
    ///   - limit: Maximum number of tracks to return (default: 50, max: 100)
    ///   - offset: Number of tracks to skip (for pagination)
    func getTracks(limit: Int = 50, offset: Int = 0) async throws -> GetTracksResponse {
        var components = URLComponents(string: "\(baseURL)/tracks")!
        components.queryItems = [
            URLQueryItem(name: "limit", value: String(min(limit, 100))),
            URLQueryItem(name: "offset", value: String(offset))
        ]

        return try await withRetry {
            var request = URLRequest(url: components.url!)
            request.httpMethod = "GET"
            try await applyAuthHeaders(&request)

            // Use auth retry wrapper - handles 401 with refresh-and-retry
            let (data, _) = try await executeWithAuthRetry(request: request)

            do {
                return try Self.jsonDecoder.decode(GetTracksResponse.self, from: data)
            } catch let decodingError as DecodingError {
                let responseText = String(data: data, encoding: .utf8) ?? "No response"
                print("[APIClient] GetTracks decoding error: \(decodingError)")
                print("[APIClient] GetTracks response: \(responseText.prefix(500))")
                throw decodingError
            }
        }
    }

    /// Get a specific track with its versions
    func getTrack(trackId: String) async throws -> GetTrackResponse {
        let url = URL(string: "\(baseURL)/tracks/\(trackId)")!

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        try await applyAuthHeaders(&request)

        // Use auth retry wrapper - handles 401 with refresh-and-retry
        let (data, _) = try await executeWithAuthRetry(request: request)

        return try Self.jsonDecoder.decode(GetTrackResponse.self, from: data)
    }

    /// Debug stream check for a track version (server-side availability)
    func streamCheck(trackId: String, versionNum: Int) async throws -> StreamCheckResponse {
        let url = URL(string: "\(baseURL)/tracks/\(trackId)/versions/\(versionNum)/stream-check")!

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        try await applyAuthHeaders(&request)

        let (data, _) = try await executeWithAuthRetry(request: request)

        return try Self.jsonDecoder.decode(StreamCheckResponse.self, from: data)
    }

    /// Create a new version for a track
    func createVersion(trackId: String, renderType: String = "preview") async throws -> CreateVersionResponse {
        let url = URL(string: "\(baseURL)/tracks/\(trackId)/versions")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        try await applyAuthHeaders(&request)

        let body: [String: Any] = ["render_type": renderType]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, _) = try await executeWithAuthRetry(request: request)

        return try Self.jsonDecoder.decode(CreateVersionResponse.self, from: data)
    }

    /// Generate lyrics for a track version
    func generateLyrics(trackId: String, versionNum: Int) async throws -> GenerateLyricsResponse {
        return try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "generateLyrics") { [self] in
            let url = URL(string: "\(baseURL)/tracks/\(trackId)/versions/\(versionNum)/lyrics/generate")!

            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            try await applyAuthHeaders(&request)
            request.httpBody = "{}".data(using: .utf8)

            // Lyrics generation can take time - use longer timeout
            request.timeoutInterval = 60

            let (data, _) = try await executeWithAuthRetry(request: request)

            do {
                return try Self.jsonDecoder.decode(GenerateLyricsResponse.self, from: data)
            } catch {
                let responseText = String(data: data, encoding: .utf8) ?? "No response"
                throw APIClientError.decodingError("GenerateLyricsResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
            }
        }
    }

    /// Get lyrics for a track version
    func getLyrics(trackId: String, versionNum: Int) async throws -> Lyrics? {
        let url = URL(string: "\(baseURL)/tracks/\(trackId)/versions/\(versionNum)/lyrics")!

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        try await applyAuthHeaders(&request)

        let (data, _) = try await executeWithAuthRetry(request: request)

        struct LyricsWrapper: Codable {
            let lyrics: Lyrics?
        }
        let wrapper = try Self.jsonDecoder.decode(LyricsWrapper.self, from: data)
        return wrapper.lyrics
    }

    /// Update lyrics for a track version (user edits)
    func updateLyrics(trackId: String, versionNum: Int, lyrics: Lyrics) async throws {
        let url = URL(string: "\(baseURL)/tracks/\(trackId)/versions/\(versionNum)/lyrics")!

        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        try await applyAuthHeaders(&request)

        // Wrap lyrics in expected format
        struct LyricsWrapper: Encodable {
            let lyrics: Lyrics
        }
        request.httpBody = try JSONEncoder().encode(LyricsWrapper(lyrics: lyrics))

        let (_, _) = try await executeWithAuthRetry(request: request)
    }

    /// Approve lyrics for a track version
    func approveLyrics(trackId: String, versionNum: Int) async throws -> ApproveLyricsResponse {
        let url = URL(string: "\(baseURL)/tracks/\(trackId)/versions/\(versionNum)/lyrics/approve")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        try await applyAuthHeaders(&request)
        request.httpBody = "{}".data(using: .utf8)

        let (data, _) = try await executeWithAuthRetry(request: request)

        return try Self.jsonDecoder.decode(ApproveLyricsResponse.self, from: data)
    }

    /// Render a preview for a track version
    func renderPreview(trackId: String, versionNum: Int) async throws -> RenderPreviewResponse {
        return try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "renderPreview") { [self] in
            let url = URL(string: "\(baseURL)/tracks/\(trackId)/versions/\(versionNum)/render_preview")!

            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            try await applyAuthHeaders(&request)
            request.httpBody = "{}".data(using: .utf8)

            let (data, _) = try await executeWithAuthRetry(request: request)

            return try Self.jsonDecoder.decode(RenderPreviewResponse.self, from: data)
        }
    }

    /// Render full version of a track (requires credit confirmation)
    /// - Parameters:
    ///   - trackId: The track ID
    ///   - versionNum: Version number
    /// - Returns: RenderFullResponse with job ID and billing hold info
    func renderFull(trackId: String, versionNum: Int) async throws -> RenderFullResponse {
        return try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "renderFull") { [self] in
            let url = URL(string: "\(baseURL)/tracks/\(trackId)/versions/\(versionNum)/render_full")!

            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            try await applyAuthHeaders(&request)

            // confirm_credit_spend is required by the API
            let body = ["confirm_credit_spend": true]
            request.httpBody = try JSONEncoder().encode(body)

            let (data, _) = try await executeWithAuthRetry(request: request)

            return try Self.jsonDecoder.decode(RenderFullResponse.self, from: data)
        }
    }

    /// Get user entitlements (credits, tier, limits)
    func getEntitlements() async throws -> EntitlementsResponse {
        let url = URL(string: "\(baseURL)/entitlements")!

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        try await applyAuthHeaders(&request)

        // Use auth retry wrapper - handles 401 with refresh-and-retry
        let (data, _) = try await executeWithAuthRetry(request: request)

        return try Self.jsonDecoder.decode(EntitlementsResponse.self, from: data)
    }

    /// Get job status (for polling render progress)
    func getJobStatus(jobId: String) async throws -> JobStatus {
        let url = URL(string: "\(baseURL)/jobs/\(jobId)")!

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        try await applyAuthHeaders(&request)

        let (data, _) = try await executeWithAuthRetry(request: request)

        return try Self.jsonDecoder.decode(JobStatus.self, from: data)
    }

    // MARK: - Reroll API

    /// Reroll a track version to create a new version with changes
    /// - Parameters:
    ///   - trackId: The track ID
    ///   - versionNum: Version number to base the reroll on
    ///   - rerollType: Type of reroll (lyrics, beat, or vocals)
    /// - Returns: RerollResponse with new version number and job info
    func reroll(trackId: String, versionNum: Int, rerollType: RerollType) async throws -> RerollResponse {
        let url = URL(string: "\(baseURL)/tracks/\(trackId)/versions/\(versionNum)/reroll")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        try await applyAuthHeaders(&request)

        let body: [String: String] = ["reroll_type": rerollType.rawValue]
        request.httpBody = try JSONEncoder().encode(body)

        // Reroll operations may take time
        request.timeoutInterval = 120

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(RerollResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("RerollResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    // MARK: - Delete Track

    /// Delete a track
    func deleteTrack(trackId: String) async throws {
        let url = URL(string: "\(baseURL)/tracks/\(trackId)")!

        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        try await applyAuthHeaders(&request)

        let (_, _) = try await executeWithAuthRetry(request: request)
    }

    // MARK: - Update Track Voice Mode

    /// Update the voice mode for a track (user_voice or ai_voice)
    /// Called after lyrics approval to set the voice mode before rendering
    /// - Parameters:
    ///   - trackId: The track ID
    ///   - voiceMode: The voice mode ("user_voice" or "ai_voice")
    func updateVoiceMode(trackId: String, voiceMode: String) async throws {
        let url = URL(string: "\(baseURL)/tracks/\(trackId)/voice_mode")!

        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        try await applyAuthHeaders(&request)

        let body = ["voice_mode": voiceMode]
        request.httpBody = try JSONEncoder().encode(body)

        let (_, response) = try await executeWithAuthRetry(request: request)
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
            throw APIClientError.serverError("Failed to update voice mode")
        }
    }

    // MARK: - Share API

    /// Create a share link for a track
    /// - Parameters:
    ///   - trackId: The track ID to share
    ///   - versionNum: Version number to share (optional, defaults to latest)
    ///   - expiresInDays: How many days until the share expires (default 30)
    /// - Returns: CreateShareResponse with share URL and claim PIN
    func createShare(trackId: String, versionNum: Int? = nil, expiresInDays: Int = 30) async throws -> CreateShareResponse {
        let url = URL(string: "\(baseURL)/tracks/\(trackId)/share")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        try await applyAuthHeaders(&request)

        var body: [String: Any] = ["expires_in_days": expiresInDays]
        if let versionNum = versionNum {
            body["version_num"] = versionNum
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(CreateShareResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("CreateShareResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Get share statistics for a track
    /// - Parameter trackId: The track ID
    /// - Returns: ShareStats with access counts and activity
    func getShareStats(trackId: String) async throws -> ShareStats {
        let url = URL(string: "\(baseURL)/tracks/\(trackId)/share/stats")!

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        try await applyAuthHeaders(&request)

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(ShareStats.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("ShareStats: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Revoke a share link for a track
    /// - Parameter trackId: The track ID
    func revokeShare(trackId: String) async throws {
        let url = URL(string: "\(baseURL)/tracks/\(trackId)/share")!

        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        try await applyAuthHeaders(&request)

        let (_, _) = try await executeWithAuthRetry(request: request)
    }

    /// Get QR code data URL for sharing
    /// - Parameters:
    ///   - trackId: The track ID
    ///   - size: QR code size in pixels (100-1000)
    /// - Returns: QRCodeDataResponse with base64 data URL
    func getQRCodeData(trackId: String, size: Int = 300) async throws -> QRCodeDataResponse {
        let clampedSize = min(max(size, 100), 1000)
        let url = URL(string: "\(baseURL)/tracks/\(trackId)/share/qr-data?size=\(clampedSize)")!

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        try await applyAuthHeaders(&request)

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(QRCodeDataResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("QRCodeDataResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Fetch public share info for a share token
    /// - Parameters:
    ///   - shareId: The share token ID
    ///   - deviceId: Device ID for can_access evaluation
    func getShareInfo(shareId: String, deviceId: String) async throws -> ShareInfoResponse {
        let url = URL(string: "\(baseURL)/share/\(shareId)")!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(deviceId, forHTTPHeaderField: "x-device-id")
        if let token = currentDeviceToken() {
            request.setValue(token, forHTTPHeaderField: "x-device-token")
        }

        var (data, response) = try await Self.session.data(for: request)
        if let httpResponse = response as? HTTPURLResponse,
           shouldRetryDeviceToken(httpResponse: httpResponse, data: data) {
            clearDeviceToken()
            var retryRequest = request
            retryRequest.setValue(nil, forHTTPHeaderField: "x-device-token")
            (data, response) = try await Self.session.data(for: retryRequest)
        }
        try validateResponse(response, data: data)

        do {
            return try Self.jsonDecoder.decode(ShareInfoResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("ShareInfoResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Claim a share token for the current device
    /// - Parameters:
    ///   - shareId: The share token ID
    ///   - pin: 6-digit PIN from sender
    ///   - deviceId: Device ID to bind
    ///   - platform: Platform identifier (default ios)
    ///   - appVersion: App version string
    func claimShare(
        shareId: String,
        pin: String,
        appVersion: String
    ) async throws -> ShareClaimResponse {
        let url = URL(string: "\(baseURL)/share/\(shareId)/claim")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        guard let deviceToken = try await ensureDeviceToken() else {
            throw APIClientError.notAuthenticated
        }
        request.setValue(deviceToken, forHTTPHeaderField: "x-device-token")

        let body: [String: String] = [
            "app_version": appVersion,
            "pin": pin
        ]
        request.httpBody = try JSONEncoder().encode(body)

        var (data, response) = try await Self.session.data(for: request)
        if let httpResponse = response as? HTTPURLResponse,
           shouldRetryDeviceToken(httpResponse: httpResponse, data: data) {
            clearDeviceToken()
            guard let refreshedToken = try await ensureDeviceToken() else {
                throw APIClientError.notAuthenticated
            }
            var retryRequest = request
            retryRequest.setValue(refreshedToken, forHTTPHeaderField: "x-device-token")
            (data, response) = try await Self.session.data(for: retryRequest)
        }
        try validateResponse(response, data: data)

        do {
            return try Self.jsonDecoder.decode(ShareClaimResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("ShareClaimResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Get streaming URL for a share token (claimed device only)
    /// - Parameters:
    ///   - shareId: The share token ID
    ///   - deviceId: Device ID for access validation
    ///   - platform: Platform identifier (default ios)
    func getShareStream(
        shareId: String,
        deviceId: String,
        platform: String = "ios"
    ) async throws -> ShareStreamResponse {
        let url = URL(string: "\(baseURL)/share/\(shareId)/stream")!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(deviceId, forHTTPHeaderField: "x-device-id")
        request.setValue(platform, forHTTPHeaderField: "x-platform")
        if let deviceToken = try await ensureDeviceToken() {
            request.setValue(deviceToken, forHTTPHeaderField: "x-device-token")
        }

        var (data, response) = try await Self.session.data(for: request)
        if let httpResponse = response as? HTTPURLResponse,
           shouldRetryDeviceToken(httpResponse: httpResponse, data: data) {
            clearDeviceToken()
            if let refreshedToken = try await ensureDeviceToken() {
                var retryRequest = request
                retryRequest.setValue(refreshedToken, forHTTPHeaderField: "x-device-token")
                (data, response) = try await Self.session.data(for: retryRequest)
            }
        }
        try validateResponse(response, data: data)

        do {
            return try Self.jsonDecoder.decode(ShareStreamResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("ShareStreamResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    // MARK: - Poems API

    /// Get poems for the current user with optional pagination
    /// - Parameters:
    ///   - limit: Maximum number of poems to return (default: 50, max: 100)
    ///   - offset: Number of poems to skip (for pagination)
    func getPoems(limit: Int = 50, offset: Int = 0) async throws -> GetPoemsResponse {
        var components = URLComponents(string: "\(baseURL)/poems")!
        components.queryItems = [
            URLQueryItem(name: "limit", value: String(min(limit, 100))),
            URLQueryItem(name: "offset", value: String(offset))
        ]

        return try await withRetry {
            var request = URLRequest(url: components.url!)
            request.httpMethod = "GET"
            try await applyAuthHeaders(&request)

            // Use auth retry wrapper - handles 401 with refresh-and-retry
            let (data, _) = try await executeWithAuthRetry(request: request)

            do {
                return try Self.jsonDecoder.decode(GetPoemsResponse.self, from: data)
            } catch {
                let responseText = String(data: data, encoding: .utf8) ?? "No response"
                throw APIClientError.decodingError("GetPoemsResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
            }
        }
    }

    /// Create a new poem
    /// - Parameter poemRequest: The poem creation request with title, recipient, occasion, tone, and message
    /// - Returns: The created Poem
    func createPoem(request poemRequest: CreatePoemRequest) async throws -> Poem {
        let url = URL(string: "\(baseURL)/poems")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        try await applyAuthHeaders(&request)
        request.httpBody = try JSONEncoder().encode(poemRequest)

        // Poem generation may take a few seconds if using LLM
        request.timeoutInterval = 120

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(Poem.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("Poem: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Get a specific poem by ID
    /// - Parameter poemId: The poem ID
    /// - Returns: GetPoemResponse containing the poem
    func getPoem(poemId: String) async throws -> GetPoemResponse {
        let url = URL(string: "\(baseURL)/poems/\(poemId)")!

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        try await applyAuthHeaders(&request)

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(GetPoemResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("GetPoemResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Update a poem
    /// - Parameters:
    ///   - poemId: The poem ID
    ///   - updates: Fields to update (title, tone, etc.)
    /// - Returns: The updated Poem
    func updatePoem(poemId: String, updates: UpdatePoemRequest) async throws -> UpdatePoemResponse {
        let url = URL(string: "\(baseURL)/poems/\(poemId)")!

        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        try await applyAuthHeaders(&request)
        request.httpBody = try JSONEncoder().encode(updates)

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(UpdatePoemResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("UpdatePoemResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Delete a poem (soft delete)
    /// - Parameter poemId: The poem ID
    func deletePoem(poemId: String) async throws {
        let url = URL(string: "\(baseURL)/poems/\(poemId)")!

        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        try await applyAuthHeaders(&request)

        let (_, _) = try await executeWithAuthRetry(request: request)
    }

    // MARK: - Poem Share API

    /// Create a share link for a poem
    /// - Parameters:
    ///   - poemId: The poem ID to share
    ///   - expiresInDays: How many days until the share expires (default 30)
    ///   - allowSave: Whether recipient can save the poem to their library
    /// - Returns: CreatePoemShareResponse with share URL and claim PIN
    func createPoemShare(poemId: String, expiresInDays: Int = 30, allowSave: Bool = true) async throws -> CreatePoemShareResponse {
        let url = URL(string: "\(baseURL)/poems/\(poemId)/share")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        try await applyAuthHeaders(&request)

        let body: [String: Any] = [
            "expires_in_days": expiresInDays,
            "allow_save": allowSave
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(CreatePoemShareResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("CreatePoemShareResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Get public share info for a poem share token (no auth required)
    /// - Parameter shareId: The share token ID
    /// - Returns: PoemShareInfoResponse with poem preview and status
    func getPoemShareInfo(shareId: String) async throws -> PoemShareInfoResponse {
        let url = URL(string: "\(baseURL)/poem-share/\(shareId)")!

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(Self.appVersion, forHTTPHeaderField: "User-Agent")
        // Public endpoint - no auth required

        let (data, response) = try await Self.session.data(for: request)
        try validateResponse(response, data: data)

        do {
            return try Self.jsonDecoder.decode(PoemShareInfoResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("PoemShareInfoResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Claim a shared poem with PIN verification
    /// - Parameters:
    ///   - shareId: The share token ID
    ///   - pin: 6-digit PIN from sender
    /// - Returns: PoemShareClaimResponse with full poem if successful
    func claimPoemShare(shareId: String, pin: String) async throws -> PoemShareClaimResponse {
        let url = URL(string: "\(baseURL)/poem-share/\(shareId)/claim")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(Self.appVersion, forHTTPHeaderField: "User-Agent")

        // Get device token for binding
        guard let deviceToken = try await ensureDeviceToken() else {
            throw APIClientError.notAuthenticated
        }
        request.setValue(deviceToken, forHTTPHeaderField: "x-device-token")

        let body: [String: String] = ["pin": pin]
        request.httpBody = try JSONEncoder().encode(body)

        var (data, response) = try await Self.session.data(for: request)

        // Handle device token refresh if needed
        if let httpResponse = response as? HTTPURLResponse,
           shouldRetryDeviceToken(httpResponse: httpResponse, data: data) {
            clearDeviceToken()
            guard let refreshedToken = try await ensureDeviceToken() else {
                throw APIClientError.notAuthenticated
            }
            var retryRequest = request
            retryRequest.setValue(refreshedToken, forHTTPHeaderField: "x-device-token")
            (data, response) = try await Self.session.data(for: retryRequest)
        }

        try validateResponse(response, data: data)

        do {
            return try Self.jsonDecoder.decode(PoemShareClaimResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("PoemShareClaimResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    // MARK: - Story API (Dynamic Q&A Flow)

    /// Start a new story extraction session
    /// - Parameters:
    ///   - initialPrompt: The user's initial memory/prompt
    ///   - occasion: The occasion (determines arc: love, gratitude, celebration)
    ///   - recipientName: Who the song is for
    ///   - style: Music style (optional)
    /// - Returns: StartStoryV2Response with story_id and first question
    func startStory(initialPrompt: String, occasion: String, recipientName: String, style: String? = nil) async throws -> StartStoryV2Response {
        let url = URL(string: "\(baseURL)/story/start")!

        var request = try await makeRequest(url: url, method: "POST")
        request.timeoutInterval = 120  // Story reasoning can take longer than 30s

        let requestBody = StartStoryV2Request(
            initialPrompt: initialPrompt,
            occasion: occasion,
            recipientName: recipientName,
            style: style
        )
        request.httpBody = try JSONEncoder().encode(requestBody)

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(StartStoryV2Response.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("StartStoryV2Response: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Continue the story by submitting an answer
    /// - Parameters:
    ///   - storyId: The story session ID
    ///   - answer: User's answer to the current question
    /// - Returns: ContinueStoryV2Response with next question or completion status
    func continueStory(storyId: String, answer: String) async throws -> ContinueStoryV2Response {
        return try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "continueStory") { [self] in
            let url = URL(string: "\(baseURL)/story/\(storyId)/continue")!

            var request = try await makeRequest(url: url, method: "POST")
            request.timeoutInterval = 120

            let requestBody = ContinueStoryRequest(answer: answer)
            request.httpBody = try JSONEncoder().encode(requestBody)

            let (data, _) = try await executeWithAuthRetry(request: request)

            do {
                return try Self.jsonDecoder.decode(ContinueStoryV2Response.self, from: data)
            } catch {
                let responseText = String(data: data, encoding: .utf8) ?? "No response"
                throw APIClientError.decodingError("ContinueStoryV2Response: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
            }
        }
    }

    /// Get the story summary for user confirmation
    /// - Parameter storyId: The story session ID
    /// - Returns: StorySummaryV2Response with summary and soul of the story
    func getStorySummary(storyId: String) async throws -> StorySummaryV2Response {
        let url = URL(string: "\(baseURL)/story/\(storyId)/summary")!

        let request = try await makeRequest(url: url, method: "GET")

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(StorySummaryV2Response.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("StorySummaryV2Response: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Confirm the story and mark ready for lyrics generation
    /// - Parameters:
    ///   - storyId: The story session ID
    ///   - additionalNotes: Optional additional notes from user
    /// - Returns: ConfirmStoryV2Response
    func confirmStory(storyId: String, additionalNotes: String? = nil) async throws -> ConfirmStoryV2Response {
        let url = URL(string: "\(baseURL)/story/\(storyId)/confirm")!

        var request = try await makeRequest(url: url, method: "POST")

        let requestBody = ConfirmStoryRequest(additionalNotes: additionalNotes)
        request.httpBody = try JSONEncoder().encode(requestBody)

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(ConfirmStoryV2Response.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("ConfirmStoryV2Response: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Generate lyrics from a confirmed story
    /// - Parameter storyId: The story session ID (must be confirmed)
    /// - Returns: StoryLyricsResponse with lyrics and quality score
    func generateStoryLyrics(storyId: String) async throws -> StoryLyricsResponse {
        let url = URL(string: "\(baseURL)/story/\(storyId)/lyrics")!

        var request = try await makeRequest(url: url, method: "POST")
        request.timeoutInterval = 60  // Lyrics generation takes longer
        request.httpBody = "{}".data(using: .utf8)  // Empty body for Fastify JSON parser

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(StoryLyricsResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("StoryLyricsResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Create a track from a confirmed story
    /// - Parameter storyId: The story session ID (must be confirmed)
    /// - Returns: StoryToTrackResponse with track_id and version info
    func storyToTrack(storyId: String) async throws -> StoryToTrackResponse {
        let url = URL(string: "\(baseURL)/story/\(storyId)/to-track")!

        var request = try await makeRequest(url: url, method: "POST")
        request.httpBody = "{}".data(using: .utf8)  // Empty body for Fastify JSON parser

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(StoryToTrackResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("StoryToTrackResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Cancel a story session
    /// - Parameter storyId: The story session ID
    func cancelStory(storyId: String) async throws {
        let url = URL(string: "\(baseURL)/story/\(storyId)")!

        let request = try await makeRequest(url: url, method: "DELETE")

        let (_, _) = try await executeWithAuthRetry(request: request)
    }

    /// Get story module info (occasions, styles, arcs)
    /// - Returns: StoryInfoResponse with available options
    func getStoryInfo() async throws -> StoryInfoResponse {
        let url = URL(string: "\(baseURL)/story/info")!

        let request = try await makeRequest(url: url, method: "GET")

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(StoryInfoResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("StoryInfoResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    // MARK: - V2 Story API (Enhanced Reasoning Engine)

    /// Start a new V2 story session with enhanced reasoning engine
    /// - Parameters:
    ///   - initialPrompt: The user's initial memory/prompt
    ///   - recipientName: Who the song is for
    ///   - occasion: The occasion type
    ///   - style: Music style (optional)
    /// - Returns: StartStoryV2Response with first question and beats
    func startStoryV2(
        initialPrompt: String,
        recipientName: String,
        occasion: String,
        style: String? = nil
    ) async throws -> StartStoryV2Response {
        let url = URL(string: "\(baseURL)/story/start")!

        var request = try await makeRequest(url: url, method: "POST")
        request.timeoutInterval = 120  // Story reasoning can take longer than 30s

        let requestBody = StartStoryV2Request(
            initialPrompt: initialPrompt,
            occasion: occasion,
            recipientName: recipientName,
            style: style
        )
        request.httpBody = try JSONEncoder().encode(requestBody)

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(StartStoryV2Response.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("StartStoryV2Response: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Continue a V2 story session by submitting an answer
    /// - Parameters:
    ///   - storyId: The story session ID
    ///   - answer: User's answer to the current question
    /// - Returns: ContinueStoryV2Response with next question or completion
    func continueStoryV2(storyId: String, answer: String) async throws -> ContinueStoryV2Response {
        let url = URL(string: "\(baseURL)/story/\(storyId)/continue")!

        var request = try await makeRequest(url: url, method: "POST")
        request.timeoutInterval = 120

        let requestBody = ContinueStoryRequest(answer: answer)
        request.httpBody = try JSONEncoder().encode(requestBody)

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(ContinueStoryV2Response.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("ContinueStoryV2Response: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Confirm a V2 story and mark ready for lyrics generation
    /// - Parameters:
    ///   - storyId: The story session ID
    ///   - additionalNotes: Optional additional notes from user
    /// - Returns: ConfirmStoryV2Response with confirmation and final state
    func confirmStoryV2(storyId: String, additionalNotes: String? = nil) async throws -> ConfirmStoryV2Response {
        let url = URL(string: "\(baseURL)/story/\(storyId)/confirm")!

        var request = try await makeRequest(url: url, method: "POST")

        let requestBody = ConfirmStoryRequest(additionalNotes: additionalNotes)
        request.httpBody = try JSONEncoder().encode(requestBody)

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(ConfirmStoryV2Response.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("ConfirmStoryV2Response: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Add more detail to a story after review
    /// - Parameters:
    ///   - storyId: The story session ID
    ///   - detail: The detail to add
    /// - Returns: ContinueStoryV2Response with updated narrative/question
    func addStoryDetails(storyId: String, detail: String) async throws -> ContinueStoryV2Response {
        let url = URL(string: "\(baseURL)/story/\(storyId)/add-details")!

        var request = try await makeRequest(url: url, method: "POST")
        request.httpBody = try JSONEncoder().encode(StoryAddDetailsRequest(detail: detail))

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(ContinueStoryV2Response.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("ContinueStoryV2Response: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Generate a poem from a confirmed story
    /// - Parameters:
    ///   - storyId: The confirmed story ID
    ///   - tone: Optional tone override
    ///   - style: Optional style override
    /// - Returns: Poem generation result with poem or missing details
    func createPoemFromStory(
        storyId: String,
        tone: String? = nil,
        style: String? = nil
    ) async throws -> StoryPoemGenerationResult {
        let url = URL(string: "\(baseURL)/story/\(storyId)/to-poem")!

        var request = try await makeRequest(url: url, method: "POST")
        request.timeoutInterval = 120
        request.httpBody = try JSONEncoder().encode(StoryToPoemRequest(tone: tone, style: style))

        let (data, response) = try await executeWithAuthRetry(
            request: request,
            allowedStatusCodes: Set([422])
        )

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }

        if httpResponse.statusCode == 200 {
            do {
                let payload = try Self.jsonDecoder.decode(StoryToPoemResponse.self, from: data)
                return .poem(payload)
            } catch {
                let responseText = String(data: data, encoding: .utf8) ?? "No response"
                throw APIClientError.decodingError("StoryToPoemResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
            }
        }

        if httpResponse.statusCode == 422 {
            do {
                let payload = try Self.jsonDecoder.decode(StoryPoemGapResponse.self, from: data)
                return .gaps(payload)
            } catch {
                let responseText = String(data: data, encoding: .utf8) ?? "No response"
                throw APIClientError.decodingError("StoryPoemGapResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
            }
        }

        try validateResponse(response, data: data)
        throw APIClientError.invalidResponse
    }

    /// Get the current story session state (resume)
    /// - Parameter storyId: The story session ID
    /// - Returns: StorySessionStateResponse with session details
    func getStorySession(storyId: String) async throws -> StorySessionStateResponse {
        let url = URL(string: "\(baseURL)/story/\(storyId)")!

        let request = try await makeRequest(url: url, method: "GET")
        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(StorySessionStateResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("StorySessionStateResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Transcribe audio for a story session
    /// - Parameters:
    ///   - storyId: The story session ID
    ///   - audioData: Audio data (m4a, mp3, wav, webm supported)
    ///   - filename: Original filename with extension (for format detection)
    /// - Returns: Transcription response with text
    func transcribeAudio(storyId: String, audioData: Data, filename: String) async throws -> SpeechTranscriptionResponse {
        let url = URL(string: "\(baseURL)/v2/story/\(storyId)/audio")!

        // Create multipart/form-data request
        let boundary = "Boundary-\(UUID().uuidString)"

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue(Self.appVersion, forHTTPHeaderField: "User-Agent")
        try await applyAuthHeaders(&request)

        // Transcription timeout - 60s is sufficient for typical audio clips
        // (Reduced from 120s for better UX on failure)
        request.timeoutInterval = 60

        // Build multipart body
        var body = Data()

        // Determine MIME type from filename extension
        let mimeType: String
        let ext = (filename as NSString).pathExtension.lowercased()
        switch ext {
        case "m4a":
            mimeType = "audio/mp4"
        case "mp3":
            mimeType = "audio/mpeg"
        case "wav":
            mimeType = "audio/wav"
        case "webm":
            mimeType = "audio/webm"
        default:
            mimeType = "application/octet-stream"
        }

        // Add audio file field
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"audio\"; filename=\"\(filename)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: \(mimeType)\r\n\r\n".data(using: .utf8)!)
        body.append(audioData)
        body.append("\r\n".data(using: .utf8)!)

        // Close boundary
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)

        request.httpBody = body

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(SpeechTranscriptionResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("SpeechTranscriptionResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Transcribe audio without story context (standalone endpoint)
    /// Use this when no story session exists yet (e.g., Simple create flow)
    /// - Parameters:
    ///   - audioData: Audio data (m4a, mp3, wav, webm supported)
    ///   - filename: Original filename with extension (for format detection)
    /// - Returns: Transcription response with text
    func transcribeAudioStandalone(audioData: Data, filename: String) async throws -> SpeechTranscriptionResponse {
        let url = URL(string: "\(baseURL)/v2/audio/transcribe")!

        // Create multipart/form-data request
        let boundary = "Boundary-\(UUID().uuidString)"

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue(Self.appVersion, forHTTPHeaderField: "User-Agent")
        try await applyAuthHeaders(&request)

        // Transcription timeout - 60s is sufficient for typical audio clips
        request.timeoutInterval = 60

        // Build multipart body
        var body = Data()

        // Determine MIME type from filename extension
        let mimeType: String
        let ext = (filename as NSString).pathExtension.lowercased()
        switch ext {
        case "m4a":
            mimeType = "audio/mp4"
        case "mp3":
            mimeType = "audio/mpeg"
        case "wav":
            mimeType = "audio/wav"
        case "webm":
            mimeType = "audio/webm"
        default:
            mimeType = "application/octet-stream"
        }

        // Add audio file field
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"audio\"; filename=\"\(filename)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: \(mimeType)\r\n\r\n".data(using: .utf8)!)
        body.append(audioData)
        body.append("\r\n".data(using: .utf8)!)

        // Close boundary
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)

        request.httpBody = body

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(SpeechTranscriptionResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("SpeechTranscriptionResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    // MARK: - Billing API

    /// Sync an Apple App Store transaction with the backend
    /// - Parameter transactionId: The StoreKit transaction ID
    /// - Returns: SyncReceiptResponse with subscription status and entitlements
    func syncAppleReceipt(transactionId: String) async throws -> SyncReceiptResponse {
        let url = URL(string: "\(baseURL)/billing/receipt/apple")!

        var request = try await makeRequest(url: url, method: "POST")
        // Idempotency key ensures safe retries - same key = same response
        request.setValue("apple_receipt_\(deviceUserId)_\(transactionId)", forHTTPHeaderField: "Idempotency-Key")

        let body: [String: Any] = ["transaction_id": transactionId]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        // Wrap in retry since this is a critical billing operation
        return try await withRetry(maxAttempts: 5, initialDelay: 1.0) {
            let (data, _) = try await self.executeWithAuthRetry(request: request)

            do {
                return try Self.jsonDecoder.decode(SyncReceiptResponse.self, from: data)
            } catch {
                let responseText = String(data: data, encoding: .utf8) ?? "No response"
                throw APIClientError.decodingError("SyncReceiptResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
            }
        }
    }

    /// Get user's billing entitlements (subscription tier, songs remaining, etc.)
    /// - Returns: BillingEntitlements with tier, song balance, and subscription status
    func getBillingEntitlements() async throws -> BillingEntitlements {
        let url = URL(string: "\(baseURL)/billing/entitlements")!

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        try await applyAuthHeaders(&request)

        // Use auth retry wrapper - handles 401 with refresh-and-retry
        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(BillingEntitlements.self, from: data)
        } catch let decodingError as DecodingError {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            // Log detailed decoding error for debugging
            switch decodingError {
            case .keyNotFound(let key, let context):
                print("[APIClient] BillingEntitlements keyNotFound: \(key.stringValue), path: \(context.codingPath.map { $0.stringValue })")
            case .valueNotFound(let type, let context):
                print("[APIClient] BillingEntitlements valueNotFound: \(type), path: \(context.codingPath.map { $0.stringValue })")
            case .typeMismatch(let type, let context):
                print("[APIClient] BillingEntitlements typeMismatch: \(type), path: \(context.codingPath.map { $0.stringValue })")
            case .dataCorrupted(let context):
                print("[APIClient] BillingEntitlements dataCorrupted: \(context.debugDescription)")
            @unknown default:
                print("[APIClient] BillingEntitlements unknown error: \(decodingError)")
            }
            throw APIClientError.decodingError("BillingEntitlements: \(decodingError.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("BillingEntitlements: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Activate a free trial for the user
    /// - Returns: ActivateTrialResponse with trial details
    func activateTrial() async throws -> ActivateTrialResponse {
        let url = URL(string: "\(baseURL)/billing/trial/activate")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        try await applyAuthHeaders(&request)
        request.httpBody = "{}".data(using: .utf8)

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(ActivateTrialResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("ActivateTrialResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Get available subscription plans
    /// - Returns: PlansResponse with list of subscription plans
    func getPlans() async throws -> PlansResponse {
        let url = URL(string: "\(baseURL)/billing/plans")!

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        try await applyAuthHeaders(&request)

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(PlansResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("PlansResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Get current subscription status
    /// - Returns: SubscriptionResponse with subscription details
    func getSubscription() async throws -> SubscriptionResponse {
        let url = URL(string: "\(baseURL)/billing/subscription")!

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        try await applyAuthHeaders(&request)

        let (data, _) = try await executeWithAuthRetry(request: request)

        do {
            return try Self.jsonDecoder.decode(SubscriptionResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("SubscriptionResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    // MARK: - App Config

    /// Get app configuration (public endpoint, no auth required)
    /// Fetches STT provider settings and other app config from backend
    /// - Returns: AppConfigResponse containing STT and other configuration
    func getAppConfig() async throws -> AppConfigResponse {
        let url = URL(string: "\(baseURL)/app/config")!

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(Self.appVersion, forHTTPHeaderField: "User-Agent")
        // No auth required - public endpoint

        let (data, response) = try await Self.session.data(for: request)
        try validateResponse(response, data: data)

        do {
            return try Self.jsonDecoder.decode(AppConfigResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("AppConfigResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    // MARK: - Phone Auth

    /// Send verification code to phone number
    /// - Parameter phoneNumber: Phone number in E.164 format (e.g., +1234567890)
    /// - Returns: SendPhoneCodeResponse with expiration and masked phone
    func sendPhoneVerificationCode(phoneNumber: String) async throws -> SendPhoneCodeResponse {
        let url = URL(string: "\(baseURL)/auth/phone/send-code")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(Self.appVersion, forHTTPHeaderField: "User-Agent")
        // No auth required for sending verification code

        let body: [String: String] = ["phone_number": phoneNumber]
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await Self.session.data(for: request)
        try validateResponse(response, data: data)

        do {
            return try Self.jsonDecoder.decode(SendPhoneCodeResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("SendPhoneCodeResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Verify phone code - returns registration token for new users or logs in existing users
    /// - Parameters:
    ///   - phoneNumber: Phone number in E.164 format
    ///   - code: 6-digit verification code
    /// - Returns: VerifyPhoneCodeResponse with tokens for existing users or registration token for new users
    func verifyPhoneCode(phoneNumber: String, code: String) async throws -> VerifyPhoneCodeResponse {
        let url = URL(string: "\(baseURL)/auth/phone/verify")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(Self.appVersion, forHTTPHeaderField: "User-Agent")
        // No auth required for verification

        let body: [String: String] = [
            "phone_number": phoneNumber,
            "code": code
        ]
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await Self.session.data(for: request)
        try validateResponse(response, data: data)

        do {
            return try Self.jsonDecoder.decode(VerifyPhoneCodeResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("VerifyPhoneCodeResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Complete registration with phone (for new users after verification)
    /// - Parameters:
    ///   - registrationToken: Token from verifyPhoneCode for new users
    ///   - username: Chosen username
    ///   - name: Optional display name
    /// - Returns: PhoneRegisterResponse with auth tokens and user ID
    func registerWithPhone(registrationToken: String, username: String, name: String?) async throws -> PhoneRegisterResponse {
        let url = URL(string: "\(baseURL)/auth/phone/register")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(Self.appVersion, forHTTPHeaderField: "User-Agent")
        // No auth required - registration token provides authentication

        var body: [String: String] = [
            "registration_token": registrationToken,
            "username": username
        ]
        if let name = name {
            body["name"] = name
        }
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await Self.session.data(for: request)
        try validateResponse(response, data: data)

        do {
            return try Self.jsonDecoder.decode(PhoneRegisterResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("PhoneRegisterResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Check if username is available
    /// - Parameter username: Username to check
    /// - Returns: UsernameAvailabilityResponse with availability and suggestions
    func checkUsernameAvailability(username: String) async throws -> UsernameAvailabilityResponse {
        var components = URLComponents(string: "\(baseURL)/users/username/available")!
        components.queryItems = [URLQueryItem(name: "username", value: username)]

        guard let url = components.url else {
            throw APIClientError.invalidResponse
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(Self.appVersion, forHTTPHeaderField: "User-Agent")
        // No auth required - public endpoint

        let (data, response) = try await Self.session.data(for: request)
        try validateResponse(response, data: data)

        do {
            return try Self.jsonDecoder.decode(UsernameAvailabilityResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("UsernameAvailabilityResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    // MARK: - Retry Logic

    /// Retries an async operation with exponential backoff on transient errors.
    /// - Parameters:
    ///   - maxAttempts: Maximum number of attempts (default: 3)
    ///   - initialDelay: Initial delay in seconds (default: 1.0)
    ///   - operation: The async throwing operation to retry
    /// - Returns: The result of the operation
    private func withRetry<T>(
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
                try? await Task.sleep(nanoseconds: UInt64(min(retryDelay, 3.0) * 1_000_000_000))
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
    private func executeWithAuthRetry(
        request: URLRequest,
        allowedStatusCodes: Set<Int> = []
    ) async throws -> (Data, URLResponse) {
        let (data, response) = try await Self.session.data(for: request)

        do {
            try validateResponse(response, data: data, isRetry: false, allowedStatusCodes: allowedStatusCodes)
            return (data, response)
        } catch APIClientError.authRefreshNeeded {
            // If another request already refreshed the token, retry once with the newest token.
            if let usedToken = bearerToken(from: request), let authClosure = getAuthToken {
                let current = await authClosure()
                if let currentToken = current.token, currentToken != usedToken {
                    print("[APIClient] 401 with stale token - retrying with newer token")
                    var retryRequest = request
                    try await applyAuthHeaders(&retryRequest, requiresAuth: true)
                    let (retryData, retryResponse) = try await Self.session.data(for: retryRequest)
                    try validateResponse(
                        retryResponse,
                        data: retryData,
                        isRetry: true,
                        allowedStatusCodes: allowedStatusCodes
                    )
                    return (retryData, retryResponse)
                }
            }

            // 401 received - attempt token refresh if we have a refresh provider
            guard let refreshProvider = getAuthRefresh else {
                print("[APIClient] No refresh provider - triggering auth failure")
                notifyAuthFailure()
                throw APIClientError.notAuthenticated
            }

            do {
                print("[APIClient] Attempting token refresh before retry")
                try await refreshProvider()
                print("[APIClient] Token refresh successful - retrying request")

                // Rebuild request with fresh token
                var retryRequest = request
                try await applyAuthHeaders(&retryRequest, requiresAuth: true)

                // Retry the request (mark as retry to prevent infinite loops)
                let (retryData, retryResponse) = try await Self.session.data(for: retryRequest)
                try validateResponse(
                    retryResponse,
                    data: retryData,
                    isRetry: true,
                    allowedStatusCodes: allowedStatusCodes
                )
                return (retryData, retryResponse)

            } catch {
                // Check if this is a definitive auth failure
                let isDefinitiveFailure: Bool = {
                    if case AuthError.tokenExpired = error { return true }
                    if case AuthError.notAuthenticated = error { return true }
                    if case APIClientError.notAuthenticated = error { return true }
                    return false
                }()

                if isDefinitiveFailure {
                    throw APIClientError.notAuthenticated
                }

                // Transient refresh failure - don't logout, propagate error
                print("[APIClient] Transient refresh failure: \(error.localizedDescription)")
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

    // MARK: - Response Validation

    /// Maximum response size to prevent memory issues (10MB)
    private static let maxResponseSize = 10 * 1024 * 1024

    /// Validates HTTP response - throws authRefreshNeeded on 401 for refresh-and-retry handling
    /// - Parameters:
    ///   - response: The URL response to validate
    ///   - data: Response body data
    ///   - isRetry: If true, 401 triggers immediate auth failure instead of refresh attempt
    ///   - allowedStatusCodes: Non-2xx status codes to treat as valid responses
    private func validateResponse(
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
                if isRetry {
                    // Already retried after refresh - this is a definitive auth failure
                    print("[APIClient] 401 after retry - definitive auth failure")
                    notifyAuthFailure()
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
                if let reason = apiError.details?["reason"], !reason.isEmpty {
                    throw APIClientError.serverError("\(apiError.message) (Reason: \(reason))")
                }
                throw APIClientError.serverError(apiError.message)
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
    case serverError(String)
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
        case .serverError(let message):
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
