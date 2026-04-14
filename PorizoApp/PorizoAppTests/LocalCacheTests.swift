//
//  LocalCacheTests.swift
//  PorizoAppTests
//
//  Tests for LocalCache save/load round-trip with Track and Poem models.
//

import XCTest
@testable import PorizoApp

final class LocalCacheTests: XCTestCase {

    // MARK: - Setup / Teardown

    override func setUp() {
        super.setUp()
        // Clear any leftover test data
        LocalCache.shared.invalidateTracks()
        LocalCache.shared.invalidatePoems()
        // Give the async invalidation a moment to complete
        Thread.sleep(forTimeInterval: 0.1)
    }

    override func tearDown() {
        // Clean up after tests
        LocalCache.shared.invalidateTracks()
        LocalCache.shared.invalidatePoems()
        Thread.sleep(forTimeInterval: 0.1)
        super.tearDown()
    }

    // MARK: - Tracks Round-Trip

    func testLoadSave_roundTrip_tracks() {
        // Verify cache starts empty
        XCTAssertNil(LocalCache.shared.loadTracks(),
                     "Cache should be empty after invalidation")

        // Create test tracks
        let tracks = [
            Track(
                id: "track_test_1",
                userId: "user_1",
                title: "Happy Birthday Song",
                occasion: "birthday",
                recipientName: "Chioma",
                style: "pop",
                durationTarget: 60,
                voiceMode: "ai",
                message: "Happy birthday!",
                status: "complete",
                latestVersion: 1,
                shareTokenId: nil,
                createdAt: "2026-03-26T00:00:00Z",
                updatedAt: "2026-03-26T00:00:00Z",
                coverImageUrl: nil,
                coverImageSmallUrl: nil,
                coverImageLargeUrl: nil
            ),
            Track(
                id: "track_test_2",
                userId: "user_1",
                title: "Anniversary Ballad",
                occasion: "anniversary",
                recipientName: "Emeka",
                style: "r&b",
                durationTarget: 90,
                voiceMode: "ai",
                message: "Happy anniversary",
                status: "rendering",
                latestVersion: 2,
                shareTokenId: "share_abc",
                createdAt: "2026-03-25T00:00:00Z",
                updatedAt: "2026-03-26T00:00:00Z",
                coverImageUrl: nil,
                coverImageSmallUrl: nil,
                coverImageLargeUrl: nil
            )
        ]

        // Save
        LocalCache.shared.saveTracks(tracks)

        // saveEnvelope is async via DispatchQueue — wait for it to flush
        let saveExpectation = expectation(description: "Cache write completes")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            saveExpectation.fulfill()
        }
        wait(for: [saveExpectation], timeout: 2)

        // Load
        let envelope = LocalCache.shared.loadTracks()
        XCTAssertNotNil(envelope, "Should load cached tracks")

        guard let loaded = envelope else { return }

        XCTAssertEqual(loaded.data.count, 2, "Should have 2 cached tracks")
        XCTAssertEqual(loaded.data[0].id, "track_test_1")
        XCTAssertEqual(loaded.data[0].title, "Happy Birthday Song")
        XCTAssertEqual(loaded.data[0].recipientName, "Chioma")
        XCTAssertEqual(loaded.data[0].occasion, "birthday")
        XCTAssertEqual(loaded.data[1].id, "track_test_2")
        XCTAssertEqual(loaded.data[1].title, "Anniversary Ballad")
        XCTAssertEqual(loaded.data[1].shareTokenId, "share_abc")

        // Verify savedAt is recent (within last 5 seconds)
        let elapsed = Date.now.timeIntervalSince(loaded.savedAt)
        XCTAssertLessThan(elapsed, 5.0, "savedAt should be recent")
    }

    // MARK: - Poems Round-Trip

    func testLoadSave_roundTrip_poems() {
        // Verify cache starts empty
        XCTAssertNil(LocalCache.shared.loadPoems(),
                     "Cache should be empty after invalidation")

        let poems = [
            Poem(
                id: "poem_test_1",
                userId: "user_1",
                title: "A Birthday Wish",
                recipientName: "Chioma",
                occasion: "birthday",
                tone: "warm",
                status: "generated",
                verses: [
                    "On this day so bright and new,",
                    "I wrote these words just for you."
                ],
                createdAt: "2026-03-26T00:00:00Z",
                updatedAt: "2026-03-26T00:00:00Z"
            )
        ]

        // Save
        LocalCache.shared.savePoems(poems)

        // Wait for async write
        let saveExpectation = expectation(description: "Poem cache write completes")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            saveExpectation.fulfill()
        }
        wait(for: [saveExpectation], timeout: 2)

        // Load
        let envelope = LocalCache.shared.loadPoems()
        XCTAssertNotNil(envelope, "Should load cached poems")

        guard let loaded = envelope else { return }

        XCTAssertEqual(loaded.data.count, 1)
        XCTAssertEqual(loaded.data[0].id, "poem_test_1")
        XCTAssertEqual(loaded.data[0].title, "A Birthday Wish")
        XCTAssertEqual(loaded.data[0].recipientName, "Chioma")
        XCTAssertEqual(loaded.data[0].verses.count, 2)
        XCTAssertEqual(loaded.data[0].verses[0], "On this day so bright and new,")
    }

    // MARK: - Invalidation

    func testInvalidateTracks_clearsCache() {
        let tracks = [
            Track(
                id: "track_inv",
                userId: "user_1",
                title: "Test",
                occasion: nil,
                recipientName: nil,
                style: nil,
                durationTarget: nil,
                voiceMode: nil,
                message: nil,
                status: "draft",
                latestVersion: 1,
                shareTokenId: nil,
                createdAt: "2026-03-26T00:00:00Z",
                updatedAt: "2026-03-26T00:00:00Z",
                coverImageUrl: nil,
                coverImageSmallUrl: nil,
                coverImageLargeUrl: nil
            )
        ]

        LocalCache.shared.saveTracks(tracks)

        // Wait for save
        let saveExp = expectation(description: "Save")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { saveExp.fulfill() }
        wait(for: [saveExp], timeout: 2)

        XCTAssertNotNil(LocalCache.shared.loadTracks(), "Should exist before invalidation")

        // Invalidate
        LocalCache.shared.invalidateTracks()

        // Wait for invalidation
        let invExp = expectation(description: "Invalidate")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { invExp.fulfill() }
        wait(for: [invExp], timeout: 2)

        XCTAssertNil(LocalCache.shared.loadTracks(), "Should be nil after invalidation")
    }

    func testPlayableAudioURL_roundTrip_andInvalidateTracksClearsIt() {
        XCTAssertNil(LocalCache.shared.playableAudioURL(for: "track_audio_1"))

        LocalCache.shared.savePlayableAudioURL(
            "https://cdn.example.com/audio/track_audio_1.m4a",
            for: "track_audio_1"
        )

        let saveExp = expectation(description: "Playable audio cache write completes")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { saveExp.fulfill() }
        wait(for: [saveExp], timeout: 2)

        XCTAssertEqual(
            LocalCache.shared.playableAudioURL(for: "track_audio_1")?.absoluteString,
            "https://cdn.example.com/audio/track_audio_1.m4a"
        )

        LocalCache.shared.invalidateTracks()

        let invalidateExp = expectation(description: "Playable audio cache invalidates")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { invalidateExp.fulfill() }
        wait(for: [invalidateExp], timeout: 2)

        XCTAssertNil(LocalCache.shared.playableAudioURL(for: "track_audio_1"))
    }
}
