//
//  StoryConversationStore.swift
//  PorizoApp
//
//  Conversation and flow-facing state for the V2 story flow.
//

import Foundation

struct StoryConversationStore {
    var currentTurn: Int = 0
    var isComplete: Bool = false
    var isEditingFromReview: Bool = false
    var messages: [V2Message] = []
    var currentResponse: V2EngineResponse?
    var resumeNotice: String?

    mutating func reset() {
        self = StoryConversationStore()
    }

    mutating func restore(from session: V2Session) {
        currentTurn = session.currentTurn
        isComplete = session.isComplete
        isEditingFromReview = session.isEditingFromReview
        messages = session.messages
        currentResponse = session.currentResponse
        resumeNotice = session.resumeNotice
    }

    mutating func ensureInitialPromptMessage(_ initialPrompt: String?) {
        guard let rawPrompt = initialPrompt else { return }
        let prompt = rawPrompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty else { return }

        let normalizedPrompt = Self.normalizeMessage(prompt)
        let hasPrompt = messages.contains { message in
            guard message.role == .user else { return false }
            return Self.normalizeMessage(message.content) == normalizedPrompt
        }
        guard !hasPrompt else { return }
        messages.insert(V2Message(role: .user, content: prompt), at: 0)
    }

    static func buildResumeNotice(
        cachedNarrativeVersion: Int,
        serverNarrativeVersion: Int?,
        cachedUpdatedAt: String?,
        serverUpdatedAt: String?,
        hadLocalReviewDraft: Bool
    ) -> String? {
        let serverVersion = serverNarrativeVersion ?? cachedNarrativeVersion
        if serverVersion > cachedNarrativeVersion && hadLocalReviewDraft {
            return "Server draft advanced to v\(serverVersion). Your unsent review note was restored, but check the updated draft before applying it."
        }
        if serverVersion > cachedNarrativeVersion {
            return "Server draft updated to v\(serverVersion) while you were away."
        }
        if hadLocalReviewDraft && cachedUpdatedAt != nil && serverUpdatedAt != nil && cachedUpdatedAt != serverUpdatedAt {
            return "Your unsent review note was restored, but the server draft changed. Recheck it before applying."
        }
        return hadLocalReviewDraft ? "Your unsent review note was restored." : nil
    }

    private static func normalizeMessage(_ text: String) -> String {
        text
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
    }
}
