//
//  APIClient+Gifts.swift
//  PorizoApp
//
//  Gift scheduling + wallet API methods.
//

import Foundation

extension APIClient {

    // MARK: - Gift Wallet

    /// Fetch gift wallet balance and recent transactions
    func getGiftWallet(limit: Int = 20) async throws -> GiftWalletResponse {
        var components = URLComponents(string: "\(baseURL)/billing/gift-wallet")!
        components.queryItems = [
            URLQueryItem(name: "limit", value: String(min(max(limit, 1), 100)))
        ]

        var request = URLRequest(url: components.url!)
        request.httpMethod = "GET"
        try await applyAuthHeaders(&request)

        let (data, _) = try await executeWithAuthRetry(request: request)
        do {
            return try Self.jsonDecoder.decode(GiftWalletResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("GiftWalletResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    /// Sync one-off consumable purchase for a gift token
    func syncAppleGiftConsumable(transactionId: String) async throws -> GiftConsumableSyncResponse {
        let url = URL(string: "\(baseURL)/billing/receipt/apple/consumable")!
        var request = try await makeRequest(url: url, method: "POST")
        request.setValue("apple_gift_consumable_\(deviceUserId)_\(transactionId)", forHTTPHeaderField: "Idempotency-Key")
        let body: [String: Any] = ["transactionId": transactionId]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        return try await withRetry(maxAttempts: 5, initialDelay: 1.0) {
            let (data, _) = try await self.executeWithAuthRetry(request: request)
            do {
                return try Self.jsonDecoder.decode(GiftConsumableSyncResponse.self, from: data)
            } catch {
                let responseText = String(data: data, encoding: .utf8) ?? "No response"
                throw APIClientError.decodingError("GiftConsumableSyncResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
            }
        }
    }

    // MARK: - Gifts

    func createGiftReservation(idempotencyKey: String) async throws -> GiftReservationResponse {
        let url = URL(string: "\(baseURL)/gifts/reservations")!
        var request = try await makeRequest(url: url, method: "POST")
        request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        let payload = CreateGiftReservationRequest(flowType: "gift")
        request.httpBody = try JSONEncoder().encode(payload)

        let (data, _) = try await executeWithAuthRetry(request: request)
        do {
            return try Self.jsonDecoder.decode(GiftReservationResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("GiftReservationResponse(create): \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    func getActiveGiftReservation() async throws -> GiftReservationResponse {
        let url = URL(string: "\(baseURL)/gifts/reservations/active")!
        var request = try await makeRequest(url: url, method: "GET")
        request.httpBody = nil

        let (data, _) = try await executeWithAuthRetry(request: request)
        do {
            return try Self.jsonDecoder.decode(GiftReservationResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("GiftReservationResponse(active): \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    func attachGiftReservationContent(
        reservationId: String,
        contentType: String,
        contentId: String,
        versionNum: Int?
    ) async throws -> GiftReservationResponse {
        let url = URL(string: "\(baseURL)/gifts/reservations/\(reservationId)/content")!
        var request = try await makeRequest(url: url, method: "POST")
        let payload = AttachGiftReservationContentRequest(
            contentType: contentType,
            contentId: contentId,
            versionNum: versionNum
        )
        request.httpBody = try JSONEncoder().encode(payload)

        let (data, _) = try await executeWithAuthRetry(request: request)
        do {
            return try Self.jsonDecoder.decode(GiftReservationResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("GiftReservationResponse(attach): \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    func finalizeGiftReservation(
        reservationId: String,
        request finalizeRequest: FinalizeGiftReservationRequest,
        idempotencyKey: String
    ) async throws -> CreateGiftResponse {
        let url = URL(string: "\(baseURL)/gifts/reservations/\(reservationId)/finalize")!
        var request = try await makeRequest(url: url, method: "POST")
        request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        request.httpBody = try JSONEncoder().encode(finalizeRequest)

        let (data, _) = try await executeWithAuthRetry(request: request)
        do {
            return try Self.jsonDecoder.decode(CreateGiftResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("CreateGiftResponse(finalize): \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    func cancelGiftReservation(reservationId: String) async throws -> CancelGiftReservationResponse {
        let url = URL(string: "\(baseURL)/gifts/reservations/\(reservationId)/cancel")!
        var request = try await makeRequest(url: url, method: "POST")
        request.httpBody = "{}".data(using: .utf8)

        let (data, _) = try await executeWithAuthRetry(request: request)
        do {
            return try Self.jsonDecoder.decode(CancelGiftReservationResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("CancelGiftReservationResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    func createGift(request giftRequest: CreateGiftRequest, idempotencyKey: String) async throws -> CreateGiftResponse {
        let url = URL(string: "\(baseURL)/gifts")!
        var request = try await makeRequest(url: url, method: "POST")
        request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        request.httpBody = try JSONEncoder().encode(giftRequest)

        let (data, _) = try await executeWithAuthRetry(request: request)
        do {
            return try Self.jsonDecoder.decode(CreateGiftResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("CreateGiftResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    func getGifts(status: String? = nil, limit: Int = 50, offset: Int = 0) async throws -> GetGiftsResponse {
        var components = URLComponents(string: "\(baseURL)/gifts")!
        var queryItems: [URLQueryItem] = [
            URLQueryItem(name: "limit", value: String(min(max(limit, 1), 100))),
            URLQueryItem(name: "offset", value: String(max(offset, 0)))
        ]
        if let status, !status.isEmpty {
            queryItems.append(URLQueryItem(name: "status", value: status))
        }
        components.queryItems = queryItems

        var request = URLRequest(url: components.url!)
        request.httpMethod = "GET"
        try await applyAuthHeaders(&request)

        let (data, _) = try await executeWithAuthRetry(request: request)
        do {
            return try Self.jsonDecoder.decode(GetGiftsResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("GetGiftsResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    func updateGift(giftId: String, updates: UpdateGiftRequest) async throws -> UpdateGiftResponse {
        let url = URL(string: "\(baseURL)/gifts/\(giftId)")!
        var request = try await makeRequest(url: url, method: "PATCH")
        request.httpBody = try JSONEncoder().encode(updates)

        let (data, _) = try await executeWithAuthRetry(request: request)
        do {
            return try Self.jsonDecoder.decode(UpdateGiftResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("UpdateGiftResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }

    func cancelGift(giftId: String) async throws -> CancelGiftResponse {
        let url = URL(string: "\(baseURL)/gifts/\(giftId)/cancel")!
        var request = try await makeRequest(url: url, method: "POST")
        request.httpBody = "{}".data(using: .utf8)

        let (data, _) = try await executeWithAuthRetry(request: request)
        do {
            return try Self.jsonDecoder.decode(CancelGiftResponse.self, from: data)
        } catch {
            let responseText = String(data: data, encoding: .utf8) ?? "No response"
            throw APIClientError.decodingError("CancelGiftResponse: \(error.localizedDescription). Response: \(Self.sanitizeForLogging(responseText))")
        }
    }
}
