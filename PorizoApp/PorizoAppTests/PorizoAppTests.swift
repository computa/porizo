import XCTest
@testable import PorizoApp

// MARK: - Model Parsing Tests

final class PoemModelTests: XCTestCase {

    func testPoemDecoding() throws {
        let json = """
        {
            "id": "poem_123",
            "user_id": "user_456",
            "title": "Birthday Wishes",
            "recipient_name": "Sarah",
            "occasion": "birthday",
            "tone": "heartfelt",
            "status": "complete",
            "verses": ["Line one", "Line two", "Line three"],
            "created_at": "2025-01-01T12:00:00Z",
            "updated_at": "2025-01-01T12:00:00Z"
        }
        """.data(using: .utf8)!

        let poem = try JSONDecoder().decode(Poem.self, from: json)

        XCTAssertEqual(poem.id, "poem_123")
        XCTAssertEqual(poem.userId, "user_456")
        XCTAssertEqual(poem.title, "Birthday Wishes")
        XCTAssertEqual(poem.recipientName, "Sarah")
        XCTAssertEqual(poem.occasion, "birthday")
        XCTAssertEqual(poem.tone, "heartfelt")
        XCTAssertEqual(poem.status, "complete")
        XCTAssertEqual(poem.verses.count, 3)
    }

    func testPoemPreviewLines() throws {
        let poem = Poem(
            id: "poem_1",
            userId: "user_1",
            title: "Test",
            recipientName: "Test",
            occasion: "birthday",
            tone: "happy",
            status: "complete",
            verses: ["First line", "Second line", "Third line"],
            createdAt: "2025-01-01",
            updatedAt: "2025-01-01"
        )

        XCTAssertEqual(poem.previewLines, "First line Second line")
    }

    func testPoemPreviewLinesWithSingleVerse() throws {
        let poem = Poem(
            id: "poem_1",
            userId: "user_1",
            title: "Test",
            recipientName: "Test",
            occasion: "birthday",
            tone: "happy",
            status: "complete",
            verses: ["Only one line"],
            createdAt: "2025-01-01",
            updatedAt: "2025-01-01"
        )

        XCTAssertEqual(poem.previewLines, "Only one line")
    }

    func testPoemPreviewLinesWithEmptyVerses() throws {
        let poem = Poem(
            id: "poem_1",
            userId: "user_1",
            title: "Test",
            recipientName: "Test",
            occasion: "birthday",
            tone: "happy",
            status: "complete",
            verses: [],
            createdAt: "2025-01-01",
            updatedAt: "2025-01-01"
        )

        XCTAssertEqual(poem.previewLines, "")
    }
}

// MARK: - Occasion Model Tests

final class OccasionTests: XCTestCase {

    func testAllOccasionsHaveDisplayNames() {
        for occasion in Occasion.allCases {
            XCTAssertFalse(occasion.displayName.isEmpty, "Occasion \(occasion.rawValue) should have a display name")
        }
    }

    func testAllOccasionsHaveEmojis() {
        for occasion in Occasion.allCases {
            XCTAssertFalse(occasion.emoji.isEmpty, "Occasion \(occasion.rawValue) should have an emoji")
        }
    }

    func testBirthdayOccasion() {
        let birthday = Occasion.birthday
        XCTAssertEqual(birthday.rawValue, "birthday")
        XCTAssertEqual(birthday.emoji, "🎂")
    }

    func testMothersDayOccasion() {
        let mothersDay = Occasion.mothersDay
        XCTAssertEqual(mothersDay.rawValue, "mothers_day")
        XCTAssertEqual(mothersDay.displayName, "Mother's Day")
        XCTAssertEqual(mothersDay.greeting, "Happy Mother's Day")
    }
}

// MARK: - Create Deep Link Tests

final class CreateDeepLinkTests: XCTestCase {

