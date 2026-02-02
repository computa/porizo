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
enum PushPayloadParser {

    // MARK: - Notification Types

    private static let typeRenderComplete = "render_complete"

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
}
