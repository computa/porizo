import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

enum AndroidAPIClientError: Error, CustomStringConvertible, Sendable {
    case invalidURL(String)
    case notAuthenticated
    case server(status: Int, code: String?, message: String)
    case decoding(String)

    var description: String {
        switch self {
        case .invalidURL(let path):
            return "Invalid API URL: \(path)"
        case .notAuthenticated:
            return "Sign in is required."
        case .server(_, let code, let message):
            if let code, !code.isEmpty {
                return "\(code): \(message)"
            }
            return message
        case .decoding(let message):
            return message
        }
    }
}

struct AndroidSessionStore: Sendable {
    private static let deviceIdKey = "porizo_android_device_id"
    private static let authSessionKey = "porizo_android_auth_session"
    private static let deviceTokenKey = "porizo_android_device_token"
    private static let deviceTokenExpiryKey = "porizo_android_device_token_expiry"
    private let secretStore = AndroidSecretStore()

    func getOrCreateDeviceId() -> String {
        if let existing = UserDefaults.standard.string(forKey: Self.deviceIdKey), !existing.isEmpty {
            return existing
        }
        let generated = "android_\(UUID().uuidString.lowercased().prefix(12))"
        UserDefaults.standard.set(generated, forKey: Self.deviceIdKey)
        return generated
    }

    func loadAuthSession() -> PorizoAuthSession? {
        if let encoded = secretStore.string(forKey: Self.authSessionKey),
           let data = encoded.data(using: .utf8),
           let session = try? JSONDecoder().decode(PorizoAuthSession.self, from: data) {
            return session
        }

        guard let legacyData = UserDefaults.standard.data(forKey: Self.authSessionKey),
              let session = try? JSONDecoder().decode(PorizoAuthSession.self, from: legacyData) else {
            return nil
        }
        saveAuthSession(session)
        UserDefaults.standard.removeObject(forKey: Self.authSessionKey)
        return session
    }

    func saveAuthSession(_ session: PorizoAuthSession) {
        if let data = try? JSONEncoder().encode(session),
           let encoded = String(data: data, encoding: .utf8) {
            secretStore.setString(encoded, forKey: Self.authSessionKey)
        }
    }

    func clearAuthSession() {
        secretStore.removeString(forKey: Self.authSessionKey)
    }

    func loadDeviceTokenExpiry() -> String? {
        secretStore.string(forKey: Self.deviceTokenExpiryKey)
    }

    func currentDeviceToken() -> String? {
        secretStore.string(forKey: Self.deviceTokenKey)
    }

    func saveDeviceToken(_ token: String, expiresAt: String) {
        secretStore.setString(token, forKey: Self.deviceTokenKey)
        secretStore.setString(expiresAt, forKey: Self.deviceTokenExpiryKey)
    }

    func clearDeviceToken() {
        secretStore.removeString(forKey: Self.deviceTokenKey)
        secretStore.removeString(forKey: Self.deviceTokenExpiryKey)
    }
}

