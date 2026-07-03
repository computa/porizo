import Foundation

/// Pure share/send decision logic (U10), ported from iOS RecipientMessage +
/// DirectSendModel. No UI, no Android intents — so the message copy, the
/// SMS-vs-sheet decision, and the smsto: URI are unit-tested on the host.
enum ShareLogic {

    /// Which channel a "Send to {name}" tap should use.
    enum SendChannel: Equatable {
        case sms(phone: String)  // a phone was captured in U7 — address it directly
        case shareSheet          // no phone — open the system chooser
    }

    /// Recipient-facing message body. PIN-free by design; links are LIFETIME, so
    /// this NEVER contains expiry urgency ("expires in N days") — see project
    /// memory [[project_share_links_are_lifetime]].
    static func messageBody(recipientName: String, link: String, contentType: CreateContentType) -> String {
        let name = recipientName.trimmingCharacters(in: .whitespacesAndNewlines)
        let noun = contentType == .poem ? "poem ✍️" : "song 🎵"
        let lead = name.isEmpty ? "I made you a \(noun)" : "I made you a \(noun) \(name)"
        return "\(lead) — open it here: \(link)"
    }

    /// SMS when a phone is on file, else the share sheet.
    static func sendChannel(phone: String?) -> SendChannel {
        if let phone, !phone.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return .sms(phone: phone)
        }
        return .shareSheet
    }

    /// `smsto:<phone>?body=<encoded>` — the Android SMS intent URI.
    static func smsURI(phone: String, body: String) -> String {
        let encoded = body.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? body
        return "smsto:\(phone)?body=\(encoded)"
    }
}
