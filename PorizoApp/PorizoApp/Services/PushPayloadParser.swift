//
//  PushPayloadParser.swift
//  PorizoApp
//
//  Parses incoming push notification payloads.
//  Handles various notification types from the Porizo server.
//

import Foundation

/// Parsed render completion push notification.
struct RenderCompletePayload {
    let trackId: String
    let trackTitle: String
}

/// Parsed recipient-played push notification — the recipient finished
/// listening to a shared song.
struct RecipientPlayedPayload {
    let trackId: String
    let trackTitle: String
    let recipientName: String?
}

/// Parses push notification payloads from the Porizo server.
///
/// Expected payload format for render_complete:
/// ```json
/// {
///   "aps": { "content-available": 1 },
///   "type": "render_complete",
///   "trackId": "track-123",
///   "trackTitle": "Happy Birthday Song"
/// }
/// ```
///
/// Expected payload format for recipient_played:
/// ```json
/// {
///   "aps": { "alert": { "title": "...", "body": "..." }, "sound": "default" },
///   "type": "recipient_played",
///   "trackId": "track-123",
///   "trackTitle": "Happy Birthday Sarah",
///   "recipientName": "Sarah"
/// }
/// ```
enum PushPayloadParser {

    // MARK: - Notification Types

    private static let typeRenderComplete = "render_complete"
    private static let typeRecipientPlayed = "recipient_played"

    // MARK: - Parsing

    /// Parses a render completion notification from the push payload.
    ///
    /// - Parameter userInfo: The push notification payload dictionary.
    /// - Returns: The parsed payload, or nil if the notification is not a render completion
    ///   or is missing required fields.
    static func parseRenderComplete(from userInfo: [AnyHashable: Any]) -> RenderCompletePayload? {
        // Verify this is a render_complete notification
        guard let type = userInfo["type"] as? String,
              type == typeRenderComplete else {
            return nil
        }

        // Extract required fields
        guard let trackId = userInfo["trackId"] as? String,
              let trackTitle = userInfo["trackTitle"] as? String else {
            print("[Push] Render complete notification missing required fields: \(userInfo)")
            return nil
        }

        return RenderCompletePayload(trackId: trackId, trackTitle: trackTitle)
    }

    /// Parses a recipient-played notification from the push payload.
    ///
    /// Recipient name is optional — for older shares or anonymous flows the
    /// backend may omit it; the UI must fall back gracefully.
    static func parseRecipientPlayed(from userInfo: [AnyHashable: Any]) -> RecipientPlayedPayload? {
        guard let type = userInfo["type"] as? String,
              type == typeRecipientPlayed else {
            return nil
        }

        guard let trackId = userInfo["trackId"] as? String,
              let trackTitle = userInfo["trackTitle"] as? String else {
            print("[Push] recipient_played notification missing required fields: \(userInfo)")
            return nil
        }

        let recipientName = userInfo["recipientName"] as? String
        return RecipientPlayedPayload(
            trackId: trackId,
            trackTitle: trackTitle,
            recipientName: recipientName
        )
    }
}
