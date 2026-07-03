import Foundation
import Observation
import SkipFuse

/// Persists the opaque `receiverHandoffId` across an install→login→claim gap so
/// a recipient who installs, then signs in, still lands back on their claim.
/// Mirrors iOS receiver-handoff persistence.
struct AndroidReceiverDraftStore: Sendable {
    private static let key = "porizo_android_receiver_handoff"

    func save(_ handoffId: String) {
        UserDefaults.standard.set(handoffId, forKey: Self.key)
    }
    func load() -> String? {
        let value = UserDefaults.standard.string(forKey: Self.key)
        return (value?.isEmpty ?? true) ? nil : value
    }
    func clear() {
        UserDefaults.standard.removeObject(forKey: Self.key)
    }
}

/// Drives the deep-link claim sheet (U12): resolve the share/handoff, present a
/// preview-before-claim, then claim — binding the device, with a single
/// device-token retry on 401. Pure decisions live in `ClaimLogic`.
@MainActor
@Observable
final class AndroidClaimModel {

    enum Phase: Equatable {
        case loading
        case preview(ClaimLogic.State)  // resolved; showing preview + claim CTA
        case claiming
        case claimed
        case failed(String)
        case unavailable
    }

    private(set) var phase: Phase = .loading
    /// Pre-claim preview stream URL (web/pre-signed), when offered.
    private(set) var previewURL: String?
    /// The recipient-facing title, if the server provides it.
    private(set) var title: String?
    private(set) var needsPin = false

    private let apiClient: AndroidAPIClient
    private let draftStore: AndroidReceiverDraftStore

    init(
        apiClient: AndroidAPIClient = AndroidAPIClient(),
        draftStore: AndroidReceiverDraftStore = AndroidReceiverDraftStore()
    ) {
        self.apiClient = apiClient
        self.draftStore = draftStore
    }

    // MARK: - Track share

    /// Resolve a track-share link and show its state.
    func loadShare(shareId: String) async {
        phase = .loading
        do {
            let info = try await apiClient.getShareInfo(shareId: shareId)
            apply(info)
        } catch {
            phase = .failed(String(describing: error))
        }
    }

    /// Claim a track share, binding this device. Single retry on a 401 device-token error.
    func claimShare(shareId: String, pin: String) async {
        phase = .claiming
        do {
            _ = try await apiClient.claimShare(shareId: shareId, pin: pin)
            phase = .claimed
        } catch {
            if ClaimLogic.shouldReregisterAndRetry(error: error) {
                await reregisterDevice()
                do {
                    _ = try await apiClient.claimShare(shareId: shareId, pin: pin)
                    phase = .claimed
                    return
                } catch {
                    phase = .failed(String(describing: error))
                    return
                }
            }
            phase = .failed(String(describing: error))
        }
    }

    // MARK: - Receiver handoff (opaque)

    /// Resolve an opaque receiver-handoff id. Persists it so an install→login gap
    /// can resume the claim after sign-in.
    func loadReceiverHandoff(handoffId: String) async {
        phase = .loading
        draftStore.save(handoffId)
        do {
            let handoff = try await apiClient.resolveReceiverHandoff(handoffId: handoffId)
            title = handoff.contentKind
            // Receiver handoffs resolve to a claimable token; PIN follows the
            // server's claim response. Present as claimable.
            needsPin = false
            phase = .preview(.claimable(needsPin: false))
            _ = handoff.receiverClaimToken  // used by claimReceiver below
        } catch {
            phase = .failed(String(describing: error))
        }
    }

    /// Claim via the opaque receiver token, with the same single 401 retry.
    func claimReceiver(claimToken: String, pin: String) async {
        phase = .claiming
        do {
            _ = try await apiClient.claimReceiverToken(claimToken: claimToken, pin: pin)
            draftStore.clear()
            phase = .claimed
        } catch {
            if ClaimLogic.shouldReregisterAndRetry(error: error) {
                await reregisterDevice()
                do {
                    _ = try await apiClient.claimReceiverToken(claimToken: claimToken, pin: pin)
                    draftStore.clear()
                    phase = .claimed
                    return
                } catch {
                    phase = .failed(String(describing: error))
                    return
                }
            }
            phase = .failed(String(describing: error))
        }
    }

    // MARK: - Poem share (U13)

    /// The revealed poem verses (poem-share reveal-before-claim).
    private(set) var poemVerses: [String] = []

    func loadPoemShare(shareId: String) async {
        phase = .loading
        do {
            let info = try await apiClient.getPoemShareInfo(shareId: shareId)
            poemVerses = PoemClaimLogic.verses(from: info)
            title = info.poem?.title
            let state = PoemClaimLogic.state(for: info)
            if case .claimable(let pin) = state { needsPin = pin }
            switch state {
            case .unavailable: phase = .unavailable
            case .claimed: phase = .claimed
            case .claimable: phase = .preview(state)
            }
        } catch {
            phase = .failed(String(describing: error))
        }
    }

    func claimPoem(shareId: String, pin: String) async {
        phase = .claiming
        do {
            _ = try await apiClient.claimPoemShare(shareId: shareId, pin: pin)
            phase = .claimed
        } catch {
            if ClaimLogic.shouldReregisterAndRetry(error: error) {
                await reregisterDevice()
                do {
                    _ = try await apiClient.claimPoemShare(shareId: shareId, pin: pin)
                    phase = .claimed
                    return
                } catch {
                    phase = .failed(String(describing: error))
                    return
                }
            }
            phase = .failed(String(describing: error))
        }
    }

    // MARK: - Helpers

    private func apply(_ info: PorizoShareInfoResponse) {
        previewURL = ClaimLogic.previewURL(from: info)
        title = info.track?.title ?? info.trackPreview?.title
        let state = ClaimLogic.state(for: info)
        if case .claimable(let pin) = state { needsPin = pin }
        switch state {
        case .unavailable: phase = .unavailable
        case .claimed: phase = .claimed
        case .claimable: phase = .preview(state)
        }
    }

    private func reregisterDevice() async {
        await apiClient.clearDeviceToken()
        _ = try? await apiClient.registerDevice()
    }
}
