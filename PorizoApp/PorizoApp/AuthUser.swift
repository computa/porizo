import Foundation

struct AuthUser: Codable {
    let id: String
    let email: String?
    let displayName: String?
    let avatarUrl: String?
    let emailVerified: Bool
    let providers: [String]
    let createdAt: String
    let phoneNumber: String?
    let username: String?
    let needsProfileCompletion: Bool

    enum CodingKeys: String, CodingKey {
        case id = "user_id"
        case email
        case displayName = "display_name"
        case avatarUrl = "avatar_url"
        case emailVerified = "email_verified"
        case providers
        case createdAt = "created_at"
        case phoneNumber = "phone_number"
        case username
        case needsProfileCompletion = "needs_profile_completion"
    }

    // Backward compat: defaults for old server responses missing new fields
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        email = try container.decodeIfPresent(String.self, forKey: .email)
        displayName = try container.decodeIfPresent(String.self, forKey: .displayName)
        avatarUrl = try container.decodeIfPresent(String.self, forKey: .avatarUrl)
        emailVerified = try container.decodeIfPresent(Bool.self, forKey: .emailVerified) ?? false
        providers = try container.decodeIfPresent([String].self, forKey: .providers) ?? []
        createdAt = try container.decodeIfPresent(String.self, forKey: .createdAt) ?? ""
        phoneNumber = try container.decodeIfPresent(String.self, forKey: .phoneNumber)
        username = try container.decodeIfPresent(String.self, forKey: .username)
        needsProfileCompletion = try container.decodeIfPresent(Bool.self, forKey: .needsProfileCompletion) ?? false
    }
}
