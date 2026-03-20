//
//  V1ScreenCatalogView.swift
//  PorizoApp
//
//  Design preview navigator for all v1.pen screens.
//  This is a temporary UI integration layer to make every v1 screen reachable
//  before backend wiring begins.
//

import SwiftUI

// MARK: - V1 Screen Catalog

struct V1ScreenCatalogView: View {
    let apiClient: APIClient
    @EnvironmentObject private var authManager: AuthManager
    @State private var apiWrapper: APIClientWrapper

    init(apiClient: APIClient) {
        self.apiClient = apiClient
        self._apiWrapper = State(initialValue: APIClientWrapper(client: apiClient))
    }

    var body: some View {
        NavigationStack {
            ZStack {
                DesignTokens.background.ignoresSafeArea()

                List {
                    Section("Core") {
                        screenLink("00 - Splash") { SplashView() }
                        screenLink("01 - Landing") { LandingView(onCreateAccount: {}, onSignIn: {}) }
                        screenLink("02 - Create Account") {
                            AuthView()
                                .environmentObject(authManager)
                                .environment(apiWrapper)
                        }
                        screenLink("03 - Phone Number") {
                            PhoneAuthView(onContinue: { _, _ in }, onBack: {})
                                .environment(apiWrapper)
                        }
                        screenLink("04 - Confirmation Code") {
                            PhoneVerificationView(phoneNumber: "+15551234567", onVerified: { _ in }, onBack: {})
                                .environment(apiWrapper)
                        }
                        screenLink("05 - Username") {
                            UsernameView(
                                registrationToken: "reg_mock",
                                phoneNumber: "+15551234567",
                                onComplete: { _ in },
                                onBack: {}
                            )
                            .environment(apiWrapper)
                        }
                    }

                    Section("Explore & Libraries") {
                        screenLink("06 - Explore") {
                            ExploreTabView(
                                apiClient: apiClient,
                                playerState: PlayerState(),
                                onOccasionSelected: { _ in },
                                onCreate: { },
                                onSendGift: { },
                                showsGiftSendEntry: true
                            )
                        }
                        screenLink("10 - Songs Library") {
                            SongsTabView(
                                apiClient: apiClient,
                                playerState: PlayerState(),
                                refreshTrigger: 0,
                                onCreateNew: {},
                                onDraftSelected: { _, _ in }
                            )
                        }
                        screenLink("11 - Poems Library") {
                            PoemsTabView(
                                apiClient: apiClient,
                                onCreatePoem: {},
                                onCreateVariation: { _ in },
                                playerState: PlayerState()
                            )
                        }
                        screenLink("12 - Settings") {
                            SettingsTabView(apiClient: apiClient, storeKit: StoreKitManager(apiClient: apiClient))
                                .environmentObject(authManager)
                        }
                        screenLink("13 - Settings Sheet (Theme)") {
                            ThemePickerSheet(selectedTheme: .constant(.system), onDismiss: {})
                        }
                    }

                    Section("Create Flow") {
                        screenLink("07d - Create: Voice") {
                            VoiceModeSelectionView(apiClient: apiClient, onSelect: { _, _ in }, onBack: {})
                        }
                        screenLink("08 - Unified Create (Simple/Custom)") {
                            CustomCreateView(
                                apiClient: apiClient,
                                onCreateSong: { _ in },
                                onCancel: {},
                                contentKind: .song,
                                initialTab: .simple
                            )
                            .environment(apiWrapper)
                        }
                        screenLink("14 - Speech-to-Text") {
                            SpeechInputView(storyId: "story_mock", onTranscription: { _ in }, onCancel: {})
                                .environment(apiWrapper)
                        }
                    }

                    Section("Story Conversation") {
                        screenLink("09a - Conversation Chat") {
                            V1StoryChatPreviewView(apiClient: apiClient)
                                .environment(apiWrapper)
                        }
                        screenLink("09b - Conversation Story") {
                            V1StoryChatPreviewView(apiClient: apiClient)
                                .environment(apiWrapper)
                        }
                        screenLink("09c - Story Complete") {
                            V1StoryCompletePreviewView(apiClient: apiClient)
                                .environment(apiWrapper)
                        }
                        screenLink("09 - Voice Enrollment") {
                            VoiceEnrollmentView()
                        }
                    }

                    Section("Playback & Actions") {
                        screenLink("16 - Song Action Menu") {
                            SongActionMenu(
                                track: V1MockData.track,
                                onPlay: {},
                                onShare: {},
                                onDelete: {},
                                onDismiss: {}
                            )
                        }
                        screenLink("17 - Share Song") { V1ShareSongView() }
                        screenLink("18 - Delete Confirmation") {
                            DeleteConfirmationView(
                                title: "Delete song?",
                                itemName: "Song for Chioma",
                                onConfirm: {},
                                onCancel: {}
                            )
                        }
                        screenLink("19 - Now Playing") { V1NowPlayingPreviewView() }
                    }

                    Section("Poems") {
                        screenLink("20 - Poem Full View") {
                            PoemPreviewView(poem: V1MockData.poem, apiClient: apiClient, onRegenerate: {}, onDone: {})
                        }
                        screenLink("21 - Poem Action Menu") {
                            PoemActionMenu(
                                poem: V1MockData.poem,
                                canShare: true,
                                onListen: {},
                                onShare: {},
                                onDelete: {}
                            )
                            .environment(apiWrapper)
                        }
                        screenLink("22 - Share Poem") {
                            PoemShareView(poem: V1MockData.poem)
                                .environment(apiWrapper)
                        }
                        screenLink("23 - Poem Gift Reveal") {
                            PoemRevealView(
                                shareInfo: V1MockData.poemShareInfo,
                                onClaim: {}
                            )
                        }
                        screenLink("24 - Shared Poem") {
                            SharedPoemView(
                                poem: V1MockData.poem,
                                claimResponse: nil,
                                shareUrl: nil,
                                onDone: {}
                            )
                        }
                    }

                    Section("Subscriptions") {
                        screenLink("14 - Subscription Plans") {
                            SubscriptionView(apiClient: apiClient, storeKit: StoreKitManager(apiClient: apiClient))
                        }
                    }

                    Section("Lyrics Redesign") {
                        screenLink("A - Spotlight") { LyricsOptionView(style: .spotlight) }
                        screenLink("B - Karaoke Sweep") { LyricsOptionView(style: .karaokeSweep) }
                        screenLink("C - Verse Stage") { LyricsOptionView(style: .verseStage) }
                    }
                }
                .scrollContentBackground(.hidden)
                .listStyle(.insetGrouped)
            }
            .navigationTitle("v1.pen Screens")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private func screenLink<Destination: View>(_ title: String, @ViewBuilder destination: () -> Destination) -> some View {
        NavigationLink(destination: destination()) {
            Text(title)
                .font(DesignTokens.bodyFont(size: 15, weight: .medium))
                .foregroundStyle(DesignTokens.textPrimary)
        }
        .listRowBackground(DesignTokens.surface)
    }
}

// MARK: - Mock Data

private enum V1MockData {
    static let track = Track(
        id: "track_mock",
        userId: "user_mock",
        title: "Song for Chioma",
        occasion: "birthday",
        recipientName: "Chioma",
        style: "soul",
        durationTarget: 120,
        voiceMode: "ai_voice",
        message: "Thank you for everything",
        status: "ready",
        latestVersion: 1,
        shareTokenId: nil,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
        coverImageUrl: nil,
        coverImageSmallUrl: nil,
        coverImageLargeUrl: nil
    )

    static let version = TrackVersion(
        id: "version_mock",
        trackId: "track_mock",
        versionNum: 1,
        status: "ready",
        renderType: "preview",
        lyricsStatus: "approved",
        lyricsJson: nil,
        previewUrl: nil,
        fullUrl: nil,
        previewJobId: nil,
        fullJobId: nil,
        moderationStatus: nil,
        moderationReason: nil,
        lastErrorCode: nil,
        lastErrorMessage: nil,
        lastErrorTerms: nil,
        createdAt: "2026-01-01",
        completedAt: "2026-01-01",
        coverImageUrl: nil,
        coverImageSmallUrl: nil,
        coverImageLargeUrl: nil
    )

    static let poem = Poem(
        id: "poem_mock",
        userId: "user_mock",
        title: "For Chioma",
        recipientName: "Chioma",
        occasion: "celebration",
        tone: "heartfelt",
        status: "complete",
        verses: [
            "You are the morning light,",
            "Soft as the dawn we found together.",
            "Every step, a quiet blessing."
        ],
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01"
    )

    static let poemShareInfo = PoemShareInfoResponse(
        status: "ready",
        canAccess: true,
        poem: SharedPoemPreview(
            title: "For Chioma",
            recipientName: "Chioma",
            occasion: "celebration",
            previewLines: [
                "You are the morning light,",
                "Soft as the dawn we found together."
            ],
            creatorName: "Michael"
        ),
        expiresAt: "2026-02-01",
        requiresPin: true,
        claimAttempts: 0,
        maxAttempts: 3
    )

}
