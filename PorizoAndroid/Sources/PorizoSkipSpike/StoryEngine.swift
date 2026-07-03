import Foundation

/// A single chat bubble in the create conversation.
struct StoryMessage: Identifiable, Equatable, Sendable {
    enum Role: Sendable { case assistant, user }
    let id: String
    let role: Role
    let text: String
}

/// Pure story-conversation logic (U8), extracted from the view/model so the
/// message-list construction and finish-gating can be tested on the host.
enum StoryEngine {

    /// Deterministic id for a bubble at a given index (Skip has no UUID at call
    /// sites here; index-based ids are stable within one conversation).
    static func messageId(_ index: Int) -> String { "msg-\(index)" }

    /// Append the assistant's question (if any) to the transcript.
    static func appendingAssistant(_ question: String?, to messages: [StoryMessage]) -> [StoryMessage] {
        guard let q = question?.trimmingCharacters(in: .whitespacesAndNewlines), !q.isEmpty else {
            return messages
        }
        return messages + [StoryMessage(id: messageId(messages.count), role: .assistant, text: q)]
    }

    /// Append the user's answer to the transcript.
    static func appendingUser(_ answer: String, to messages: [StoryMessage]) -> [StoryMessage] {
        let trimmed = answer.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return messages }
        return messages + [StoryMessage(id: messageId(messages.count), role: .user, text: trimmed)]
    }

    /// Whether the "Create" action should be offered: the server said we can
    /// finish (or the story is complete), OR the user has answered enough turns.
    static func canOfferFinish(response: PorizoContinueStoryResponse, userTurns: Int) -> Bool {
        if response.canFinish == true || response.isComplete == true { return true }
        // Floor so the user is never stuck if the server doesn't signal — a
        // couple of substantive answers is enough to attempt a draft.
        return userTurns >= 3
    }

    /// Whether an answer is substantive enough to send.
    static func isSendable(_ answer: String) -> Bool {
        !answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}
