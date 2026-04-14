import XCTest
@testable import PorizoApp

final class LaunchFlashContractTests: XCTestCase {

    private var defaults: UserDefaults!
    private var suiteName: String!

    override func setUp() {
        super.setUp()
        suiteName = "LaunchFlashContractTests.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() {
        if let suiteName {
            defaults?.removePersistentDomain(forName: suiteName)
        }
        defaults = nil
        suiteName = nil
        super.tearDown()
    }

    func testLaunchFlashGate_blocksLoggedOutUsersBeforeAuth() {
        let shouldAttempt = LaunchFlashGate.shouldAttemptFlash(
            hasPendingNavigationIntent: false,
            isAuthenticated: false,
            skipAuth: false,
            mode: .all,
            failureCount: 0
        )

        XCTAssertFalse(shouldAttempt)
    }

    func testLaunchFlashGate_blocksWhenPendingNavigationExists() {
        let shouldAttempt = LaunchFlashGate.shouldAttemptFlash(
            hasPendingNavigationIntent: true,
            isAuthenticated: true,
            skipAuth: false,
            mode: .all,
            failureCount: 0
        )

        XCTAssertFalse(shouldAttempt)
    }

    func testPendingSuggestionStore_roundTripsFreshSuggestionAndResetsCounters() {
        defaults.set(4, forKey: PendingSuggestionStore.showCountKey)
        defaults.set(1, forKey: PendingSuggestionStore.setAtKey)

        let now = Date(timeIntervalSince1970: 2_000_000)
        PendingSuggestionStore.store(
            suggestion: makeSuggestion(title: "A Song for Dad"),
            recipientName: "Tom",
            occasion: "birthday",
            emotionalSeed: "childhood_memory",
            relationshipType: "dad",
            createTypeRaw: CreateFlowKind.song.rawValue,
            defaults: defaults,
            now: now
        )

        let context = PendingSuggestionStore.loadIfActive(defaults: defaults, now: now)
        XCTAssertEqual(context?.suggestion.title, "A Song for Dad")
        XCTAssertEqual(context?.recipientName, "Tom")
        XCTAssertEqual(context?.occasion, "birthday")
        XCTAssertEqual(context?.emotionalSeed, "childhood_memory")
        XCTAssertEqual(context?.relationshipType, "dad")
        XCTAssertEqual(defaults.integer(forKey: PendingSuggestionStore.showCountKey), 0)
        XCTAssertEqual(defaults.double(forKey: PendingSuggestionStore.setAtKey), now.timeIntervalSince1970, accuracy: 0.001)
    }

    func testPendingSuggestionStore_expiresAfterFourteenDays() {
        let setAt = Date(timeIntervalSince1970: 1_000)
        PendingSuggestionStore.store(
            suggestion: makeSuggestion(),
            recipientName: "Tom",
            occasion: nil,
            emotionalSeed: "unsaid_words",
            relationshipType: "dad",
            createTypeRaw: CreateFlowKind.song.rawValue,
            defaults: defaults,
            now: setAt
        )

        let expired = PendingSuggestionStore.loadIfActive(
            defaults: defaults,
            now: setAt.addingTimeInterval((14 * 86_400) + 1)
        )

        XCTAssertNil(expired)
    }

    func testPendingSuggestionStore_hidesSuggestionAfterFiveShows() {
        PendingSuggestionStore.store(
            suggestion: makeSuggestion(),
            recipientName: "Tom",
            occasion: nil,
            emotionalSeed: "unsaid_words",
            relationshipType: "dad",
            createTypeRaw: CreateFlowKind.song.rawValue,
            defaults: defaults,
            now: Date()
        )

        (0..<5).forEach { _ in PendingSuggestionStore.markShown(defaults: defaults) }

        XCTAssertNil(PendingSuggestionStore.loadIfActive(defaults: defaults))
    }

