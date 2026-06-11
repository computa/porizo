//
//  APIContractTests.swift
//  PorizoAppTests
//
//  Verify iOS models can decode real backend response shapes.
//  When the backend changes a field's type/structure, these tests fail BEFORE shipping.
//

import XCTest
@testable import PorizoApp

final class APIContractTests: XCTestCase {

    private let decoder = JSONDecoder()

    // MARK: - LyricsLine (polymorphic: string OR object)

    func testLyricsLine_decodesPlainString() throws {
        let json = Data(#""Hello world""#.utf8)
        let line = try decoder.decode(LyricsLine.self, from: json)
        XCTAssertEqual(line.text, "Hello world")
        XCTAssertNil(line.startTime)
        XCTAssertNil(line.endTime)
    }

    func testLyricsLine_decodesObjectWithTiming() throws {
        let json = Data(#"{"text":"Gozie, remember","startTime":18.56,"endTime":24.14}"#.utf8)
        let line = try decoder.decode(LyricsLine.self, from: json)
        XCTAssertEqual(line.text, "Gozie, remember")
        let startTime = try XCTUnwrap(line.startTime)
        let endTime = try XCTUnwrap(line.endTime)
        XCTAssertEqual(startTime, 18.56, accuracy: 0.01)
        XCTAssertEqual(endTime, 24.14, accuracy: 0.01)
    }

    func testLyricsLine_decodesObjectWithoutTiming() throws {
        let json = Data(#"{"text":"No timing here"}"#.utf8)
        let line = try decoder.decode(LyricsLine.self, from: json)
        XCTAssertEqual(line.text, "No timing here")
        XCTAssertNil(line.startTime)
    }

    // MARK: - LyricsSection

    func testLyricsSection_decodesMixedLines() throws {
        let json = Data("""
        {
            "name": "verse1",
            "lines": [
                "Plain string line",
                {"text": "Timed line", "startTime": 1.0, "endTime": 3.5}
            ],
            "startTime": 0.5,
            "endTime": 4.0
        }
        """.utf8)
        let section = try decoder.decode(LyricsSection.self, from: json)
        XCTAssertEqual(section.name, "verse1")
        XCTAssertEqual(section.lines.count, 2)
        XCTAssertEqual(section.lines[0].text, "Plain string line")
        XCTAssertNil(section.lines[0].startTime)
        XCTAssertEqual(section.lines[1].text, "Timed line")
        XCTAssertEqual(section.lines[1].startTime, 1.0)
        XCTAssertEqual(section.lineTexts, ["Plain string line", "Timed line"])
    }

    func testLyricsSection_decodesWithoutSectionTiming() throws {
        let json = Data("""
        {"name": "chorus", "lines": ["Line A", "Line B"]}
        """.utf8)
        let section = try decoder.decode(LyricsSection.self, from: json)
        XCTAssertEqual(section.name, "chorus")
        XCTAssertNil(section.startTime)
        XCTAssertEqual(section.lines.count, 2)
    }

    // MARK: - Full Lyrics object

    func testLyrics_decodesWhisperAlignedResponse() throws {
        // Simulates real backend response after Whisper alignment
        let json = Data("""
        {
            "title": "Song for Gozie",
            "style": "highlife",
            "sections": [
                {
                    "name": "verse1",
                    "lines": [
                        {"text": "Gozie, remember the cold", "startTime": 18.5, "endTime": 24.1},
                        {"text": "Empty pockets, dreams in our eyes", "startTime": 24.1, "endTime": 28.0}
                    ],
                    "startTime": 18.5,
                    "endTime": 28.0
                },
                {
                    "name": "chorus",
                    "lines": [
                        {"text": "Look how far you've come", "startTime": 28.5, "endTime": 32.0}
                    ],
                    "startTime": 28.5,
                    "endTime": 32.0
                }
            ],
            "anchor_line": "Look how far you've come"
        }
        """.utf8)
        let lyrics = try decoder.decode(Lyrics.self, from: json)
        XCTAssertEqual(lyrics.title, "Song for Gozie")
        XCTAssertEqual(lyrics.sections.count, 2)
        XCTAssertEqual(lyrics.sections[0].lines[0].startTime, 18.5)
        XCTAssertEqual(lyrics.anchorLine, "Look how far you've come")
    }

    func testLyrics_decodesPreWhisperResponse() throws {
        // Simulates backend response BEFORE Whisper alignment (plain strings)
        let json = Data("""
        {
            "title": "Test Song",
            "style": "pop",
            "sections": [
                {"name": "verse1", "lines": ["Hello world", "Second line"]},
                {"name": "chorus", "lines": ["Chorus line"]}
            ],
            "anchor_line": "Chorus line"
        }
        """.utf8)
        let lyrics = try decoder.decode(Lyrics.self, from: json)
        XCTAssertEqual(lyrics.sections.count, 2)
        XCTAssertEqual(lyrics.sections[0].lines[0].text, "Hello world")
        XCTAssertNil(lyrics.sections[0].lines[0].startTime)
    }

    // MARK: - TrackVersion with embedded lyrics

    func testTrackVersion_decodesWithTimedLyrics() throws {
        let json = Data("""
        {
            "id": "abc-123",
            "track_id": "def-456",
            "version_num": 1,
            "status": "preview_ready",
            "lyrics_json": {
                "title": "Test",
                "style": "soul",
                "sections": [{"name": "v1", "lines": [{"text": "Line", "startTime": 0.5, "endTime": 2.0}]}]
            },
            "created_at": "2026-01-01T00:00:00Z"
        }
        """.utf8)
        let version = try decoder.decode(TrackVersion.self, from: json)
        XCTAssertEqual(version.id, "abc-123")
        XCTAssertEqual(version.lyricsJson?.sections.first?.lines.first?.text, "Line")
        XCTAssertEqual(version.lyricsJson?.sections.first?.lines.first?.startTime, 0.5)
    }

    func testTrackVersion_decodesWithNullLyrics() throws {
        let json = Data("""
        {
            "id": "abc-123",
            "track_id": "def-456",
            "version_num": 1,
            "status": "queued",
            "lyrics_json": null,
            "created_at": "2026-01-01T00:00:00Z"
        }
        """.utf8)
        let version = try decoder.decode(TrackVersion.self, from: json)
        XCTAssertNil(version.lyricsJson)
    }

    // MARK: - Share info contract

    func testShareInfoResponse_decodesSenderAndWebStreamForClaimedShare() throws {
        let json = Data("""
        {
            "status": "claimed",
            "can_access": false,
            "track": {
                "title": "Birthday Song",
                "recipient_name": "Sarah",
                "sender_name": "Marcus",
                "duration_sec": 60,
                "cover_image_url": "https://example.com/cover.jpg"
            },
            "track_preview": {
                "title": "Birthday Song",
                "recipient_name": "Sarah",
                "sender_name": "Marcus",
                "duration_sec": 60,
                "cover_image_url": "https://example.com/cover.jpg"
            },
            "web_stream_url": "https://example.com/share/abc/audio",
            "app_download_url": "https://apps.apple.com/app/id123"
        }
        """.utf8)

        let response = try decoder.decode(ShareInfoResponse.self, from: json)
        XCTAssertEqual(response.status, "claimed")
        XCTAssertEqual(response.track?.senderName, "Marcus")
        XCTAssertEqual(response.trackPreview?.senderName, "Marcus")
        XCTAssertEqual(response.webStreamUrl, "https://example.com/share/abc/audio")
    }

    func testShareClaimInitialMode_prefersReadOnlyPreviewForClaimedShareWithWebStream() {
        let response = ShareInfoResponse(
            status: "claimed",
            canAccess: false,
            track: nil,
            trackPreview: nil,
            webStreamUrl: "https://example.com/share/abc/audio",
            appDownloadUrl: nil
        )

        XCTAssertEqual(ShareClaimInitialMode.resolve(for: response), .previewReadOnly)
    }

    func testShareClaimInitialMode_returnsClaimablePreviewForUnboundShareWithWebStream() {
        let response = ShareInfoResponse(
            status: "unbound",
            canAccess: nil,
            track: nil,
            trackPreview: nil,
            webStreamUrl: "https://example.com/share/abc/audio",
            appDownloadUrl: nil
        )

        XCTAssertEqual(ShareClaimInitialMode.resolve(for: response), .previewClaimable)
    }

    // MARK: - AuthUser identity contract

    func testAuthUser_decodesExpandedIdentityResponse() throws {
        let json = Data("""
        {
            "user_id": "user_123",
            "email": "primary@example.com",
            "display_name": "Ambrose",
            "avatar_url": null,
            "email_verified": true,
            "providers": ["apple", "phone"],
            "created_at": "2026-04-13T00:00:00Z",
            "phone_number": "+15551234567",
            "username": "ambrose",
            "needs_profile_completion": false,
            "auth_methods": [
                {
                    "type": "apple",
                    "linked_at": "2026-04-13T00:00:00Z",
                    "last_used_at": "2026-04-13T01:00:00Z"
                },
                {
                    "type": "phone",
                    "linked_at": "2026-04-13T00:05:00Z",
                    "last_used_at": "2026-04-13T01:05:00Z",
                    "subject_masked": "+1***4567"
                }
            ],
            "contacts": [
                {
                    "type": "email",
                    "value_display": "primary@example.com",
                    "verified": true,
                    "is_primary": true,
                    "is_relay": false
                },
                {
                    "type": "phone",
                    "value_display": "+1 555 123 4567",
                    "verified": true,
                    "is_primary": true
                }
            ],
            "primary_email": "primary@example.com",
            "primary_phone": "+15551234567",
            "missing_profile_requirements": []
        }
        """.utf8)

        let user = try decoder.decode(AuthUser.self, from: json)
        XCTAssertEqual(user.id, "user_123")
        XCTAssertEqual(user.authMethods.count, 2)
        XCTAssertEqual(user.authMethods.first?.lastUsedAt, "2026-04-13T01:00:00Z")
        XCTAssertEqual(user.contacts.count, 2)
        XCTAssertEqual(user.primaryEmail, "primary@example.com")
        XCTAssertEqual(user.primaryPhone, "+15551234567")
        XCTAssertTrue(user.missingProfileRequirements.isEmpty)
    }

    func testAuthUser_decodesMissingProfileRequirementsForRelayAccount() throws {
        let json = Data("""
        {
            "user_id": "user_relay",
            "email": null,
            "display_name": "Relay User",
            "avatar_url": null,
            "email_verified": false,
            "providers": ["apple"],
            "created_at": "2026-04-13T00:00:00Z",
            "phone_number": null,
            "username": null,
            "needs_profile_completion": true,
            "auth_methods": [],
            "contacts": [
                {
                    "type": "email",
                    "value_display": "relay@privaterelay.appleid.com",
                    "verified": true,
                    "is_primary": true,
                    "is_relay": true
                }
            ],
            "primary_email": null,
            "primary_phone": null,
            "missing_profile_requirements": ["verified_email", "verified_phone"]
        }
        """.utf8)

        let user = try decoder.decode(AuthUser.self, from: json)
        XCTAssertTrue(user.needsProfileCompletion)
        XCTAssertEqual(user.contacts.first?.isRelay, true)
        XCTAssertEqual(Set(user.missingProfileRequirements), Set(["verified_email", "verified_phone"]))
    }

    // MARK: - Story guidance contract (backwards compatibility)

    /// Proves old iOS APIError decodes the same 422 body without crashing.
    /// Old clients show the `message` as a toast — degraded but functional.
    func testStoryGuidance422_decodesAsAPIError_backwardsCompat() throws {
        let json = Data("""
        {
            "error": "STORY_NEEDS_INPUT",
            "message": "Before I lock this in, tell me one line about how this changed them.",
            "recovery": {
                "question": "Before I lock this in, tell me one line about how this changed them.",
                "suggestions": ["Talk about how they grew"],
                "missing_blocks": ["transformation"],
                "session_version": 5
            }
        }
        """.utf8)

        // Old iOS decodes the same body as APIError — must NOT crash
        let apiError = try decoder.decode(APIError.self, from: json)
        XCTAssertEqual(apiError.error, "STORY_NEEDS_INPUT")
        XCTAssertEqual(apiError.message, "Before I lock this in, tell me one line about how this changed them.")
        // `details` is [String: String]? — the nested `recovery` object is silently ignored
        XCTAssertNil(apiError.details)
    }

    func testStoryGuidanceResponse_decodesConfirmNeedsInputPayload() throws {
        let json = Data("""
        {
            "error": "STORY_NEEDS_INPUT",
            "message": "Before I lock this in, tell me one line about how this changed them.",
            "recovery": {
                "question": "Before I lock this in, tell me one line about how this changed them.",
                "suggestions": ["Talk about how they grew"],
                "missing_blocks": ["transformation"],
                "session_version": 5
            }
        }
        """.utf8)

        let payload = try decoder.decode(StoryGuidanceResponse.self, from: json)
        XCTAssertEqual(payload.error, "STORY_NEEDS_INPUT")
        XCTAssertEqual(payload.message, "Before I lock this in, tell me one line about how this changed them.")
        XCTAssertEqual(payload.recovery.question, "Before I lock this in, tell me one line about how this changed them.")
        XCTAssertEqual(payload.recovery.suggestions, ["Talk about how they grew"])
        XCTAssertEqual(payload.recovery.missingBlocks, ["transformation"])
        XCTAssertEqual(payload.recovery.sessionVersion, 5)
    }

    // MARK: - BillingEntitlements (pay-per-song fields)

    func testBillingEntitlements_decodesPayPerSongFields() throws {
        let json = Data(#"""
        {"tier":"free","songs_remaining":0,"songs_allowance":0,
         "trial_songs_remaining":0,"gift_wallet_balance":3,
         "available_song_credits":3,"pay_per_song_enabled":true}
        """#.utf8)
        let e = try decoder.decode(BillingEntitlements.self, from: json)
        XCTAssertEqual(e.giftWalletBalance, 3)
        XCTAssertEqual(e.availableSongCredits, 3)
        XCTAssertTrue(e.payPerSongEnabled)
        XCTAssertTrue(e.canMakeSong) // 3 credits available
    }

    func testBillingEntitlements_decodesGiftSongsUsedTotal() throws {
        let json = Data(#"""
        {"tier":"free","songs_remaining":0,"songs_allowance":0,
         "songs_used_total":5,"gift_songs_used_total":2,
         "trial_songs_remaining":0,"gift_wallet_balance":0,
         "available_song_credits":0,"pay_per_song_enabled":true}
        """#.utf8)
        let e = try decoder.decode(BillingEntitlements.self, from: json)
        XCTAssertEqual(e.songsUsedTotal, 5)
        XCTAssertEqual(e.giftSongsUsedTotal, 2)
        XCTAssertEqual(e.availableSongCredits, 0)
        XCTAssertTrue(e.payPerSongEnabled)
        XCTAssertFalse(e.canMakeSong)
    }

    func testBillingEntitlements_trustsServerAvailableCredits_notLocalGiftCount() throws {
        // Client is server-authoritative: it never counts gift_wallet_balance
        // locally. If the server reports available_song_credits:0, canMakeSong is
        // false even when a gift balance is present.
        let json = Data(#"""
        {"tier":"free","songs_remaining":0,"gift_wallet_balance":3,
         "available_song_credits":0,"pay_per_song_enabled":false}
        """#.utf8)
        let e = try decoder.decode(BillingEntitlements.self, from: json)
        XCTAssertFalse(e.payPerSongEnabled)
        XCTAssertFalse(e.canMakeSong)
    }

    func testBillingEntitlements_backwardCompat_missingFieldsFallBack() throws {
        // Old server: no available_song_credits / pay_per_song_enabled.
        let json = Data(#"{"tier":"plus","songs_remaining":4}"#.utf8)
        let e = try decoder.decode(BillingEntitlements.self, from: json)
        XCTAssertEqual(e.availableSongCredits, 4) // falls back to songsRemaining
        XCTAssertFalse(e.payPerSongEnabled) // defaults off
        XCTAssertEqual(e.giftWalletBalance, 0)
        XCTAssertEqual(e.giftSongsUsedTotal, 0)
        XCTAssertTrue(e.canMakeSong)
    }

    func testBillingEntitlements_canMakeSong_neverBlocksOnOngoingCredits() throws {
        // Defensive: backend wrongly reports 0 available while songsRemaining > 0.
        let json = Data(#"""
        {"tier":"plus","songs_remaining":5,"available_song_credits":0,
         "pay_per_song_enabled":true}
        """#.utf8)
        let e = try decoder.decode(BillingEntitlements.self, from: json)
        XCTAssertTrue(e.canMakeSong) // max(0, 5) > 0 — not locked out
    }
}
