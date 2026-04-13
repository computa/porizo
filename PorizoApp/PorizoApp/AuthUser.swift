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

    // Account management fields (from expanded /auth/me response)
    let authMethods: [AuthMethod]
    let contacts: [ContactInfo]
    let primaryEmail: String?
    let primaryPhone: String?
    let missingProfileRequirements: [String]

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
        case authMethods = "auth_methods"
        case contacts
        case primaryEmail = "primary_email"
        case primaryPhone = "primary_phone"
        case missingProfileRequirements = "missing_profile_requirements"
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
        authMethods = try container.decodeIfPresent([AuthMethod].self, forKey: .authMethods) ?? []
        contacts = try container.decodeIfPresent([ContactInfo].self, forKey: .contacts) ?? []
        primaryEmail = try container.decodeIfPresent(String.self, forKey: .primaryEmail)
        primaryPhone = try container.decodeIfPresent(String.self, forKey: .primaryPhone)
        missingProfileRequirements = try container.decodeIfPresent([String].self, forKey: .missingProfileRequirements) ?? []
    }

    // MARK: - Identity Predicates

    /// Whether this user has an Apple sign-in method linked.
    var hasAppleMethod: Bool { authMethods.contains(where: { $0.type == "apple" }) }

    /// Whether this user has a phone sign-in method linked.
    var hasPhoneMethod: Bool { authMethods.contains(where: { $0.type == "phone" }) }

    /// Whether this user has a verified non-relay email contact.
    var hasRealVerifiedEmail: Bool {
        contacts.contains(where: { $0.type == "email" && $0.verified && !$0.isRelay })
    }
}

// MARK: - Account Management Sub-Models

/// A sign-in method linked to the user's account
struct AuthMethod: Codable, Identifiable {
    let type: String
    let linkedAt: String?
    let lastUsedAt: String?
    let subjectMasked: String?

    var id: String { "\(type)-\(linkedAt ?? "unknown")" }

    enum CodingKeys: String, CodingKey {
        case type
        case linkedAt = "linked_at"
        case lastUsedAt = "last_used_at"
        case subjectMasked = "subject_masked"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        type = try container.decode(String.self, forKey: .type)
        linkedAt = try container.decodeIfPresent(String.self, forKey: .linkedAt)
        lastUsedAt = try container.decodeIfPresent(String.self, forKey: .lastUsedAt)
        subjectMasked = try container.decodeIfPresent(String.self, forKey: .subjectMasked)
    }
}

/// A contact method (email, phone) on the user's account
struct ContactInfo: Codable, Identifiable {
    let type: String
    let valueDisplay: String?
    let verified: Bool
    let isPrimary: Bool
    let isRelay: Bool

    var id: String { "\(type)-\(valueDisplay ?? "")" }

    enum CodingKeys: String, CodingKey {
        case type
        case valueDisplay = "value_display"
        case verified
        case isPrimary = "is_primary"
        case isRelay = "is_relay"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        type = try container.decode(String.self, forKey: .type)
        valueDisplay = try container.decodeIfPresent(String.self, forKey: .valueDisplay)
        verified = try container.decodeIfPresent(Bool.self, forKey: .verified) ?? false
        isPrimary = try container.decodeIfPresent(Bool.self, forKey: .isPrimary) ?? false
        isRelay = try container.decodeIfPresent(Bool.self, forKey: .isRelay) ?? false
    }
}
