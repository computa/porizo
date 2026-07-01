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

    func getOrCreateDeviceId() -> String {
        if let existing = UserDefaults.standard.string(forKey: Self.deviceIdKey), !existing.isEmpty {
            return existing
        }
        let generated = "android_\(UUID().uuidString.lowercased().prefix(12))"
        UserDefaults.standard.set(generated, forKey: Self.deviceIdKey)
        return generated
    }

    func loadAuthSession() -> PorizoAuthSession? {
        guard let data = UserDefaults.standard.data(forKey: Self.authSessionKey) else { return nil }
        return try? JSONDecoder().decode(PorizoAuthSession.self, from: data)
    }

    func saveAuthSession(_ session: PorizoAuthSession) {
        if let data = try? JSONEncoder().encode(session) {
            UserDefaults.standard.set(data, forKey: Self.authSessionKey)
        }
    }

    func clearAuthSession() {
        UserDefaults.standard.removeObject(forKey: Self.authSessionKey)
    }

    func loadDeviceTokenExpiry() -> String? {
        UserDefaults.standard.string(forKey: Self.deviceTokenExpiryKey)
    }

    func currentDeviceToken() -> String? {
        UserDefaults.standard.string(forKey: Self.deviceTokenKey)
    }

    func saveDeviceToken(_ token: String, expiresAt: String) {
        UserDefaults.standard.set(token, forKey: Self.deviceTokenKey)
        UserDefaults.standard.set(expiresAt, forKey: Self.deviceTokenExpiryKey)
    }

    func clearDeviceToken() {
        UserDefaults.standard.removeObject(forKey: Self.deviceTokenKey)
        UserDefaults.standard.removeObject(forKey: Self.deviceTokenExpiryKey)
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

    func getJobStatus(jobId: String) async throws -> PorizoJobStatus {
        try await send(path: "/jobs/\(encodedPathComponent(jobId))", method: "GET", requiresAuth: true)
    }

    func getPoems() async throws -> PorizoGetPoemsResponse {
        try await send(path: "/poems", method: "GET", requiresAuth: true)
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

    func registerPushToken(_ pushToken: String) async throws -> PorizoDeviceRegistrationResponse {
        try await registerDevice(pushToken: pushToken)
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
