//
//  APIClient+Enrollment.swift
//  PorizoApp
//
//  Voice enrollment and device registration API methods.
//

import Foundation
import UIKit  // For BackgroundTaskManager

extension APIClient {

    // MARK: - Enrollment API

    /// Start a new voice enrollment session
    func startEnrollment() async throws -> EnrollmentSession {
        let url = URL(string: "\(baseURL)/voice/enrollment/start")!
        var request = try await makeRequest(url: url, method: "POST")

        let body: [String: Any] = [
            "consent_accepted": true,
            "consent_version": "ios_v1",
            "consent_scopes": ["voice_suno_persona_v1"],
            "voice_suno_persona_consent": true
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

        var request = try await makeRequest(url: url, method: "POST")

        let body: [String: Any] = [
            "session_id": sessionId,
            "consent_scopes": ["voice_suno_persona_v1"],
            "voice_suno_persona_consent": true
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        return try await withRetry {
            let (data, _) = try await self.executeWithAuthRetry(request: request)

            do {
                return try Self.jsonDecoder.decode(VoiceProfile.self, from: data)
            } catch {
                let responseText = String(data: data, encoding: .utf8) ?? "No response"
                throw APIClientError.decodingError("VoiceProfile: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
            }
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
    /// Includes the APNs push token if available for server-initiated notifications.
    func registerDevice(appVersion: String) async throws -> DeviceRegistrationResponse {
        let url = URL(string: "\(baseURL)/device/register")!

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        try await applyAuthHeaders(&request)

        // Build request body with optional push token
        var body: [String: String] = [
            "device_id": deviceUserId,
            "platform": "ios",
            "app_version": appVersion
        ]

        // Include APNs push token if available
        if let pushToken = PushTokenManager.getPushToken() {
            body["push_token"] = pushToken
        }

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
}