    func testParsesSongCreateDeepLink() throws {
        let url = try XCTUnwrap(URL(string: "porizo://create?type=song&occasion=birthday&recipient=Sarah"))

        let context = try XCTUnwrap(parseCreateDeepLink(from: url))

        XCTAssertEqual(context.type, .song)
        XCTAssertEqual(context.occasion, .birthday)
        XCTAssertEqual(context.recipientName, "Sarah")
    }

    func testParsesMothersDayAliases() throws {
        let url = try XCTUnwrap(URL(string: "porizo://create?type=song&occasion=mothers-day"))

        let context = try XCTUnwrap(parseCreateDeepLink(from: url))

        XCTAssertEqual(context.type, .song)
        XCTAssertEqual(context.occasion, .mothersDay)
    }

    func testIgnoresShareDeepLink() throws {
        let url = try XCTUnwrap(URL(string: "porizo://play/share_123"))

        XCTAssertNil(parseCreateDeepLink(from: url))
    }
}

// MARK: - Share Deep Link Routing Tests

final class ShareDeepLinkRouteTests: XCTestCase {

    func testUnauthenticatedSongShareRequiresAuthBeforeClaim() {
        let route = resolveShareDeepLinkRoute(isPoem: false, canPresentClaim: false)

        XCTAssertEqual(route, .authenticate(message: "Sign in to listen to your shared song"))
    }

    func testUnauthenticatedPoemShareRequiresAuthBeforeClaim() {
        let route = resolveShareDeepLinkRoute(isPoem: true, canPresentClaim: false)

        XCTAssertEqual(route, .authenticate(message: "Sign in to read your shared poem"))
    }

    func testAuthenticatedSharePresentsClaimFlowImmediately() {
        XCTAssertEqual(resolveShareDeepLinkRoute(isPoem: false, canPresentClaim: true), .present)
        XCTAssertEqual(resolveShareDeepLinkRoute(isPoem: true, canPresentClaim: true), .present)
    }
}

// MARK: - Style Store Tests

final class StyleStoreTests: XCTestCase {

    @MainActor
    func testDefaultStylesHaveDisplayNames() {
        let store = StyleStore()
        for style in store.styles {
            XCTAssertFalse(style.displayName.isEmpty, "Style \(style.key) should have a display name")
        }
    }

    @MainActor
    func testDisplayNameFallbackForUnknownStyle() {
        let store = StyleStore()
        XCTAssertEqual(store.displayName(for: "pop"), "Pop")
        XCTAssertEqual(store.displayName(for: "unknown_genre"), "Unknown Genre")
        XCTAssertEqual(store.displayName(for: "igbo_highlife"), "Igbo Highlife")
    }

    @MainActor
    func testGroupedCategories() {
        let store = StyleStore()
        let groups = store.grouped
        XCTAssertEqual(groups.map(\.0), ["popular", "african", "latin"])
    }
}

// MARK: - Enrollment Session Tests

final class EnrollmentSessionTests: XCTestCase {

    func testEnrollmentSessionDecoding() throws {
        let json = """
        {
            "session_id": "sess_abc123",
            "session_expires_at": "2025-01-02T12:00:00Z",
            "prompts": [
                {
                    "id": "p1",
                    "text": "Say hello",
                    "type": "spoken"
                }
            ],
            "prompt_set_id": "set_1",
            "upload_urls": [],
            "recording_settings": {
                "sample_rate": 44100,
                "channels": 1,
                "format": "wav"
            }
        }
        """.data(using: .utf8)!

        let session = try JSONDecoder().decode(EnrollmentSession.self, from: json)

        XCTAssertEqual(session.sessionId, "sess_abc123")
        XCTAssertEqual(session.prompts?.count, 1)
        XCTAssertEqual(session.prompts?.first?.text, "Say hello")
        XCTAssertEqual(session.recordingSettings?.sampleRate, 44100)
    }

