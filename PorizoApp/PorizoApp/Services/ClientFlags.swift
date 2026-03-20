import Foundation

struct ClientFlags: Codable, Sendable {
    let showDesignScreens: Bool?
    let myVoiceEnabled: Bool?
    let giftSchedulingEnabled: Bool?
    let giftPrepayEnforced: Bool?

    enum CodingKeys: String, CodingKey {
        case showDesignScreens = "show_design_screens"
        case myVoiceEnabled = "my_voice_enabled"
        case giftSchedulingEnabled = "gift_scheduling_enabled"
        case giftPrepayEnforced = "gift_prepay_enforced"
    }
}