    func testPendingSuggestionStore_hidesSuggestionWhenMatchingCreatedTrackExists() {
        PendingSuggestionStore.store(
            suggestion: makeSuggestion(),
            recipientName: "Tom",
            occasion: nil,
            emotionalSeed: "unsaid_words",
            relationshipType: "dad",
            createTypeRaw: CreateFlowKind.song.rawValue,
            defaults: defaults,
            now: Date()
        )

        let createdTrack = makeTrack(recipientName: "Tom", libraryOrigin: "created")

        XCTAssertNil(PendingSuggestionStore.loadIfActive(defaults: defaults, tracks: [createdTrack]))
    }

    func testLaunchFlashResolver_usesCachedPlayableAudioURLForTrackContent() {
        let track = makeTrack(recipientName: "Tom", libraryOrigin: "created")
        let resolver = LaunchFlashResolver(
            source: FakeLaunchFlashContentSource(
                tracks: [track],
                playableAudioURLs: [track.id: URL(string: "https://cdn.example.com/audio/track_1.m4a")!]
            ),
            onboardingConfig: nil,
            defaults: defaults
        )

        let content = resolver.resolve(mode: .all)

        XCTAssertEqual(content?.trackId, track.id)
        XCTAssertEqual(content?.audioURL?.absoluteString, "https://cdn.example.com/audio/track_1.m4a")
    }

    func testLaunchFlashResolver_usesDedicatedLaunchFlashDemoAudioWhenConfigured() {
        let resolver = LaunchFlashResolver(
            source: FakeLaunchFlashContentSource(
                tracks: [],
                playableAudioURLs: [:]
            ),
            onboardingConfig: OnboardingConfig(
                sampleAudioUrl: "https://cdn.example.com/audio/onboarding.mp3",
                sampleLabel: "Onboarding sample",
                splashDemoRecipient: "For Mom",
                splashLyricsPreview: "Onboarding lyric",
                launchFlashAudioUrl: "https://cdn.example.com/audio/launch-flash.mp3",
                launchFlashTitle: "The Drive Home",
                launchFlashRecipient: "For Dad",
                launchFlashLyricsPreview: "Launch flash lyric",
                questionGraphVersion: nil,
                questionGraphUrl: nil
            ),
            defaults: defaults
        )

        let content = resolver.resolve(mode: .all)

        XCTAssertEqual(content?.source, .demo)
        XCTAssertEqual(content?.audioURL?.absoluteString, "https://cdn.example.com/audio/launch-flash.mp3")
        XCTAssertEqual(content?.title, "The Drive Home")
        XCTAssertEqual(content?.recipientName, "For Dad")
        XCTAssertEqual(content?.lyricPreview, "Launch flash lyric")
    }

    private func makeSuggestion(title: String = "A Song for Tom") -> OnboardingSuggestion {
        OnboardingSuggestion(
            title: title,
            emotionalAngle: "A song about everything he never says out loud",
            previewLine: "Before time takes this away, let me say it now...",
            source: "template"
        )
    }

    private func makeTrack(recipientName: String, libraryOrigin: String?) -> Track {
        Track(
            id: "track_1",
            userId: "user_1",
            title: "Song",
            occasion: "birthday",
            recipientName: recipientName,
            style: "pop",
            durationTarget: 60,
            voiceMode: "ai_voice",
            message: nil,
            status: "ready",
            latestVersion: 1,
            shareTokenId: nil,
            createdAt: "2026-04-14T00:00:00Z",
            updatedAt: "2026-04-14T00:00:00Z",
            libraryOrigin: libraryOrigin,
            libraryAddedAt: nil,
            canEdit: true,
            canShare: true,
            canDelete: true,
            coverImageUrl: nil,
            coverImageSmallUrl: nil,
            coverImageLargeUrl: nil,
            shareUrl: nil,
            claimPin: nil,
            shareExpiresAt: nil
        )
    }
}

private struct FakeLaunchFlashContentSource: LaunchFlashContentSource {
    let tracks: [Track]
    let playableAudioURLs: [String: URL]

    func loadTracks() -> [Track] {
        tracks
    }

    func loadPlayableAudioURL(for trackId: String) -> URL? {
        playableAudioURLs[trackId]
    }
}
