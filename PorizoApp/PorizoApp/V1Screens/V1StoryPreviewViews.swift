//
//  V1StoryPreviewViews.swift
//  PorizoApp
//
//  Preview-only wrappers for v1.pen story conversation screens.
//

import SwiftUI

struct V1StoryChatPreviewView: View {
    let apiClient: APIClient
    @StateObject private var engine: V2StoryEngine

    init(apiClient: APIClient) {
        self.apiClient = apiClient
        _engine = StateObject(wrappedValue: V2StoryEngine(apiClient: apiClient, recipientName: "Chioma", occasion: "birthday"))
    }

    var body: some View {
        AdaptiveConversationView(engine: engine)
            .onAppear {
                if engine.session.messages.isEmpty {
                    seedMockConversation()
                }
            }
    }

    private func seedMockConversation() {
        let storyId = "story_mock_chat"
        engine.session.storyId = storyId
        engine.session.currentTurn = 2
        engine.session.messages = [
            V2Message(role: .ai, content: "Tell me about the moment you found out it was twins.", action: .ask),
            V2Message(role: .user, content: "We thought we lost the pregnancy, then the scan showed two heartbeats."),
            V2Message(role: .ai, content: "What emotions did you feel in that moment?", action: .ask)
        ]

        let response = V2EngineResponse(
            sessionId: storyId,
            action: .ask,
            question: "What emotions did you feel in that moment?",
            narrative: "A tender story of fear turning to joy when two heartbeats appeared on the scan.",
            completionScore: 40,
            beats: V2Beat.defaultBeats(turnCount: 2, completionScore: 40),
            userModel: .initial,
            turnCount: 2
        )
        engine.session.currentResponse = response
        engine.session.storySummary = response.narrative
    }
}

struct V1StoryCompletePreviewView: View {
    let apiClient: APIClient
    @StateObject private var engine: V2StoryEngine

    init(apiClient: APIClient) {
        self.apiClient = apiClient
        _engine = StateObject(wrappedValue: V2StoryEngine(apiClient: apiClient, recipientName: "Chioma", occasion: "birthday"))
    }

    var body: some View {
        StoryConfirmationView(
            engine: engine,
            creationNoun: "song",
            onContinue: {}
        )
        .onAppear {
            if engine.session.messages.isEmpty {
                seedMockCompletion()
            }
        }
    }

    private func seedMockCompletion() {
        let storyId = "story_mock_complete"
        let narrative = """
        This celebration is for Chioma and the miracle of discovering twins after weeks of fear. \
        The scan revealed two heartbeats and turned dread into joy, shaping a story of courage and gratitude.
        """

        engine.session.storyId = storyId
        engine.session.currentTurn = 3
        engine.session.messages = [
            V2Message(role: .user, content: "We thought we lost the pregnancy but the scan showed two heartbeats."),
            V2Message(role: .ai, content: "How did you share the news with family?", action: .ask),
            V2Message(role: .user, content: "We waited until it felt safe, then told them in person."),
            V2Message(role: .ai, content: "Your story is ready!", action: .stop)
        ]

        let response = V2EngineResponse(
            sessionId: storyId,
            action: .stop,
            confirmation: "Story complete",
            narrative: narrative,
            completionScore: 100,
            beats: V2Beat.defaultBeats(turnCount: 3, completionScore: 100),
            userModel: .initial,
            turnCount: 3
        )
        engine.session.currentResponse = response
        engine.session.storySummary = narrative
        engine.session.isComplete = true
    }
}

#Preview {
    V1StoryChatPreviewView(apiClient: APIClient(baseURL: AppConfig.apiBaseURL))
}
