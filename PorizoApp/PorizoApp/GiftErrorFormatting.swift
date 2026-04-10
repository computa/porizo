//
//  GiftErrorFormatting.swift
//  PorizoApp
//
//  Shared user-facing error normalization for gift flows.
//

import Foundation

func normalizeGiftErrorMessage(_ message: String, code: String?) -> String {
    let normalized = message.trimmingCharacters(in: .whitespacesAndNewlines)
    let upperCode = code?.uppercased() ?? ""

    if upperCode == "INSUFFICIENT_GIFT_TOKENS" || normalized.localizedCaseInsensitiveContains("gift token") {
        return "Unlock this gift to keep going."
    }
    if upperCode == "RESERVATION_EXPIRED" || normalized.localizedCaseInsensitiveContains("reservation expired") {
        return "This gift draft expired. Start a fresh gift and we’ll help you finish it."
    }
    if upperCode == "GIFT_ALREADY_PARTIALLY_DISPATCHED" {
        return "This gift is already on its way, so it can’t be changed now."
    }
    if upperCode == "GIFT_NOT_EDITABLE" || upperCode == "GIFT_NOT_CANCELLABLE" {
        return "This gift can’t be changed anymore."
    }
    if upperCode == "GIFT_SHARE_URL_NOT_PUBLIC" || upperCode == "INVALID_GIFT_SHARE_URL" {
        return "This gift link isn’t ready for delivery yet. Try again on a public Porizo server."
    }
    if normalized.localizedCaseInsensitiveContains("reserve a new token") {
        return "Start a fresh gift and we’ll help you finish it."
    }
    if normalized.localizedCaseInsensitiveContains("reserve a gift token first") {
        return "Start a fresh gift first."
    }
    if normalized.hasPrefix("{"),
       let data = normalized.data(using: .utf8),
       let apiPayload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
       let nestedMessage = apiPayload["message"] as? String {
        return normalizeGiftErrorMessage(nestedMessage, code: apiPayload["error"] as? String)
    }
    return normalized
}

func giftUserFacingMessage(for error: Error) -> String {
    if let apiError = error as? APIClientError {
        switch apiError {
        case .serverError(let message, let code, _):
            return normalizeGiftErrorMessage(message, code: code)
        case .httpError(_, let body):
            return normalizeGiftErrorMessage(body, code: nil)
        default:
            return apiError.localizedDescription
        }
    }
    return error.localizedDescription
}
