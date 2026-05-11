//
//  APIClient+Share.swift
//  PorizoApp
//
//  Track sharing API methods.
//

import Foundation

extension APIClient {

    // MARK: - Share API

    /// Create a share link for a track
    /// - Parameters:
    ///   - trackId: The track ID to share
    ///   - versionNum: Version number to share (optional, defaults to latest)
    ///   - expiresInDays: How many days until the share expires (default 30)
    /// - Returns: CreateShareResponse with share URL and claim PIN
    func createShare(
        trackId: String,
        versionNum: Int? = nil,
        expiresInDays: Int = 30,
        ogVariant: String? = nil
    ) async throws -> CreateShareResponse {
        let url = URL(string: "\(baseURL)/tracks/\(trackId)/share")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        try await applyAuthHeaders(&request)

        var body: [String: Any] = ["expires_in_days": expiresInDays]
        if let versionNum = versionNum {
            body["version_num"] = versionNum
        }
        if let ogVariant, !ogVariant.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            body["og_variant"] = ogVariant
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

    /// Fetch song OG variant previews for share style selection.
    /// - Parameter trackId: The track ID
    /// - Returns: Current variant plus all preview cards
    func getTrackOgPreviews(trackId: String) async throws -> OgVariantPreviewListResponse {
        let url = URL(string: "\(baseURL)/tracks/\(trackId)/og-previews")!

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        try await applyAuthHeaders(&request)

        let (data, _) = try await executeWithAuthRetry(request: request)
        do {
            return try Self.jsonDecoder.decode(OgVariantPreviewListResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("OgVariantPreviewListResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
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

        var body: [String: String] = [
            "app_version": appVersion,
        ]
        let trimmedPin = pin.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedPin.isEmpty {
            body["pin"] = trimmedPin
        }
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

    /// Resolve an opaque receiver handoff id into a short-lived claim token.
    /// The response intentionally does not expose the raw share id.
    func resolveReceiverHandoff(handoffId: String) async throws -> ReceiverHandoffResponse {
        let encoded = handoffId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? handoffId
        let url = URL(string: "\(baseURL)/receiver-handoff/\(encoded)")!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"

        let (data, response) = try await Self.session.data(for: request)
        try validateResponse(response, data: data)

        do {
            return try Self.jsonDecoder.decode(ReceiverHandoffResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("ReceiverHandoffResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Claim a receiver handoff token for the current device. This path is
    /// intentionally device-token based so recipients can save before signing in.
    func claimReceiverToken(
        claimToken: String,
        pin: String,
        appVersion: String
    ) async throws -> ReceiverClaimResponse {
        let encoded = claimToken.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? claimToken
        let url = URL(string: "\(baseURL)/receiver-claim/\(encoded)")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        guard let deviceToken = try await ensureDeviceToken() else {
            throw APIClientError.notAuthenticated
        }
        request.setValue(deviceToken, forHTTPHeaderField: "x-device-token")

        var body: [String: String] = [
            "device_id": deviceUserId,
            "platform": "ios",
            "app_version": appVersion,
        ]
        let trimmedPin = pin.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedPin.isEmpty {
            body["pin"] = trimmedPin
        }
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
            return try Self.jsonDecoder.decode(ReceiverClaimResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("ReceiverClaimResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Fetch a stream for an already-claimed opaque receiver token.
    func getReceiverClaimStream(claimToken: String) async throws -> ShareStreamResponse {
        let encoded = claimToken.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? claimToken
        let url = URL(string: "\(baseURL)/receiver-claim/\(encoded)/stream")!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("ios", forHTTPHeaderField: "x-platform")

        guard let deviceToken = try await ensureDeviceToken() else {
            throw APIClientError.notAuthenticated
        }
        request.setValue(deviceToken, forHTTPHeaderField: "x-device-token")

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
            return try Self.jsonDecoder.decode(ShareStreamResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("ShareStreamResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
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
}
