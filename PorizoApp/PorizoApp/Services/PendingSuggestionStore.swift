import Foundation

struct PendingSuggestionContext {
    let suggestion: OnboardingSuggestion
    let recipientName: String
    let occasion: String?
    let emotionalSeed: String?
    let relationshipType: String?
    let createTypeRaw: String?
}

enum PendingSuggestionStore {
    static let suggestionKey = "pendingSuggestion"
    static let recipientKey = "pendingRecipientName"
    static let occasionKey = "pendingOccasion"
    static let createTypeKey = "pendingCreateType"
    static let emotionalSeedKey = "pendingEmotionalSeed"
    static let relationshipTypeKey = "pendingRelationshipType"
    static let autostartKey = "pendingCreateAutostart"
    static let showCountKey = "pendingSuggestionShowCount"
    static let setAtKey = "pendingSuggestionSetAt"

    private static let maxShows = 5
    private static let expirySeconds: TimeInterval = 14 * 86_400

    static func store(
        suggestion: OnboardingSuggestion,
        recipientName: String,
        occasion: String?,
        emotionalSeed: String?,
        relationshipType: String?,
        createTypeRaw: String?,
        defaults: UserDefaults = .standard,
        now: Date = Date()
    ) {
        guard let data = try? JSONEncoder().encode(suggestion),
              let json = String(data: data, encoding: .utf8) else {
            return
        }

        defaults.set(json, forKey: suggestionKey)
        defaults.set(recipientName, forKey: recipientKey)
        defaults.set(occasion ?? "", forKey: occasionKey)
        defaults.set(emotionalSeed ?? "", forKey: emotionalSeedKey)
        defaults.set(relationshipType ?? "", forKey: relationshipTypeKey)
        defaults.set(createTypeRaw ?? "", forKey: createTypeKey)
        defaults.set(0, forKey: showCountKey)
        defaults.set(now.timeIntervalSince1970, forKey: setAtKey)
    }

    static func loadIfActive(
        defaults: UserDefaults = .standard,
        tracks: [Track] = [],
        now: Date = Date()
    ) -> PendingSuggestionContext? {
        let raw = defaults.string(forKey: suggestionKey) ?? ""
        guard !raw.isEmpty,
              let data = raw.data(using: .utf8),
              let suggestion = try? JSONDecoder().decode(OnboardingSuggestion.self, from: data)
        else {
            return nil
        }

        let showCount = defaults.integer(forKey: showCountKey)
        if showCount >= maxShows {
            return nil
        }

        let setAt = defaults.double(forKey: setAtKey)
        if setAt > 0 {
            if now.timeIntervalSince1970 - setAt > expirySeconds {
                return nil
            }
        } else {
            defaults.set(now.timeIntervalSince1970, forKey: setAtKey)
        }

        let recipientName = defaults.string(forKey: recipientKey)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !recipientName.isEmpty else {
            return nil
        }

        let normalizedRecipient = recipientName.lowercased()
        let alreadyCreated = tracks.contains { track in
            !track.isReceived &&
            track.recipientName?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == normalizedRecipient
        }
        if alreadyCreated {
            return nil
        }

        let occasion = defaults.string(forKey: occasionKey)?.nilIfEmpty
        let emotionalSeed = defaults.string(forKey: emotionalSeedKey)?.nilIfEmpty
        let relationshipType = defaults.string(forKey: relationshipTypeKey)?.nilIfEmpty
        let createTypeRaw = defaults.string(forKey: createTypeKey)?.nilIfEmpty

        return PendingSuggestionContext(
            suggestion: suggestion,
            recipientName: recipientName,
            occasion: occasion,
            emotionalSeed: emotionalSeed,
            relationshipType: relationshipType,
            createTypeRaw: createTypeRaw
        )
    }

    static func markShown(defaults: UserDefaults = .standard) {
        let count = defaults.integer(forKey: showCountKey)
        defaults.set(count + 1, forKey: showCountKey)
    }

    static func clear(defaults: UserDefaults = .standard) {
        [
            suggestionKey,
            recipientKey,
            occasionKey,
            createTypeKey,
            emotionalSeedKey,
            relationshipTypeKey,
            autostartKey,
            showCountKey,
            setAtKey,
        ].forEach { defaults.removeObject(forKey: $0) }
    }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
