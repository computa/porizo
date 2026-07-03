import Foundation
import Observation
import SkipFuse

/// Song vs poem — chosen at the details step, drives which pipeline runs.
enum CreateContentType: String, CaseIterable, Identifiable, Sendable {
    case song
    case poem

    var id: String { rawValue }
    var label: String { self == .song ? "Song" : "Poem" }
}

/// The create wizard's high-level moment (U7 scaffold; U8-U10 fill the later
/// cases). Mirrors iOS WarmCanvasFlowView's moment machine.
enum CreateMoment: Equatable {
    case entry(EntryStep)
    case conversing   // U8
    case lyrics       // U9
    case wait         // U9
    case reveal       // U10
    case share        // U10

    enum EntryStep: Equatable {
        case name       // "Who's this song for?" / "What's their name?"
        case details    // occasion + song/poem
    }
}

/// Shared create-flow state (U7). @Observable + @MainActor.
@MainActor
@Observable
final class AndroidCreateFlowModel {
    private(set) var moment: CreateMoment = .entry(.name)

    /// Recipient name (typed or picked from contacts).
    var recipientName = ""
    /// Recipient phone when captured from contacts (enables one-tap send later).
    var recipientPhone: String?
    var occasion: Occasion = .birthday
    var contentType: CreateContentType = .song

    // Conversation state (U8).
    private(set) var messages: [StoryMessage] = []
    private(set) var storyId: String?
    private(set) var sessionVersion: Int?
    private(set) var canFinish = false
    private(set) var userTurns = 0
    private(set) var isSending = false
    private(set) var conversationError: String?

    /// The track created once the story is confirmed + turned into a track (U9 entry).
    private(set) var createdTrackId: String?
    /// The version to render (from story-to-track; defaults to 1).
    private(set) var createdVersionNum = 1
    /// The reviewed lyrics text shown on the lyrics-review step (U9).
    private(set) var lyricsText: String?
    /// The chosen AI voice for the render (My Voice deferred per KTD7).
    var voiceSource: VoiceSource = .aiGuide

    /// Owns the render lifecycle once lyrics are approved (U9).
    let render = AndroidRenderModel()

    private let apiClient = AndroidAPIClient()

    /// Whether the details step can advance (needs a recipient name).
    var canStartConversation: Bool {
        !recipientName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Configure the flow before presenting (from an occasion chip / gift, etc.).
    func reset(occasion: Occasion? = nil, type: CreateContentType? = nil) {
        moment = .entry(.name)
        recipientName = ""
        recipientPhone = nil
        if let occasion { self.occasion = occasion }
        if let type { contentType = type }
    }

    /// Advance from the name step to the details step. Requires a name.
    func confirmName() {
        guard canStartConversation else { return }
        moment = .entry(.details)
    }

    /// Adopt a contact's name + phone and advance to details.
    func adoptContact(name: String, phone: String?) {
        recipientName = name
        recipientPhone = phone
        if canStartConversation { moment = .entry(.details) }
    }

    /// Advance from details into the AI conversation and open the story session.
    func startConversation() {
        guard canStartConversation else { return }
        moment = .conversing
        Task { await beginStory() }
    }

    /// Open the story session and seed the first question.
    private func beginStory() async {
        isSending = true
        conversationError = nil
        defer { isSending = false }
        do {
            let prompt = "A \(contentType.label.lowercased()) for \(recipientName) for \(occasion.label)."
            let response = try await apiClient.startStory(
                initialPrompt: prompt,
                occasion: occasion.rawValue,
                recipientName: recipientName
            )
            storyId = response.storyId
            sessionVersion = response.sessionVersion
            messages = StoryEngine.appendingAssistant(response.question, to: messages)
        } catch {
            conversationError = String(describing: error)
        }
    }

    /// Send the user's answer and append the next assistant question.
    func sendAnswer(_ answer: String) async {
        guard let storyId, StoryEngine.isSendable(answer), !isSending else { return }
        isSending = true
        conversationError = nil
        defer { isSending = false }
        messages = StoryEngine.appendingUser(answer, to: messages)
        userTurns += 1
        do {
            let response = try await apiClient.continueStory(
                storyId: storyId, answer: answer, expectedSessionVersion: sessionVersion
            )
            sessionVersion = response.sessionVersion ?? sessionVersion
            messages = StoryEngine.appendingAssistant(response.question, to: messages)
            canFinish = StoryEngine.canOfferFinish(response: response, userTurns: userTurns)
        } catch {
            conversationError = String(describing: error)
        }
    }

    /// Confirm the story, generate lyrics, and create the track. On a 422
    /// "needs input", surface the guidance as another assistant bubble instead
    /// of erroring. Advances to `.lyrics` (U9) on success.
    func finish() async {
        guard let storyId, !isSending else { return }
        isSending = true
        conversationError = nil
        defer { isSending = false }
        do {
            switch try await apiClient.confirmStory(storyId: storyId) {
            case .needsInput(let guidance):
                let prompt = guidance.question ?? guidance.message ?? "Tell me a little more."
                messages = StoryEngine.appendingAssistant(prompt, to: messages)
                canFinish = false
                return
            case .confirmed:
                let lyrics = try await apiClient.generateStoryLyrics(storyId: storyId)
                lyricsText = lyrics.lyrics
                let track = try await apiClient.storyToTrack(storyId: storyId, voiceMode: voiceSource.apiValue)
                createdTrackId = track.trackId
                createdVersionNum = track.versionNum ?? 1
                moment = .lyrics
            }
        } catch {
            conversationError = String(describing: error)
        }
    }

    /// Approve the reviewed lyrics and start the preview render (U9). Advances
    /// to the `.wait` moment; the wait view observes `render.phase`.
    func approveLyricsAndRender() {
        guard let trackId = createdTrackId else { return }
        moment = .wait
        render.approveAndRender(trackId: trackId, versionNum: createdVersionNum)
    }

    /// Retry a failed render from the wait step.
    func retryRender() {
        guard let trackId = createdTrackId else { return }
        render.retry(trackId: trackId, versionNum: createdVersionNum)
    }

    /// Advance to the reveal once the render completes. Called by the wait view
    /// when it observes `render.phase == .completed`.
    func advanceToReveal() {
        guard render.phase == .completed else { return }
        moment = .reveal
    }

    /// After a policy-rejection failure, return to the lyrics step so the user
    /// can review/regenerate and re-approve. (Full lyric editing is a later unit;
    /// for now Approve re-runs the render.)
    func editLyricsAfterFailure() {
        render.cancel()
        moment = .lyrics
    }

    /// Step back from details to the name step.
    func backToName() {
        moment = .entry(.name)
    }
}
