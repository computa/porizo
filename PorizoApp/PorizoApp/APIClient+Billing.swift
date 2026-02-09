//
//  APIClient+Billing.swift
//  PorizoApp
//
//  Billing, subscriptions, and app configuration API methods.
//

import Foundation

extension APIClient {

    // MARK: - Billing API

    /// Sync an Apple App Store transaction with the backend
    /// - Parameter transactionId: The StoreKit transaction ID
    /// - Returns: SyncReceiptResponse with subscription status and entitlements
    func syncAppleReceipt(transactionId: String) async throws -> SyncReceiptResponse {
        let url = URL(string: "\(baseURL)/billing/receipt/apple")!

        var request = try await makeRequest(url: url, method: "POST")
        // Idempotency key ensures safe retries - same key = same response
        request.setValue("apple_receipt_\(deviceUserId)_\(transactionId)", forHTTPHeaderField: "Idempotency-Key")

        let body: [String: Any] = ["transactionId": transactionId]
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
        let url = URL(string: "\(baseURL)/billing/subscription-status")!

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
}
