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
    let render: AndroidRenderModel

    // Share state (U10).
    private(set) var shareLink: String?
    private(set) var sharePin: String?
    private(set) var isCreatingShare = false
    private(set) var shareError: String?

    // Poem branch (U13). Poems generate synchronously → straight to reveal.
    private(set) var createdPoemId: String?
    private(set) var poemVerses: [String] = []

    private let apiClient: AndroidAPIClient
    private let directSend: AndroidDirectSend
    private let sharer: AndroidShareProvider

    init(
        apiClient: AndroidAPIClient = AndroidAPIClient(),
        directSend: AndroidDirectSend = AndroidDirectSend(),
        sharer: AndroidShareProvider = AndroidShareProvider(),
        render: AndroidRenderModel? = nil
    ) {
        self.apiClient = apiClient
        self.directSend = directSend
        self.sharer = sharer
        self.render = render ?? AndroidRenderModel(apiClient: apiClient)
    }

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
                if contentType == .poem {
                    // Poem generation is synchronous — straight to the reveal.
                    let response = try await apiClient.storyToPoem(storyId: storyId)
                    poemVerses = PoemClaimLogic.verses(from: response.poem)
                    createdPoemId = response.poem.id
                    moment = .reveal
                    return
                }
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

    // MARK: - Reveal + share (U10)

    /// The rendered result to reveal (title, artwork, playable URL).
    var revealResult: AndroidRenderResult? { render.result }

    /// Build the playable track for the reveal's Play button (U3 player).
    var revealPlayable: AndroidPlayableTrack? {
        guard let result = revealResult else { return nil }
        return AndroidPlayableTrack(
            id: result.trackId,
            title: result.title,
            recipientName: result.recipientName,
            artworkURL: result.artworkURL,
            streamURL: result.audioURL,
            isOwnedContent: true
        )
    }

    /// One-tap "Send to {name}": mint a link, then SMS (if a phone was captured
    /// in U7) or the system share sheet. Routes to the poem-share endpoint for
    /// poems (which are always PIN-protected server-side).
    func sendToRecipient() async {
        do {
            let url: String
            if let poemId = createdPoemId {
                url = try await apiClient.createPoemShare(poemId: poemId).shareUrl
            } else if let trackId = createdTrackId {
                url = try await apiClient.createShare(trackId: trackId, versionNum: createdVersionNum, requirePin: false).shareUrl
            } else {
                return
            }
            directSend.send(
                recipientName: recipientName,
                phone: recipientPhone,
                link: url,
                contentType: contentType
            )
        } catch {
            shareError = String(describing: error)
        }
    }

    /// Advance to the share postcard and mint a PIN-protected link.
    func goToShare() {
        moment = .share
        Task { await ensureShareLink() }
    }

    /// Create (idempotently) the share link for the postcard. Poems use the
    /// poem-share endpoint; songs the track-share endpoint (PIN-protected).
    func ensureShareLink() async {
        guard shareLink == nil, !isCreatingShare else { return }
        isCreatingShare = true
        shareError = nil
        defer { isCreatingShare = false }
        do {
            let share: PorizoCreateShareResponse
            if let poemId = createdPoemId {
                share = try await apiClient.createPoemShare(poemId: poemId)
            } else if let trackId = createdTrackId {
                share = try await apiClient.createShare(trackId: trackId, versionNum: createdVersionNum, requirePin: true)
            } else {
                return
            }
            shareLink = share.shareUrl
            sharePin = share.claimPin
        } catch {
            shareError = String(describing: error)
        }
    }

    /// Copy the share link to the clipboard (postcard "Copy link" target).
    func copyShareLink() {
        guard let link = shareLink else { return }
        sharer.copyToClipboard(link)
    }

    /// Open the system share sheet with the postcard link.
    func shareViaSheet() {
        guard let link = shareLink else { return }
        let body = ShareLogic.messageBody(recipientName: recipientName, link: link, contentType: contentType)
        sharer.shareText(body)
    }

    /// Step back from details to the name step.
    func backToName() {
        moment = .entry(.name)
    }
}
