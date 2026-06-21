//
//  RecipientMessage.swift
//  PorizoApp
//
//  Builds the recipient-facing message body and WhatsApp deep link for the
//  one-tap "Send to [recipient]" flow. PIN-free by design: the share link is
//  minted pinless so the recipient can open it directly.
//

import Foundation

enum RecipientMessage {
    static func body(recipientName: String, link: String) -> String {
        "I made you a song 🎵 \(recipientName) — open it here: \(link)"
    }

    /// Web `wa.me/<E164>` deep link, pre-addressed to a specific recipient.
    /// Distinct from `SongSharePayloadBuilder.nativeURL(for: .whatsapp, body:)`,
    /// which builds the un-addressed `whatsapp://send?text=` scheme for the
    /// sender-driven share sheet. This one targets a known number directly.
    static func whatsAppURL(phoneE164: String, body: String) -> URL? {
        guard phoneE164.hasPrefix("+") else { return nil }
        let digits = String(phoneE164.dropFirst())
        var c = URLComponents(string: "https://wa.me/\(digits)")
        c?.queryItems = [URLQueryItem(name: "text", value: body)]
        return c?.url
    }
}