    func testEnrollmentSessionWithMinimalFields() throws {
        let json = """
        {
            "session_id": "sess_minimal",
            "session_expires_at": "2025-01-02T12:00:00Z"
        }
        """.data(using: .utf8)!

        let session = try JSONDecoder().decode(EnrollmentSession.self, from: json)

        XCTAssertEqual(session.sessionId, "sess_minimal")
        XCTAssertNil(session.prompts)
        XCTAssertNil(session.uploadUrls)
    }
}

// MARK: - Voice Profile Tests

final class VoiceProfileTests: XCTestCase {

    func testVoiceProfileDecoding() throws {
        let json = """
        {
            "voice_profile_id": "vp_123",
            "quality_score": 85.5,
            "status": "ready",
            "created_at": "2025-01-01T12:00:00Z"
        }
        """.data(using: .utf8)!

        let profile = try JSONDecoder().decode(VoiceProfile.self, from: json)

        XCTAssertEqual(profile.voiceProfileId, "vp_123")
        XCTAssertEqual(profile.qualityScore, 85.5)
        XCTAssertEqual(profile.status, "ready")
    }
}

// MARK: - CustomSongRequest Tests

final class CustomSongRequestTests: XCTestCase {

    func testSimpleModeRequest() {
        let request = CustomSongRequest(
            description: "A happy birthday song",
            lyrics: nil,
            isInstrumental: false,
            styles: ["pop", "indie"],
            title: nil,
            tempo: nil,
            mood: nil,
            duration: nil
        )

        XCTAssertEqual(request.description, "A happy birthday song")
        XCTAssertNil(request.lyrics)
        XCTAssertFalse(request.isInstrumental)
        XCTAssertEqual(request.styles, ["pop", "indie"])
    }

    func testCustomModeRequest() {
        let request = CustomSongRequest(
            description: nil,
            lyrics: "Happy birthday to you",
            isInstrumental: false,
            styles: ["folk"],
            title: "Birthday Song",
            tempo: "120",
            mood: "happy",
            duration: "60"
        )

        XCTAssertNil(request.description)
        XCTAssertEqual(request.lyrics, "Happy birthday to you")
        XCTAssertEqual(request.title, "Birthday Song")
        XCTAssertEqual(request.tempo, "120")
    }

    func testInstrumentalRequest() {
        let request = CustomSongRequest(
            description: "Relaxing instrumental",
            lyrics: nil,
            isInstrumental: true,
            styles: ["ambient"],
            title: nil,
            tempo: nil,
            mood: nil,
            duration: nil
        )

        XCTAssertTrue(request.isInstrumental)
        XCTAssertNil(request.lyrics)
    }
}

// MARK: - Design Tokens Tests

final class DesignTokensTests: XCTestCase {

    func testBackgroundColorExists() {
        // Verify design tokens are accessible
        let background = DesignTokens.background
        XCTAssertNotNil(background)
    }

    func testGoldColorExists() {
        let gold = DesignTokens.gold
        XCTAssertNotNil(gold)
    }

    func testDisplayFontReturnsFont() {
        let font = DesignTokens.displayFont(size: 24)
        XCTAssertNotNil(font)
    }

    func testBodyFontReturnsFont() {
        let font = DesignTokens.bodyFont(size: 14, weight: .medium)
        XCTAssertNotNil(font)
    }
}

// MARK: - Story Model Contract Hardening Tests

final class StoryModelContractTests: XCTestCase {

    func testContinueStoryResponseDecodesWhenCompleteFieldMissing() throws {
        let json = """
        {
            "error": "Reasoner fallback in progress",
            "current_question": "Can you share one specific scene?",
            "next_question": "Can you share one specific scene?",
            "progress": 95
        }
        """.data(using: .utf8)!

        let decoded = try JSONDecoder().decode(ContinueStoryV2Response.self, from: json)
        XCTAssertFalse(decoded.complete)
        XCTAssertEqual(decoded.nextQuestion, "Can you share one specific scene?")
        XCTAssertEqual(decoded.progress, 95)
    }
}