actor AndroidAPIClient {
    private let baseURL: String
    private let sessionStore: AndroidSessionStore
    private let deviceId: String

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()

    init(
        baseURL: String = AndroidAppConfig.apiBaseURL,
        sessionStore: AndroidSessionStore = AndroidSessionStore()
    ) {
        self.baseURL = baseURL
        self.sessionStore = sessionStore
        self.deviceId = sessionStore.getOrCreateDeviceId()
    }

    func sendPhoneVerificationCode(phoneNumber: String) async throws -> PorizoSendPhoneCodeResponse {
        struct Body: Encodable {
            let phoneNumber: String

            enum CodingKeys: String, CodingKey {
                case phoneNumber = "phone_number"
            }
        }
        return try await send(path: "/auth/phone/send-code", method: "POST", body: Body(phoneNumber: phoneNumber))
    }

    func verifyPhoneCode(phoneNumber: String, code: String) async throws -> PorizoVerifyPhoneCodeResponse {
        struct Body: Encodable {
            let phoneNumber: String
            let code: String

            enum CodingKeys: String, CodingKey {
                case phoneNumber = "phone_number"
                case code
            }
        }
        let response: PorizoVerifyPhoneCodeResponse = try await send(path: "/auth/phone/verify", method: "POST", body: Body(phoneNumber: phoneNumber, code: code))
        if let userId = response.userId,
           let accessToken = response.accessToken,
           let refreshToken = response.refreshToken {
            sessionStore.saveAuthSession(PorizoAuthSession(userId: userId, accessToken: accessToken, refreshToken: refreshToken, expiresIn: 3600))
            sessionStore.clearDeviceToken()
        }
        return response
    }

    func registerPhoneAccount(registrationToken: String, phoneNumber: String) async throws -> PorizoAuthSession {
        struct Body: Encodable {
            let registrationToken: String
            let phoneNumber: String

            enum CodingKeys: String, CodingKey {
                case registrationToken = "registration_token"
                case phoneNumber = "phone_number"
            }
        }
        let response: PorizoPhoneRegisterResponse = try await send(path: "/auth/phone/register", method: "POST", body: Body(registrationToken: registrationToken, phoneNumber: phoneNumber))
        guard let userId = response.userId,
              let accessToken = response.accessToken,
              let refreshToken = response.refreshToken else {
            if response.accountExists == true {
                let methods = response.authMethods?.joined(separator: ", ") ?? "another sign-in method"
                throw AndroidAPIClientError.server(
                    status: 409,
                    code: "ACCOUNT_EXISTS",
                    message: "This phone matches an existing account. Sign in with \(methods)."
                )
            }
            throw AndroidAPIClientError.decoding("Phone registration did not include auth tokens.")
        }
        let session = PorizoAuthSession(
            userId: userId,
            accessToken: accessToken,
            refreshToken: refreshToken,
            expiresIn: response.expiresIn ?? 3600
        )
        sessionStore.saveAuthSession(session)
        sessionStore.clearDeviceToken()
        return session
    }

    /// Sign in with a Google ID token via the unified social endpoint. On a
    /// cross-provider match the server returns requires_link_confirmation; pass
    /// confirmLink: true on the second call to complete the link.
    func socialLogin(
        provider: String = "google",
        idToken: String,
        name: String? = nil,
        confirmLink: Bool = false
    ) async throws -> PorizoSocialAuthResponse {
        struct Body: Encodable {
            let provider: String
            let idToken: String
            let name: String?
            let confirmLink: Bool?

            enum CodingKeys: String, CodingKey {
                case provider
                case idToken = "id_token"
                case name
                case confirmLink = "confirm_link"
            }
        }
        let response: PorizoSocialAuthResponse = try await send(
            path: "/auth/social",
            method: "POST",
            body: Body(provider: provider, idToken: idToken, name: name, confirmLink: confirmLink ? true : nil)
        )
        if let userId = response.userId,
           let accessToken = response.accessToken,
           let refreshToken = response.refreshToken {
            sessionStore.saveAuthSession(PorizoAuthSession(
                userId: userId,
                accessToken: accessToken,
                refreshToken: refreshToken,
                expiresIn: response.expiresIn ?? 3600
            ))
            sessionStore.clearDeviceToken()
        }
        return response
    }

    /// Rotate tokens. Uses the stored refresh token (not Bearer auth). Saves the
    /// new pair on success. Throws on definitive rejection (caller decides logout).
    func refreshSession() async throws -> PorizoRefreshResponse {
        guard let refreshToken = sessionStore.loadAuthSession()?.refreshToken else {
            throw AndroidAPIClientError.notAuthenticated
        }
        struct Body: Encodable {
            let refreshToken: String
            enum CodingKeys: String, CodingKey { case refreshToken = "refresh_token" }
        }
        let response: PorizoRefreshResponse = try await send(
            path: "/auth/refresh",
            method: "POST",
            body: Body(refreshToken: refreshToken)
        )
        let existing = sessionStore.loadAuthSession()
        sessionStore.saveAuthSession(PorizoAuthSession(
            userId: existing?.userId ?? "",
            accessToken: response.accessToken,
            refreshToken: response.refreshToken,
            expiresIn: response.expiresIn ?? 3600
        ))
        return response
    }

    /// Current authenticated user.
    func getMe() async throws -> PorizoAuthUser {
        try await send(path: "/auth/me", method: "GET", requiresAuth: true)
    }

    /// Fire-and-forget server logout, then clear the local session.
    func logout() async {
        struct Empty: Decodable {}
        _ = try? await send(path: "/auth/logout", method: "POST", requiresAuth: true) as Empty
        sessionStore.clearAuthSession()
        sessionStore.clearDeviceToken()
    }

    /// Clear the cached device token so the next auth'd call re-registers.
    /// Used by the claim flow's single-retry-on-401 (INVALID_DEVICE_TOKEN).
    func clearDeviceToken() {
        sessionStore.clearDeviceToken()
    }

    func registerDevice(pushToken: String? = nil) async throws -> PorizoDeviceRegistrationResponse {
        struct Body: Encodable {
            let deviceId: String
            let platform: String
            let appVersion: String
            let pushToken: String?

            enum CodingKeys: String, CodingKey {
                case deviceId = "device_id"
                case platform
                case appVersion = "app_version"
                case pushToken = "push_token"
            }
        }
        let response: PorizoDeviceRegistrationResponse = try await send(
            path: "/device/register",
            method: "POST",
            requiresAuth: false,
            body: Body(
                deviceId: deviceId,
                platform: AndroidAppConfig.platform,
                appVersion: AndroidAppConfig.marketingVersion,
                pushToken: pushToken
            )
        )
        sessionStore.saveDeviceToken(response.deviceToken, expiresAt: response.expiresAt)
        return response
    }

    func getTracks(limit: Int = 50, offset: Int = 0) async throws -> PorizoGetTracksResponse {
        try await send(path: "/tracks?limit=\(min(limit, 100))&offset=\(max(offset, 0))", method: "GET", requiresAuth: true)
    }

    func getTrack(id: String) async throws -> PorizoGetTrackResponse {
        try await send(path: "/tracks/\(id)", method: "GET", requiresAuth: true)
    }

    func createTrack(_ request: PorizoCreateTrackRequest) async throws -> PorizoCreateTrackResponse {
        try await send(path: "/tracks", method: "POST", requiresAuth: true, body: request)
    }

    func createVersion(trackId: String, renderType: String = "preview") async throws -> PorizoCreateVersionResponse {
        struct Body: Encodable {
            let renderType: String

            enum CodingKeys: String, CodingKey {
                case renderType = "render_type"
            }
        }
        return try await send(
            path: "/tracks/\(encodedPathComponent(trackId))/versions",
            method: "POST",
            requiresAuth: true,
            body: Body(renderType: renderType)
        )
    }

    func renderPreview(trackId: String, versionNum: Int) async throws -> PorizoRenderPreviewResponse {
        try await send(
            path: "/tracks/\(encodedPathComponent(trackId))/versions/\(versionNum)/render_preview",
            method: "POST",
            requiresAuth: true,
            body: EmptyJSONBody()
        )
    }

    func renderFull(trackId: String, versionNum: Int) async throws -> PorizoRenderFullResponse {
        try await send(
            path: "/tracks/\(encodedPathComponent(trackId))/versions/\(versionNum)/render_full",
            method: "POST",
            requiresAuth: true,
            body: EmptyJSONBody()
        )
    }

    /// Retry a failed render via the version's /retry endpoint. Returns a fresh
    /// job to poll. iOS falls back to render_preview on 404 / NO_FAILED_JOB.
    func retryPreview(trackId: String, versionNum: Int) async throws -> PorizoRenderPreviewResponse {
        try await send(
            path: "/tracks/\(encodedPathComponent(trackId))/versions/\(versionNum)/retry",
            method: "POST",
            requiresAuth: true,
            body: EmptyJSONBody()
        )
    }

    /// Create (or return the existing) share link for a track. `requirePin`
    /// defaults true; the one-tap "Send to {name}" path passes false for a
    /// PIN-less link. Response `claim_pin` is null for PIN-less shares.
    func createShare(trackId: String, versionNum: Int? = nil, requirePin: Bool = true) async throws -> PorizoCreateShareResponse {
        struct Body: Encodable {
            let requirePin: Bool
            let versionNum: Int?
            enum CodingKeys: String, CodingKey {
                case requirePin = "require_pin"
                case versionNum = "version_num"
            }
        }
        return try await send(
            path: "/tracks/\(encodedPathComponent(trackId))/share",
            method: "POST",
            requiresAuth: true,
            body: Body(requirePin: requirePin, versionNum: versionNum)
        )
    }

    /// Approve the reviewed lyrics before rendering. Body is an empty JSON
    /// object per the iOS contract.
    func approveLyrics(trackId: String, versionNum: Int) async throws -> PorizoApproveLyricsResponse {
        try await send(
            path: "/tracks/\(encodedPathComponent(trackId))/versions/\(versionNum)/lyrics/approve",
            method: "POST",
            requiresAuth: true,
            body: EmptyJSONBody()
        )
    }

    func getJobStatus(jobId: String) async throws -> PorizoJobStatus {
        try await send(path: "/jobs/\(encodedPathComponent(jobId))", method: "GET", requiresAuth: true)
    }

    func getPoems() async throws -> PorizoGetPoemsResponse {
        try await send(path: "/poems", method: "GET", requiresAuth: true)
    }

    /// Idempotently generate (or fetch) the poem's TTS audio.
    func generatePoemAudio(id: String) async throws -> PorizoPoemAudioResponse {
        struct Empty: Encodable {}
        return try await send(path: "/poems/\(id)/audio", method: "POST", requiresAuth: true, body: Empty())
    }

    /// The authenticated poem-audio stream URL (auth applied by the player).
    /// nonisolated — a pure string builder with no actor state.
    nonisolated func poemAudioURL(id: String) -> String {
        "/poems/\(id)/audio"
    }

    /// Turn a confirmed story into a poem (synchronous generation — returns the
    /// full poem with verses). The poem branch of the create flow (U13).
    func storyToPoem(storyId: String) async throws -> PorizoStoryToPoemResponse {
        struct Empty: Encodable {}
        return try await send(path: "/story/\(storyId)/to-poem", method: "POST", requiresAuth: true, body: Empty())
    }

    /// Create (or return the existing) share link for a poem.
    func createPoemShare(poemId: String) async throws -> PorizoCreateShareResponse {
        struct Empty: Encodable {}
        return try await send(path: "/poems/\(encodedPathComponent(poemId))/share", method: "POST", requiresAuth: true, body: Empty())
    }

    /// Resolve a poem-share link (reveal verses before claim).
    func getPoemShareInfo(shareId: String) async throws -> PorizoPoemShareInfoResponse {
        try await send(path: "/poem-share/\(encodedPathComponent(shareId))", method: "GET", requiresAuth: false)
    }

    /// Claim a poem share into the signed-in library.
    func claimPoemShare(shareId: String, pin: String) async throws -> PorizoShareClaimResponse {
        struct Body: Encodable {
            let pin: String?
        }
        return try await send(
            path: "/poem-share/\(encodedPathComponent(shareId))/claim",
            method: "POST",
            requiresAuth: true,
            body: Body(pin: pin.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : pin)
        )
    }

    func getShareInfo(shareId: String) async throws -> PorizoShareInfoResponse {
        var request = try makeRequest(path: "/share/\(encodedPathComponent(shareId))", method: "GET", requiresAuth: false)
        request.setValue(deviceId, forHTTPHeaderField: "x-device-id")
        if let token = sessionStore.currentDeviceToken() {
            request.setValue(token, forHTTPHeaderField: "x-device-token")
        }
        return try await execute(request)
    }

    func claimShare(shareId: String, pin: String) async throws -> PorizoShareClaimResponse {
        struct Body: Encodable {
            let pin: String?
            let appVersion: String

            enum CodingKeys: String, CodingKey {
                case pin
                case appVersion = "app_version"
            }
        }
        let token = try await ensureDeviceToken()
        var request = try makeRequest(path: "/share/\(encodedPathComponent(shareId))/claim", method: "POST", requiresAuth: false)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(token, forHTTPHeaderField: "x-device-token")
        request.httpBody = try JSONEncoder().encode(Body(pin: pin.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : pin, appVersion: AndroidAppConfig.marketingVersion))
        return try await execute(request)
    }

    func resolveReceiverHandoff(handoffId: String) async throws -> PorizoReceiverHandoffResponse {
        try await send(path: "/receiver-handoff/\(encodedPathComponent(handoffId))", method: "GET", requiresAuth: false)
    }

    func claimReceiverToken(claimToken: String, pin: String) async throws -> PorizoShareClaimResponse {
        struct Body: Encodable {
            let deviceId: String
            let platform: String
            let appVersion: String
            let pin: String?

            enum CodingKeys: String, CodingKey {
                case deviceId = "device_id"
                case platform
                case appVersion = "app_version"
                case pin
            }
        }
        let token = try await ensureDeviceToken()
        var request = try makeRequest(path: "/receiver-claim/\(encodedPathComponent(claimToken))", method: "POST", requiresAuth: false)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(token, forHTTPHeaderField: "x-device-token")
        request.httpBody = try JSONEncoder().encode(Body(deviceId: deviceId, platform: AndroidAppConfig.platform, appVersion: AndroidAppConfig.marketingVersion, pin: pin.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : pin))
        return try await execute(request)
    }

    func getShareStream(shareId: String) async throws -> PorizoShareStreamResponse {
        let token = try await ensureDeviceToken()
        var request = try makeRequest(path: "/share/\(encodedPathComponent(shareId))/stream", method: "GET", requiresAuth: false)
        request.setValue(deviceId, forHTTPHeaderField: "x-device-id")
        request.setValue(AndroidAppConfig.platform, forHTTPHeaderField: "x-platform")
        request.setValue(token, forHTTPHeaderField: "x-device-token")
        return try await execute(request)
    }

    func getBillingEntitlements() async throws -> PorizoBillingEntitlements {
        try await send(path: "/billing/entitlements", method: "GET", requiresAuth: true)
    }

    func validateGoogleSubscription(purchaseToken: String, subscriptionId: String) async throws -> PorizoGoogleReceiptResponse {
        struct Body: Encodable {
            let purchaseToken: String
            let subscriptionId: String

            enum CodingKeys: String, CodingKey {
                case purchaseToken = "purchase_token"
                case subscriptionId = "subscription_id"
            }
        }
        return try await send(path: "/billing/receipt/google", method: "POST", requiresAuth: true, body: Body(purchaseToken: purchaseToken, subscriptionId: subscriptionId))
    }

    func getBillingPlans() async throws -> PorizoPlansResponse {
        try await send(path: "/billing/plans", method: "GET", requiresAuth: false)
    }

    func getSubscriptionStatus() async throws -> PorizoSubscriptionStatusResponse {
        try await send(path: "/billing/subscription-status", method: "GET", requiresAuth: true)
    }

    func registerPushToken(_ pushToken: String) async throws -> PorizoDeviceRegistrationResponse {
        try await registerDevice(pushToken: pushToken)
    }

    func startEnrollment(consentAccepted: Bool) async throws -> PorizoEnrollmentSession {
        struct Body: Encodable {
            let consentAccepted: Bool
            let consentVersion: String
            let consentScopes: [String]
            let voiceSunoPersonaConsent: Bool

            enum CodingKeys: String, CodingKey {
                case consentAccepted = "consent_accepted"
                case consentVersion = "consent_version"
                case consentScopes = "consent_scopes"
                case voiceSunoPersonaConsent = "voice_suno_persona_consent"
            }
        }
        return try await send(
            path: "/voice/enrollment/start",
            method: "POST",
            requiresAuth: true,
            body: Body(
                consentAccepted: consentAccepted,
                consentVersion: "android_v1",
                consentScopes: consentAccepted ? ["voice_suno_persona_v1"] : [],
                voiceSunoPersonaConsent: consentAccepted
            )
        )
    }

    func uploadEnrollmentChunk(
        sessionId: String,
        chunkId: String,
        audioData: Data,
        uploadURL: PorizoUploadURL,
        durationSec: Double,
        checksum: String?
    ) async throws -> PorizoChunkUploadResponse {
        guard let url = URL(string: uploadURL.url) else {
            throw AndroidAPIClientError.invalidURL(uploadURL.url)
        }

        var uploadRequest = URLRequest(url: url)
        uploadRequest.httpMethod = uploadURL.method ?? "PUT"
        uploadURL.headers?.forEach { key, value in
            uploadRequest.setValue(value, forHTTPHeaderField: key)
        }
        if uploadRequest.value(forHTTPHeaderField: "Content-Type") == nil {
            uploadRequest.setValue("audio/wav", forHTTPHeaderField: "Content-Type")
        }
        let (_, uploadResponse) = try await URLSession.shared.upload(for: uploadRequest, from: audioData)
        guard let uploadHTTP = uploadResponse as? HTTPURLResponse,
              (200..<300).contains(uploadHTTP.statusCode) else {
            let status = (uploadResponse as? HTTPURLResponse)?.statusCode ?? 0
            throw AndroidAPIClientError.server(status: status, code: "UPLOAD_FAILED", message: "Audio upload failed with status \(status).")
        }

        struct Body: Encodable {
            let sessionId: String
            let chunkId: String
            let durationSec: Double
            let clientChecksum: String?

            enum CodingKeys: String, CodingKey {
                case sessionId = "session_id"
                case chunkId = "chunk_id"
                case durationSec = "duration_sec"
                case clientChecksum = "client_checksum"
            }
        }
        return try await send(
            path: "/voice/enrollment/chunk_uploaded",
            method: "POST",
            requiresAuth: true,
            body: Body(sessionId: sessionId, chunkId: chunkId, durationSec: durationSec, clientChecksum: checksum)
        )
    }

    func completeEnrollment(sessionId: String) async throws -> PorizoVoiceProfile {
        struct Body: Encodable {
            let sessionId: String
            let consentScopes: [String]
            let voiceSunoPersonaConsent: Bool

            enum CodingKeys: String, CodingKey {
                case sessionId = "session_id"
                case consentScopes = "consent_scopes"
                case voiceSunoPersonaConsent = "voice_suno_persona_consent"
            }
        }
        return try await send(
            path: "/voice/enrollment/complete",
            method: "POST",
            requiresAuth: true,
            body: Body(
                sessionId: sessionId,
                consentScopes: ["voice_suno_persona_v1"],
                voiceSunoPersonaConsent: true
            )
        )
    }

    // MARK: - Story (create conversation, U8)

    func startStory(initialPrompt: String, occasion: String, recipientName: String) async throws -> PorizoStartStoryResponse {
        struct Body: Encodable {
            let initialPrompt: String
            let occasion: String
            let recipientName: String
            enum CodingKeys: String, CodingKey {
                case initialPrompt = "initial_prompt"
                case occasion
                case recipientName = "recipient_name"
            }
        }
        return try await send(
            path: "/story/start",
            method: "POST",
            requiresAuth: true,
            body: Body(initialPrompt: initialPrompt, occasion: occasion, recipientName: recipientName)
        )
    }

    func continueStory(storyId: String, answer: String, expectedSessionVersion: Int?) async throws -> PorizoContinueStoryResponse {
        struct Body: Encodable {
            let answer: String
            let expectedSessionVersion: Int?
            enum CodingKeys: String, CodingKey {
                case answer
                case expectedSessionVersion = "expected_session_version"
            }
        }
        return try await send(
            path: "/story/\(storyId)/continue",
            method: "POST",
            requiresAuth: true,
            body: Body(answer: answer, expectedSessionVersion: expectedSessionVersion)
        )
    }

    /// Outcome of confirming a story: 200 locks it in, 422 means the server
    /// needs more input (a legitimate flow, NOT an error).
    enum ConfirmStoryOutcome: Sendable {
        case confirmed(PorizoConfirmStoryResponse)
        case needsInput(PorizoStoryGuidanceResponse)
    }

    func confirmStory(storyId: String) async throws -> ConfirmStoryOutcome {
        var request = try makeRequest(path: "/story/\(storyId)/confirm", method: "POST", requiresAuth: true)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data("{}".utf8)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw AndroidAPIClientError.server(status: 0, code: nil, message: "No HTTP response.")
        }
        if http.statusCode == 422 {
            let guidance = (try? Self.decoder.decode(PorizoStoryGuidanceResponse.self, from: data))
                ?? PorizoStoryGuidanceResponse(message: "A little more detail will help.", question: nil)
            return .needsInput(guidance)
        }
        guard (200..<300).contains(http.statusCode) else {
            let envelope = try? Self.decoder.decode(PorizoAPIErrorEnvelope.self, from: data)
            throw AndroidAPIClientError.server(
                status: http.statusCode,
                code: envelope?.code ?? envelope?.error,
                message: envelope?.message ?? "Confirm failed with status \(http.statusCode)."
            )
        }
        let confirmed = try Self.decoder.decode(PorizoConfirmStoryResponse.self, from: data)
        return .confirmed(confirmed)
    }

    func generateStoryLyrics(storyId: String) async throws -> PorizoStoryLyricsResponse {
        struct Empty: Encodable {}
        return try await send(path: "/story/\(storyId)/lyrics", method: "POST", requiresAuth: true, body: Empty())
    }

    func storyToTrack(storyId: String, voiceMode: String? = nil) async throws -> PorizoStoryToTrackResponse {
        struct Body: Encodable {
            let voiceMode: String?
            enum CodingKeys: String, CodingKey { case voiceMode = "voice_mode" }
        }
        return try await send(
            path: "/story/\(storyId)/to-track",
            method: "POST",
            requiresAuth: true,
            body: Body(voiceMode: voiceMode)
        )
    }

    func getVoiceProfile() async throws -> PorizoVoiceProfileStatus {
        try await send(path: "/voice/profile", method: "GET", requiresAuth: true)
    }

    private func ensureDeviceToken() async throws -> String {
        if let token = sessionStore.currentDeviceToken(), !token.isEmpty {
            return token
        }
        return try await registerDevice().deviceToken
    }

    private func send<Response: Decodable>(path: String, method: String, requiresAuth: Bool = false) async throws -> Response {
        let request = try makeRequest(path: path, method: method, requiresAuth: requiresAuth)
        return try await execute(request)
    }

    private func send<Response: Decodable, Body: Encodable>(
        path: String,
        method: String,
        requiresAuth: Bool = false,
        body: Body
    ) async throws -> Response {
        var request = try makeRequest(path: path, method: method, requiresAuth: requiresAuth)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        return try await execute(request)
    }

    private func makeRequest(path: String, method: String, requiresAuth: Bool) throws -> URLRequest {
        guard let url = URL(string: "\(baseURL)\(path)") else {
            throw AndroidAPIClientError.invalidURL(path)
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("PorizoAndroid/\(AndroidAppConfig.marketingVersion)", forHTTPHeaderField: "User-Agent")
        if requiresAuth {
            guard let token = sessionStore.loadAuthSession()?.accessToken else {
                throw AndroidAPIClientError.notAuthenticated
            }
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        } else if let token = sessionStore.loadAuthSession()?.accessToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    private func execute<Response: Decodable>(_ request: URLRequest) async throws -> Response {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw AndroidAPIClientError.server(status: 0, code: nil, message: "No HTTP response.")
        }
        guard (200..<300).contains(http.statusCode) else {
            let envelope = try? Self.decoder.decode(PorizoAPIErrorEnvelope.self, from: data)
            throw AndroidAPIClientError.server(
                status: http.statusCode,
                code: envelope?.code ?? envelope?.error,
                message: envelope?.message ?? "Request failed with status \(http.statusCode)."
            )
        }
        do {
            return try Self.decoder.decode(Response.self, from: data)
        } catch {
            let preview = String(data: data, encoding: .utf8)?.prefix(240) ?? ""
            throw AndroidAPIClientError.decoding("Could not decode response: \(error). Body: \(preview)")
        }
    }

    private func encodedPathComponent(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? value
    }
}

private struct EmptyJSONBody: Encodable, Sendable {}
