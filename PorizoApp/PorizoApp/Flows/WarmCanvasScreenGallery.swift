//
//  WarmCanvasScreenGallery.swift
//  PorizoApp
//
//  Debug gallery for reviewing all 32 Warm Canvas prototype screens.
//  Accessed from Settings → Warm Canvas Screens.
//

import SwiftUI

#if DEBUG
struct WarmCanvasScreenGallery: View {
    @Environment(\.dismiss) private var dismiss
    @State private var activeScreen: ScreenPreview?

    private let demoRecipient = "Sarah"
    private let demoOccasion = "Birthday"

    enum ScreenPreview: String, CaseIterable, Identifiable {
        // Pre-auth (7)
        case splash = "Splash"
        case onboarding = "Onboard"
        case nameEntry = "Name"
        case auth = "Auth"
        case phoneEntry = "Phone"
        case phoneVerify = "Verify"
        case profileComplete = "Profile"
        // Create flow (6)
        case tell = "Tell"
        case tellLyrics = "Lyrics"
        case wait = "Wait"
        case reveal = "Reveal"
        case lyricsReview = "Edit Lyrics"
        case share = "Share"
        // Tabs (4)
        case home = "Home"
        case songs = "Songs"
        case poems = "Poems"
        case settings = "Settings"
        // Voice (4)
        case voiceIntro = "Voice"
        case voiceRecording = "Record"
        case voiceProcessing = "Processing"
        case voiceComplete = "Complete"
        // Other (4)
        case subscription = "Sub"
        case nowPlaying = "Playing"
        case poemDetail = "Poem"
        case shareClaim = "Claim"
        // Error states (7)
        case tellError = "Tell Err"
        case tellModeration = "Moderation"
        case waitTimeout = "Timeout"
        case waitFailure = "Wait Fail"
        case revealFailure = "Reveal Fail"
        case shareFailure = "Share Fail"
        case noCredits = "Credits"

        var id: String { rawValue }

        var section: ScreenSection {
            switch self {
            case .splash, .onboarding, .nameEntry, .auth, .phoneEntry, .phoneVerify, .profileComplete:
                return .preAuth
            case .tell, .tellLyrics, .wait, .reveal, .lyricsReview, .share:
                return .createFlow
            case .home, .songs, .poems, .settings:
                return .tabs
            case .voiceIntro, .voiceRecording, .voiceProcessing, .voiceComplete:
                return .voice
            case .subscription, .nowPlaying, .poemDetail, .shareClaim:
                return .other
            case .tellError, .tellModeration, .waitTimeout, .waitFailure, .revealFailure, .shareFailure, .noCredits:
                return .errors
            }
        }

        var icon: String {
            switch self {
            case .splash: return "rays"
            case .onboarding: return "hand.wave"
            case .nameEntry: return "pencil.line"
            case .auth: return "person.badge.key"
            case .phoneEntry: return "phone"
            case .phoneVerify: return "lock.shield"
            case .profileComplete: return "person.crop.circle.badge.checkmark"
            case .tell: return "bubble.left.and.bubble.right"
            case .tellLyrics: return "music.note.list"
            case .wait: return "circle.dotted"
            case .reveal: return "sparkles"
            case .lyricsReview: return "text.page"
            case .share: return "square.and.arrow.up"
            case .home: return "house"
            case .songs: return "music.note"
            case .poems: return "scroll"
            case .settings: return "gearshape"
            case .voiceIntro: return "mic"
            case .voiceRecording: return "mic.fill"
            case .voiceProcessing: return "waveform"
            case .voiceComplete: return "checkmark.circle"
            case .subscription: return "crown"
            case .nowPlaying: return "play.circle"
            case .poemDetail: return "text.book.closed"
            case .shareClaim: return "gift"
            case .tellError: return "wifi.exclamationmark"
            case .tellModeration: return "shield.lefthalf.filled"
            case .waitTimeout: return "clock.arrow.circlepath"
            case .waitFailure: return "exclamationmark.triangle"
            case .revealFailure: return "exclamationmark.circle"
            case .shareFailure: return "link.badge.plus"
            case .noCredits: return "creditcard"
            }
        }
    }

    enum ScreenSection: String, CaseIterable {
        case preAuth = "Pre-Auth"
        case createFlow = "Create Flow"
        case tabs = "Tabs"
        case voice = "Voice"
        case other = "Other"
        case errors = "Error States"

        var screens: [ScreenPreview] {
            ScreenPreview.allCases.filter { $0.section == self }
        }

        var accentColor: Color {
            switch self {
            case .errors: return DesignTokens.warning
            default: return DesignTokens.gold
            }
        }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                DesignTokens.background.ignoresSafeArea()

                if let screen = activeScreen {
                    screenView(for: screen)
                        .transition(.opacity)
                } else {
                    galleryList
                }
            }
            .animation(.easeInOut(duration: 0.25), value: activeScreen)
            .navigationTitle(activeScreen == nil ? "Warm Canvas Screens" : activeScreen!.rawValue)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if activeScreen != nil {
                        Button("Gallery") { activeScreen = nil }
                    } else {
                        Button("Done") { dismiss() }
                    }
                }
            }
        }
    }

    // MARK: - Gallery List

    private var galleryList: some View {
        ScrollView {
            VStack(spacing: 24) {
                ForEach(ScreenSection.allCases, id: \.rawValue) { section in
                    VStack(spacing: 8) {
                        sectionHeader(section.rawValue, count: section.screens.count)
                        ForEach(section.screens) { screen in
                            screenButton(screen, accent: section.accentColor)
                        }
                    }
                }
                Spacer().frame(height: 32)
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)
        }
        .scrollIndicators(.hidden)
    }

    private func sectionHeader(_ title: String, count: Int) -> some View {
        HStack {
            Text(title)
                .font(DesignTokens.bodyFont(size: 18, weight: .bold))
                .foregroundStyle(DesignTokens.textPrimary)
            Spacer()
            Text("\(count) screens")
                .font(DesignTokens.bodyFont(size: 13))
                .foregroundStyle(DesignTokens.textTertiary)
        }
    }

    private func screenButton(_ screen: ScreenPreview, accent: Color) -> some View {
        Button { activeScreen = screen } label: {
            HStack(spacing: 14) {
                Image(systemName: screen.icon)
                    .font(.system(size: 16))
                    .foregroundStyle(accent)
                    .frame(width: 24)
                Text(screen.rawValue)
                    .font(DesignTokens.bodyFont(size: 15, weight: .medium))
                    .foregroundStyle(DesignTokens.textPrimary)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(DesignTokens.textTertiary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(DesignTokens.surface)
            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
            .overlay(
                RoundedRectangle(cornerRadius: DesignTokens.radiusMedium)
                    .stroke(DesignTokens.border, lineWidth: 0.5)
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Screen Views

    @ViewBuilder
    private func screenView(for screen: ScreenPreview) -> some View {
        switch screen {
        // Pre-auth
        case .splash: splashDemo
        case .onboarding: onboardingDemo
        case .nameEntry:
            InlineNamePromptView(
                selectedType: .song,
                preselectedOccasion: demoOccasion,
                hasOwnLyrics: .constant(false),
                isInstrumental: .constant(false),
                onStart: { _, _ in activeScreen = nil },
                onCancel: { activeScreen = nil }
            )
        case .auth: authDemo
        case .phoneEntry: phoneEntryDemo
        case .phoneVerify: phoneVerifyDemo
        case .profileComplete: profileCompleteDemo

        // Create flow
        case .tell: tellDemoView
        case .tellLyrics: tellLyricsDemoView
        case .wait: WaitPulseView(recipientName: demoRecipient, occasion: demoOccasion)
        case .reveal:
            RevealBloomView(
                recipientName: demoRecipient,
                occasion: "Happy Birthday 🎂",
                onPlay: {}, onShare: {}, onEditLyrics: {}, onSaveToLibrary: {}
            )
        case .lyricsReview: lyricsReviewDemoView
        case .share:
            SharePostcardView(
                recipientName: demoRecipient, occasion: demoOccasion,
                onSend: {}, onSaveToPhotos: {}, onCopyLink: {},
                onSkip: { activeScreen = nil }
            )

        // Tabs
        case .home: homeDemoView
        case .songs: songsDemoView
        case .poems: poemsDemoView
        case .settings: settingsDemoView

        // Voice
        case .voiceIntro: voiceIntroDemoView
        case .voiceRecording: voiceRecordingDemoView
        case .voiceProcessing: voiceProcessingDemoView
        case .voiceComplete: voiceCompleteDemoView

        // Other
        case .subscription: subscriptionDemoView
        case .nowPlaying: nowPlayingDemoView
        case .poemDetail: poemDetailDemoView
        case .shareClaim: shareClaimDemoView

        // Errors
        case .tellError:
            TellConnectionErrorView(onPrimaryAction: { activeScreen = nil }, onSecondaryAction: { activeScreen = nil })
        case .tellModeration:
            TellModerationErrorView(onPrimaryAction: { activeScreen = nil }, onSecondaryAction: { activeScreen = nil })
        case .waitTimeout:
            WaitTimeoutErrorView(onPrimaryAction: { activeScreen = nil }, onSecondaryAction: { activeScreen = nil })
        case .waitFailure:
            WaitFailureErrorView(recipientName: demoRecipient, onPrimaryAction: { activeScreen = nil }, onSecondaryAction: { activeScreen = nil })
        case .revealFailure:
            RevealPartialErrorView(onListenToPreview: { activeScreen = nil }, onTryFullSong: { activeScreen = nil }, onContactSupport: { activeScreen = nil })
        case .shareFailure:
            ShareFailureView(onTryAgain: { activeScreen = nil }, onCopyLink: { activeScreen = nil })
        case .noCredits:
            NoCreditsView(onUpgrade: { activeScreen = nil }, onRestore: { activeScreen = nil }, onDismiss: { activeScreen = nil })
        }
    }

    // MARK: - Pre-Auth Demo Views

    private var splashDemo: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()
            VStack(spacing: 16) {
                Circle()
                    .fill(DesignTokens.gold)
                    .frame(width: 96, height: 96)
                    .overlay(
                        Image(systemName: "mic.fill")
                            .font(.system(size: 40))
                            .foregroundStyle(.white)
                    )
                Text("porizo")
                    .font(DesignTokens.displayFont(size: 24))
                    .italic()
                    .foregroundStyle(DesignTokens.gold)
            }
        }
    }

    private var onboardingDemo: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()
            VStack(spacing: 24) {
                Spacer()
                Circle()
                    .fill(DesignTokens.gold)
                    .frame(width: 56, height: 56)
                    .overlay(
                        Image(systemName: "mic.fill")
                            .font(.system(size: 28))
                            .foregroundStyle(.white)
                    )
                Text("Hear what a birthday\nsounds like")
                    .font(DesignTokens.displayFont(size: 22))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .multilineTextAlignment(.center)
                // Audio player mock
                HStack(spacing: 12) {
                    Circle()
                        .fill(DesignTokens.gold)
                        .frame(width: 44, height: 44)
                        .overlay(Image(systemName: "play.fill").font(.system(size: 16)).foregroundStyle(.white))
                    VStack(alignment: .leading, spacing: 4) {
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                RoundedRectangle(cornerRadius: 2).fill(DesignTokens.border).frame(height: 4)
                                RoundedRectangle(cornerRadius: 2).fill(DesignTokens.gold).frame(width: geo.size.width * 0.53, height: 4)
                            }
                        }
                        .frame(height: 4)
                        Text("0:08 / 0:15")
                            .font(DesignTokens.bodyFont(size: 12))
                            .foregroundStyle(DesignTokens.textTertiary)
                    }
                }
                .padding(16)
                .background(DesignTokens.surface)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .padding(.horizontal, 40)

                Text("Make one in 90 seconds")
                    .font(DesignTokens.bodyFont(size: 14, weight: .semibold))
                    .foregroundStyle(DesignTokens.gold)
                Spacer()
                VStack(spacing: 12) {
                    coralButton("Create a Song")
                    Button {} label: {
                        Text("Sign in")
                            .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                            .foregroundStyle(DesignTokens.gold)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 40)
            }
        }
    }

    private var authDemo: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()
            VStack(spacing: 20) {
                Spacer()
                Circle()
                    .fill(DesignTokens.gold)
                    .frame(width: 48, height: 48)
                    .overlay(Image(systemName: "mic.fill").font(.system(size: 24)).foregroundStyle(.white))
                Text("Sign in to create\nyour song")
                    .font(DesignTokens.displayFont(size: 22))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .multilineTextAlignment(.center)
                Text("It takes about 90 seconds")
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundStyle(DesignTokens.textSecondary)
                Spacer()
                VStack(spacing: 12) {
                    Button {} label: {
                        HStack(spacing: 8) {
                            Image(systemName: "apple.logo")
                            Text("Sign in with Apple")
                        }
                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(.black)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                    }
                    Button {} label: {
                        HStack(spacing: 8) {
                            Text("📱")
                            Text("Continue with Phone")
                        }
                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        .foregroundStyle(DesignTokens.gold)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(.clear)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14).stroke(DesignTokens.gold, lineWidth: 1.5))
                    }
                    Text("By continuing, you agree to Porizo's\nTerms of Service and Privacy Policy")
                        .font(DesignTokens.bodyFont(size: 11))
                        .foregroundStyle(DesignTokens.textTertiary)
                        .multilineTextAlignment(.center)
                        .padding(.top, 8)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 40)
            }
        }
    }

    private var phoneEntryDemo: some View {
        navScreen(title: "Your Phone Number", subtitle: "We'll send you a verification code") {
            VStack(spacing: 20) {
                HStack(spacing: 8) {
                    Text("🇺🇸 +1")
                        .font(DesignTokens.bodyFont(size: 16))
                        .padding(.horizontal, 12).padding(.vertical, 14)
                        .background(DesignTokens.surface)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(DesignTokens.border, lineWidth: 1.5))
                    TextField("(555) 123-4567", text: .constant("(555) 123-4567"))
                        .font(DesignTokens.bodyFont(size: 16))
                        .padding(.horizontal, 16).padding(.vertical, 14)
                        .background(DesignTokens.surface)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(DesignTokens.border, lineWidth: 1.5))
                }
                coralButton("Continue")
            }
        }
    }

    private var phoneVerifyDemo: some View {
        navScreen(title: "Enter verification code", subtitle: "Sent to +1 (555) ***-4567") {
            VStack(spacing: 20) {
                HStack(spacing: 8) {
                    ForEach(["4","8","2","9","1","6"], id: \.self) { digit in
                        Text(digit)
                            .font(.system(size: 24, weight: .semibold, design: .monospaced))
                            .foregroundStyle(DesignTokens.textPrimary)
                            .frame(width: 44, height: 56)
                            .background(DesignTokens.surface)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(DesignTokens.border, lineWidth: 1.5))
                    }
                }
                coralButton("Verify")
                HStack(spacing: 16) {
                    textLink("Resend code")
                    textLink("Wrong number?", secondary: true)
                }
            }
        }
    }

    private var profileCompleteDemo: some View {
        navScreen(title: "Complete your profile", subtitle: "Add your email to sync across devices") {
            VStack(spacing: 20) {
                TextField("your@email.com", text: .constant(""))
                    .font(DesignTokens.bodyFont(size: 16))
                    .padding(.horizontal, 16).padding(.vertical, 14)
                    .background(DesignTokens.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(DesignTokens.border, lineWidth: 1.5))
                coralButton("Continue")
                textLink("Skip for now")
            }
        }
    }

    // MARK: - Tab Demo Views

    private var homeDemoView: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Explore")
                        .font(DesignTokens.displayFont(size: 28))
                        .foregroundStyle(DesignTokens.textPrimary)
                        .padding(.top, 68)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Every moment deserves\na song")
                            .font(DesignTokens.displayFont(size: 20))
                            .foregroundStyle(DesignTokens.textPrimary)
                        Text("Create something personal")
                            .font(DesignTokens.bodyFont(size: 14))
                            .foregroundStyle(DesignTokens.textSecondary)
                        coralButton("✦ Create for someone special")
                            .padding(.top, 12)
                    }
                    Text("Create for an Occasion")
                        .font(DesignTokens.bodyFont(size: 18, weight: .bold))
                        .foregroundStyle(DesignTokens.textPrimary)
                    ScrollView(.horizontal) {
                        HStack(spacing: 8) {
                            ForEach(["🎂 Birthday","💝 Anniversary","🙏 Thank You","💍 Wedding","🎓 Graduation","❤️ I Love You"], id: \.self) { label in
                                occasionChip(label)
                            }
                        }
                    }
                    .scrollIndicators(.hidden)
                    Text("Recent Songs")
                        .font(DesignTokens.bodyFont(size: 18, weight: .bold))
                        .foregroundStyle(DesignTokens.textPrimary)
                        .padding(.top, 8)
                    songCard(name: "For Sarah", meta: "Birthday Song • Ready • 2 min ago")
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 100)
            }
            .scrollIndicators(.hidden)
            tabBar(selected: "Home")
        }
        .background(DesignTokens.background)
    }

    private var songsDemoView: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text("My Songs")
                        .font(DesignTokens.displayFont(size: 28))
                        .foregroundStyle(DesignTokens.textPrimary)
                        .padding(.top, 68)
                    segmentToggle(["My Songs", "Received"])
                    songCard(name: "For Sarah", meta: "Birthday Song • Ready • 2 min ago")
                    songCard(name: "For Mom", meta: "Anniversary Song • Ready • 1 week ago")
                    songCard(name: "For David", meta: "Thank You • Creating...")
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 100)
            }
            .scrollIndicators(.hidden)
            tabBar(selected: "Songs")
        }
        .background(DesignTokens.background)
    }

    private var poemsDemoView: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text("My Poems")
                        .font(DesignTokens.displayFont(size: 28))
                        .foregroundStyle(DesignTokens.textPrimary)
                        .padding(.top, 68)
                    segmentToggle(["My Poems", "Received"])
                    poemCard(name: "For Sarah", occasion: "🎂 Birthday", title: "Birthday Poem",
                             preview: "Roses are red, violets are blue,\nSarah's laughter fills every room...")
                    poemCard(name: "For Lisa", occasion: "🙏 Thank You", title: "Thank You Poem",
                             preview: "Words cannot express the joy you bring,\nA heart so kind, a soul that sings...")
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 100)
            }
            .scrollIndicators(.hidden)
            tabBar(selected: "Poems")
        }
        .background(DesignTokens.background)
    }

    private var settingsDemoView: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Settings")
                        .font(DesignTokens.displayFont(size: 28))
                        .foregroundStyle(DesignTokens.textPrimary)
                        .padding(.top, 68)
                        .padding(.bottom, 12)
                        .padding(.horizontal, 20)
                    // Voice banner
                    HStack(spacing: 14) {
                        Circle().fill(Color.white.opacity(0.2)).frame(width: 48, height: 48)
                            .overlay(Image(systemName: "mic.fill").foregroundStyle(.white))
                        VStack(alignment: .leading) {
                            Text("Your Voice").font(DesignTokens.bodyFont(size: 16, weight: .semibold)).foregroundStyle(.white)
                            Text("Set up your voice").font(DesignTokens.bodyFont(size: 13)).foregroundStyle(.white.opacity(0.8))
                        }
                        Spacer()
                        Text("Set Up").font(DesignTokens.bodyFont(size: 13, weight: .semibold)).foregroundStyle(DesignTokens.gold)
                            .padding(.horizontal, 16).padding(.vertical, 8)
                            .background(.white).clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    .padding(16)
                    .background(LinearGradient(colors: [DesignTokens.gold, DesignTokens.goldGradientEnd], startPoint: .topLeading, endPoint: .bottomTrailing))
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                    .padding(.horizontal, 20).padding(.bottom, 12)
                    // Sections
                    settingsSection("ACCOUNT", rows: [("SJ", "Sarah Johnson", "sarah@email.com"), ("👑", "My Subscription", "Free")])
                    settingsSection("PREFERENCES", rows: [("🎨", "Appearance", "Light"), ("🎤", "Lyrics Style", "Karaoke"), ("🌐", "Language", "English")])
                    settingsSection("SUPPORT", rows: [("💬", "Get Support", ""), ("👥", "Invite a Friend", "")])
                    settingsSection("LEGAL", rows: [("📄", "Terms of Use", ""), ("🔒", "Privacy Policy", ""), ("🔄", "Restore Purchases", "")])
                    Text("PORIZO • 2026 • v2.0")
                        .font(DesignTokens.bodyFont(size: 12))
                        .foregroundStyle(DesignTokens.textTertiary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 20)
                }
                .padding(.bottom, 100)
            }
            .scrollIndicators(.hidden)
            tabBar(selected: "Settings")
        }
        .background(DesignTokens.background)
    }

    // MARK: - Voice Demo Views

    private var voiceIntroDemoView: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()
            VStack(spacing: 0) {
                // Back button
                HStack {
                    Button { activeScreen = nil } label: {
                        Image(systemName: "arrow.left").font(.system(size: 18)).foregroundStyle(DesignTokens.textPrimary)
                            .frame(width: 44, height: 44).background(Color.black.opacity(0.05)).clipShape(Circle())
                    }
                    Spacer()
                }
                .padding(.horizontal, 20).padding(.top, 56)

                Spacer()

                Circle().fill(DesignTokens.gold).frame(width: 64, height: 64)
                    .overlay(Image(systemName: "mic.fill").font(.system(size: 32)).foregroundStyle(.white))

                VStack(spacing: DesignTokens.spacing12) {
                    Text("Make it sound\nlike you")
                        .font(DesignTokens.displayFont(size: 24))
                        .foregroundStyle(DesignTokens.textPrimary)
                        .multilineTextAlignment(.center)
                    Text("Record a few phrases and your songs will sing in your voice")
                        .font(DesignTokens.bodyFont(size: 15))
                        .foregroundStyle(DesignTokens.textSecondary)
                        .multilineTextAlignment(.center)
                }
                .padding(.horizontal, 32).padding(.top, DesignTokens.spacing16)

                // 3-step indicator with connectors
                HStack(spacing: 0) {
                    ForEach([(1,"Record\nphrases"),(2,"We\nprocess"),(3,"Songs in\nyour voice")], id: \.0) { step, label in
                        if step > 1 {
                            Rectangle().fill(DesignTokens.textTertiary.opacity(0.3)).frame(height: 2).frame(maxWidth: 32)
                        }
                        VStack(spacing: 6) {
                            Circle().fill(DesignTokens.gold.opacity(0.1)).frame(width: 44, height: 44)
                                .overlay(Text("\(step)").font(DesignTokens.bodyFont(size: 16, weight: .semibold)).foregroundStyle(DesignTokens.gold))
                            Text(label).font(DesignTokens.bodyFont(size: 12)).foregroundStyle(DesignTokens.textSecondary).multilineTextAlignment(.center)
                        }
                    }
                }
                .padding(.top, 32)

                Spacer()

                VStack(spacing: DesignTokens.spacing16) {
                    coralButton("Start Recording")
                    textLink("Maybe later", secondary: true)
                }
                .padding(.horizontal, 20).padding(.bottom, 40)
            }
        }
    }

    private var voiceRecordingDemoView: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()
            VStack(spacing: 20) {
                HStack {
                    Text("Phrase 1 of 6").font(DesignTokens.bodyFont(size: 16, weight: .semibold)).foregroundStyle(DesignTokens.textPrimary)
                    Spacer()
                    Button { activeScreen = nil } label: {
                        Image(systemName: "xmark").font(.system(size: 13, weight: .semibold)).foregroundStyle(DesignTokens.textSecondary)
                            .frame(width: 30, height: 30).background(Color.black.opacity(0.05)).clipShape(Circle())
                    }
                }
                .padding(.horizontal, 20).padding(.top, 68)
                // Progress dots
                HStack(spacing: 6) {
                    ForEach(0..<6, id: \.self) { i in
                        Circle().fill(i == 0 ? DesignTokens.gold : DesignTokens.border).frame(width: 8, height: 8)
                    }
                }
                Spacer()
                Text("The quick brown fox jumps over the lazy dog")
                    .font(DesignTokens.displayFont(size: 20))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .multilineTextAlignment(.center)
                    .padding(24)
                    .background(DesignTokens.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .padding(.horizontal, 20)
                // Level meter
                HStack(spacing: 4) {
                    ForEach([15,25,35,25,15], id: \.self) { h in
                        RoundedRectangle(cornerRadius: 2).fill(DesignTokens.gold).frame(width: 4, height: CGFloat(h))
                    }
                }
                .frame(height: 40)
                // Record button
                Circle().fill(DesignTokens.gold).frame(width: 72, height: 72)
                    .overlay(Image(systemName: "mic.fill").font(.system(size: 28)).foregroundStyle(.white))
                Text("Tap to record").font(DesignTokens.bodyFont(size: 13)).foregroundStyle(DesignTokens.textTertiary)
                Spacer()
                coralButton("Next →").opacity(0.4).padding(.horizontal, 20)
                    .padding(.bottom, 32)
            }
        }
    }

    @State private var galleryProcessingStatusIndex = 0

    private var voiceProcessingDemoView: some View {
        let statuses = ["Analyzing quality...", "Checking clarity...", "Building voice model...", "Almost done..."]
        return ZStack {
            DesignTokens.background.ignoresSafeArea()
            VStack(spacing: 20) {
                ProgressView().tint(DesignTokens.gold).scaleEffect(1.5)
                Text("Processing your voice...")
                    .font(DesignTokens.displayFont(size: 20))
                    .foregroundStyle(DesignTokens.textPrimary)
                Text("This takes about 30 seconds")
                    .font(DesignTokens.bodyFont(size: 13))
                    .foregroundStyle(DesignTokens.textTertiary)
                Text(statuses[galleryProcessingStatusIndex % statuses.count])
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .animation(.easeInOut(duration: 0.4), value: galleryProcessingStatusIndex)
            }
        }
        .task {
            galleryProcessingStatusIndex = 0
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(2.5))
                galleryProcessingStatusIndex += 1
            }
        }
    }

    private var voiceCompleteDemoView: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()
            VStack(spacing: 16) {
                Spacer()
                Circle().fill(DesignTokens.sage).frame(width: 64, height: 64)
                    .overlay(Image(systemName: "checkmark").font(.system(size: 28, weight: .semibold)).foregroundStyle(.white))
                Text("Voice enrolled!")
                    .font(DesignTokens.displayFont(size: 24))
                    .foregroundStyle(DesignTokens.textPrimary)
                VStack(spacing: 8) {
                    Text("Quality: 85/100").font(DesignTokens.bodyFont(size: 14)).foregroundStyle(DesignTokens.textSecondary)
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            RoundedRectangle(cornerRadius: 4).fill(DesignTokens.border).frame(height: 8)
                            RoundedRectangle(cornerRadius: 4).fill(DesignTokens.sage).frame(width: geo.size.width * 0.85, height: 8)
                        }
                    }
                    .frame(height: 8)
                }
                .frame(width: 260)
                Text("Excellent — your songs will sound great")
                    .font(DesignTokens.bodyFont(size: 15))
                    .foregroundStyle(DesignTokens.sage)
                    .multilineTextAlignment(.center)
                Spacer()
                coralButton("Done").padding(.horizontal, 20).padding(.bottom, 40)
            }
        }
    }

    // MARK: - Other Demo Views

    private var subscriptionDemoView: some View {
        navScreen(title: "Subscription", subtitle: "") {
            VStack(spacing: 16) {
                Text("3 credits remaining")
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    .foregroundStyle(DesignTokens.gold)
                segmentToggle(["Monthly", "Annual SAVE 40%"])
                planCard(name: "Free", price: "$0 / month", features: ["3 songs/month","AI voice only","Preview quality"], isCurrent: true)
                planCard(name: "Pro", price: "$9.99 / month", features: ["20 songs/month","Your voice","Full quality","HD downloads"], isCurrent: false)
                planCard(name: "Ultimate", price: "$19.99 / month", features: ["Unlimited songs","Priority render","All features"], isCurrent: false)
                textLink("Restore Purchases", secondary: true)
            }
        }
    }

    private var nowPlayingDemoView: some View {
        VStack(spacing: 0) {
            navBar(title: "Now Playing")
            ScrollView {
                VStack(spacing: 16) {
                    // Album art
                    RoundedRectangle(cornerRadius: 20)
                        .fill(LinearGradient(colors: [DesignTokens.gold, DesignTokens.goldGradientEnd], startPoint: .topLeading, endPoint: .bottomTrailing))
                        .frame(height: 280)
                        .overlay(Text("🎂").font(.system(size: 48)))
                    VStack(spacing: 4) {
                        Text("For Sarah").font(DesignTokens.displayFont(size: 24)).foregroundStyle(DesignTokens.textPrimary)
                        Text("Birthday Song • Pop • 1:24").font(DesignTokens.bodyFont(size: 14)).foregroundStyle(DesignTokens.textSecondary)
                    }
                    // Scrubber
                    VStack(spacing: 4) {
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                RoundedRectangle(cornerRadius: 2).fill(DesignTokens.border).frame(height: 4)
                                RoundedRectangle(cornerRadius: 2).fill(DesignTokens.gold).frame(width: geo.size.width * 0.4, height: 4)
                                Circle().fill(DesignTokens.gold).frame(width: 12, height: 12).offset(x: geo.size.width * 0.4 - 6)
                            }
                        }.frame(height: 12)
                        HStack { Text("0:33").font(DesignTokens.bodyFont(size: 11)).foregroundStyle(DesignTokens.textTertiary); Spacer(); Text("1:24").font(DesignTokens.bodyFont(size: 11)).foregroundStyle(DesignTokens.textTertiary) }
                    }
                    // Transport
                    HStack(spacing: 32) {
                        Image(systemName: "backward.fill").font(.system(size: 24)).foregroundStyle(DesignTokens.textSecondary)
                        Circle().fill(DesignTokens.gold).frame(width: 56, height: 56)
                            .overlay(Image(systemName: "play.fill").font(.system(size: 22)).foregroundStyle(.white))
                        Image(systemName: "forward.fill").font(.system(size: 24)).foregroundStyle(DesignTokens.textSecondary)
                    }
                    // Actions
                    HStack(spacing: 24) {
                        actionButton(icon: "heart", label: "Like")
                        actionButton(icon: "square.and.arrow.up", label: "Share")
                        actionButton(icon: "ellipsis", label: "More")
                    }
                    .padding(.top, 8)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 32)
            }
            .scrollIndicators(.hidden)
        }
        .background(DesignTokens.background)
    }

    private var poemDetailDemoView: some View {
        VStack(spacing: 0) {
            Spacer().frame(height: 20)
            ScrollView {
                VStack(spacing: 20) {
                    // Poem card
                    VStack(spacing: 16) {
                        Text("For Sarah").font(DesignTokens.displayFont(size: 28)).foregroundStyle(DesignTokens.textPrimary)
                        chipBadge("🎂 Birthday", style: .coral)
                        dividerLine
                        Text("Roses are red, violets are blue,\nSarah's laughter fills every room,\nWith bone apple tea and jokes so bright,\nYou make every dinner a pure delight.")
                            .font(DesignTokens.displayFont(size: 16))
                            .italic()
                            .foregroundStyle(DesignTokens.textPrimary)
                            .lineSpacing(6)
                            .multilineTextAlignment(.center)
                        dividerLine
                        Text("From: You").font(DesignTokens.bodyFont(size: 13)).foregroundStyle(DesignTokens.textTertiary)
                    }
                    .padding(32)
                    .background(DesignTokens.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 24))
                    .overlay(RoundedRectangle(cornerRadius: 24).stroke(DesignTokens.gold.opacity(0.3), lineWidth: 1))
                    .padding(.horizontal, 20)

                    HStack(spacing: 12) {
                        Button {} label: {
                            Text("Listen").font(DesignTokens.bodyFont(size: 16, weight: .semibold)).foregroundStyle(DesignTokens.textPrimary)
                                .frame(maxWidth: .infinity).padding(.vertical, 14)
                                .background(DesignTokens.surface)
                                .clipShape(RoundedRectangle(cornerRadius: 25))
                                .overlay(RoundedRectangle(cornerRadius: 25).stroke(DesignTokens.border, lineWidth: 1))
                        }
                        coralButton("Share")
                    }
                    .padding(.horizontal, 20)
                }
                .padding(.bottom, 32)
            }
            .scrollIndicators(.hidden)
        }
        .background(DesignTokens.background)
    }

    private var shareClaimDemoView: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()
            VStack(spacing: 16) {
                Spacer()
                Circle().fill(DesignTokens.gold).frame(width: 48, height: 48)
                    .overlay(Image(systemName: "mic.fill").font(.system(size: 24)).foregroundStyle(.white))
                Text("Sarah sent you a song")
                    .font(DesignTokens.displayFont(size: 22))
                    .foregroundStyle(DesignTokens.textPrimary)
                Text("A Birthday Song, made just for you")
                    .font(DesignTokens.bodyFont(size: 15))
                    .foregroundStyle(DesignTokens.textSecondary)
                // Mini postcard
                VStack(spacing: 8) {
                    Text("For You").font(DesignTokens.displayFont(size: 20)).foregroundStyle(.white)
                    StaticWaveformBars(heights: [6, 10, 16, 20, 16, 10, 6], barWidth: 3, spacing: 4)
                    Text("Happy Birthday").font(DesignTokens.bodyFont(size: 14)).foregroundStyle(.white.opacity(0.8))
                }
                .padding(24)
                .frame(maxWidth: 300)
                .background(LinearGradient(colors: [DesignTokens.gold, DesignTokens.goldGradientEnd], startPoint: .topLeading, endPoint: .bottomTrailing))
                .clipShape(RoundedRectangle(cornerRadius: 16))
                Spacer()
                VStack(spacing: 12) {
                    coralButton("▶ Listen Now")
                    Text("or enter the sender's PIN")
                        .font(DesignTokens.bodyFont(size: 13))
                        .foregroundStyle(DesignTokens.textSecondary)
                    Text("Don't have the app? Download Porizo")
                        .font(DesignTokens.bodyFont(size: 13))
                        .foregroundStyle(DesignTokens.textSecondary)
                    Text("Make one for someone you love →")
                        .font(DesignTokens.bodyFont(size: 13))
                        .foregroundStyle(DesignTokens.gold)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 40)
            }
        }
    }

    // MARK: - Tell Demo Views (existing)

    private var tellDemoView: some View {
        VStack(spacing: 0) {
            chatHeader
            ScrollView {
                VStack(spacing: 12) {
                    aiBubble("What's a memory with \(demoRecipient) that always makes you smile? 😊")
                    userBubble("She always makes everyone laugh at dinner parties with her terrible jokes")
                    aiBubble("That's so sweet! What's your favorite of her terrible jokes?")
                    userBubble("She once tried to say 'bon appetit' and said 'bone apple tea' and we all died laughing 😂")
                    aiBubble("I love that! Your song will capture that warmth and laughter. Ready to create?")
                    HStack(spacing: 8) { actionChip("Add more", isSelected: false); actionChip("That's enough ✓", isSelected: true) }.padding(.top, 4)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 140)
            }
            .scrollIndicators(.hidden)
            stylePickerBar
            inputBar
        }
        .background(DesignTokens.background)
    }

    private var tellLyricsDemoView: some View {
        VStack(spacing: 0) {
            chatHeader
            ScrollView {
                VStack(spacing: 12) {
                    aiBubble("What's a memory with \(demoRecipient) that always makes you smile? 😊")
                    userBubble("She always makes everyone laugh at dinner parties with her terrible jokes")
                    aiBubble("That's so sweet! What's your favorite of her terrible jokes?")
                    userBubble("She once tried to say 'bon appetit' and said 'bone apple tea' and we all died laughing 😂")
                    aiBubble("Here are the lyrics I wrote for \(demoRecipient)'s birthday song! 🎵")
                    inlineLyricsCard
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 32)
            }
            .scrollIndicators(.hidden)
        }
        .background(DesignTokens.background)
    }

    private var lyricsReviewDemoView: some View {
        VStack(spacing: 0) {
            navBar(title: "Review Lyrics")
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 6) { chipBadge("For \(demoRecipient)", style: .coral); chipBadge(demoOccasion, style: .coral); chipBadge("Pop", style: .sage) }
                    lyricsReviewSection("VERSE 1", lines: demoVerse1, showEdit: true)
                    lyricsReviewSection("CHORUS", lines: demoChorus, showEdit: false)
                    lyricsReviewSection("VERSE 2", lines: demoVerse2, showEdit: true)
                    coralButton("Create new version").padding(.top, 4)
                    Button {} label: { Text("Regenerate lyrics").font(DesignTokens.bodyFont(size: 14, weight: .medium)).foregroundStyle(DesignTokens.textSecondary).frame(maxWidth: .infinity) }.padding(.top, 4)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 32)
            }
            .scrollIndicators(.hidden)
        }
        .background(DesignTokens.background)
    }

    // MARK: - Shared Components

    private var chatHeader: some View {
        HStack {
            Text("For \(demoRecipient)").font(DesignTokens.displayFont(size: 20)).foregroundStyle(DesignTokens.textPrimary)
            Spacer()
            HStack(spacing: 6) { chipBadge(demoOccasion, style: .coral); chipBadge("Pop", style: .sage) }
            Button { activeScreen = nil } label: {
                Image(systemName: "xmark").font(.system(size: 13, weight: .semibold)).foregroundStyle(DesignTokens.textSecondary)
                    .frame(width: 30, height: 30).background(Color.black.opacity(0.05)).clipShape(Circle())
            }
        }
        .padding(.horizontal, 20).padding(.top, 16).padding(.bottom, 8)
    }

    private var stylePickerBar: some View {
        HStack {
            Text("🎵 Style: Pop").font(DesignTokens.bodyFont(size: 16, weight: .semibold)).foregroundStyle(DesignTokens.textPrimary)
            Spacer()
            Image(systemName: "chevron.down").font(.system(size: 12)).foregroundStyle(DesignTokens.textTertiary)
        }
        .padding(.horizontal, 20).padding(.vertical, 14)
        .background(DesignTokens.surface)
        .overlay(alignment: .top) { Rectangle().fill(DesignTokens.border).frame(height: 1) }
    }

    private var inputBar: some View {
        HStack(spacing: 8) {
            TextField("Tell me more...", text: .constant(""))
                .font(DesignTokens.bodyFont(size: 14))
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(DesignTokens.surface)
                .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium))
                .overlay(RoundedRectangle(cornerRadius: DesignTokens.radiusMedium).stroke(DesignTokens.border, lineWidth: 0.5))
            Circle().fill(DesignTokens.sage).frame(width: 36, height: 36)
                .overlay(Image(systemName: "arrow.up").font(.system(size: 16, weight: .semibold)).foregroundStyle(.white))
        }
        .padding(.horizontal, 20).padding(.vertical, 10)
        .background(DesignTokens.background)
        .overlay(alignment: .top) { Rectangle().fill(DesignTokens.border).frame(height: 1) }
    }

    private var inlineLyricsCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("🎵 Song Lyrics").font(DesignTokens.bodyFont(size: 15, weight: .semibold)).foregroundStyle(DesignTokens.textPrimary)
                Spacer()
                Text("Regenerate").font(DesignTokens.bodyFont(size: 13, weight: .medium)).foregroundStyle(DesignTokens.gold)
            }
            lyricsSection("VERSE 1", lines: demoVerse1)
            lyricsSection("CHORUS", lines: demoChorus)
            lyricsSection("VERSE 2", lines: demoVerse2)
            coralButton("Create my song ✦").padding(.top, 4)
        }
        .padding(16)
        .background(DesignTokens.surface)
        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
        .overlay(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA).stroke(DesignTokens.gold.opacity(0.2), lineWidth: 1))
    }

    // Demo lyrics data
    private let demoVerse1 = ["She walks into the room with laughter in her eyes","Bone apple tea she'd say and everyone would cry","With tears of joy and stories that we'd share","There's nobody quite like her anywhere"]
    private let demoChorus = ["Sarah, Sarah, you light up every room","Your laughter is a melody, your smile makes flowers bloom"]
    private let demoVerse2 = ["From dinner parties to the stories that we share","Your terrible jokes floating through the air","We wouldn't trade a single one","'Cause you make everything more fun"]

    // MARK: - Reusable Helpers

    private func navScreen(title: String, subtitle: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(spacing: 0) {
            if !title.isEmpty { navBar(title: "") }
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if !title.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(title).font(DesignTokens.bodyFont(size: 20, weight: .bold)).foregroundStyle(DesignTokens.textPrimary)
                            if !subtitle.isEmpty { Text(subtitle).font(DesignTokens.bodyFont(size: 14)).foregroundStyle(DesignTokens.textSecondary) }
                        }
                    }
                    content()
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 32)
            }
            .scrollIndicators(.hidden)
        }
        .background(DesignTokens.background)
    }

    private func navBar(title: String) -> some View {
        HStack {
            Button { activeScreen = nil } label: {
                ZStack { Circle().fill(Color.black.opacity(0.05)).frame(width: 44, height: 44)
                    Image(systemName: "arrow.left").font(.system(size: 18)).foregroundStyle(DesignTokens.textPrimary) }
            }
            Spacer()
            Text(title).font(.system(size: 17, weight: .semibold)).foregroundStyle(DesignTokens.textPrimary)
            Spacer()
            Color.clear.frame(width: 44, height: 44)
        }
        .padding(.horizontal, 20).padding(.top, 56).padding(.bottom, 8)
    }

    private func coralButton(_ label: String) -> some View {
        Button {} label: {
            Text(label).font(DesignTokens.bodyFont(size: 16, weight: .semibold)).foregroundStyle(.white)
                .frame(maxWidth: .infinity).padding(.vertical, 16)
                .background(DesignTokens.gold).clipShape(RoundedRectangle(cornerRadius: 14))
        }
    }

    private func textLink(_ label: String, secondary: Bool = false) -> some View {
        Button {} label: {
            Text(label).font(DesignTokens.bodyFont(size: 14, weight: .medium))
                .foregroundStyle(secondary ? DesignTokens.textSecondary : DesignTokens.gold)
        }
    }

    private func tabBar(selected: String) -> some View {
        HStack {
            ForEach([("house","Home"),("music.note","Songs"),("scroll","Poems"),("gearshape","Settings")], id: \.1) { icon, label in
                VStack(spacing: 3) {
                    Image(systemName: icon).font(.system(size: 22))
                    Text(label).font(DesignTokens.bodyFont(size: 10, weight: .medium))
                }
                .foregroundStyle(label == selected ? DesignTokens.gold : DesignTokens.textTertiary)
                .frame(maxWidth: .infinity)
            }
        }
        .padding(.top, 8)
        .frame(height: 83)
        .background(DesignTokens.surface)
        .overlay(alignment: .top) { Rectangle().fill(DesignTokens.border).frame(height: 1) }
    }

    private func songCard(name: String, meta: String) -> some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 10).fill(LinearGradient(colors: [DesignTokens.gold, DesignTokens.goldGradientEnd], startPoint: .topLeading, endPoint: .bottomTrailing))
                .frame(width: 56, height: 56).overlay(Text("🎵").font(.system(size: 20)))
            VStack(alignment: .leading, spacing: 2) {
                Text(name).font(DesignTokens.bodyFont(size: 15, weight: .semibold)).foregroundStyle(DesignTokens.textPrimary)
                Text(meta).font(DesignTokens.bodyFont(size: 13)).foregroundStyle(DesignTokens.textTertiary)
            }
            Spacer()
            Circle().fill(DesignTokens.background).frame(width: 44, height: 44)
                .overlay(Image(systemName: "play.fill").font(.system(size: 14)).foregroundStyle(DesignTokens.gold))
        }
        .padding(12).background(DesignTokens.surface).clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(DesignTokens.border, lineWidth: 1))
    }

    private func poemCard(name: String, occasion: String, title: String, preview: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack { Text(name).font(DesignTokens.bodyFont(size: 15, weight: .semibold)).foregroundStyle(DesignTokens.textPrimary); Spacer(); chipBadge(occasion, style: .coral) }
            Text(title).font(DesignTokens.bodyFont(size: 13)).foregroundStyle(DesignTokens.textSecondary)
            Text(preview).font(DesignTokens.displayFont(size: 14)).italic().foregroundStyle(DesignTokens.textSecondary).lineSpacing(4).lineLimit(2)
        }
        .padding(14).background(DesignTokens.surface).clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(DesignTokens.border, lineWidth: 1))
    }

    private func occasionChip(_ label: String) -> some View {
        Text(label).font(DesignTokens.bodyFont(size: 13, weight: .medium)).foregroundStyle(DesignTokens.textPrimary)
            .padding(.horizontal, 14).padding(.vertical, 6)
            .background(DesignTokens.surface).clipShape(Capsule())
            .overlay(Capsule().stroke(DesignTokens.border, lineWidth: 1.5))
    }

    private func segmentToggle(_ labels: [String]) -> some View {
        HStack(spacing: 0) {
            ForEach(Array(labels.enumerated()), id: \.offset) { i, label in
                Text(label).font(DesignTokens.bodyFont(size: 14, weight: .medium))
                    .foregroundStyle(i == 0 ? DesignTokens.gold : DesignTokens.textSecondary)
                    .frame(maxWidth: .infinity).padding(.vertical, 10)
                    .background(i == 0 ? DesignTokens.gold.opacity(0.1) : .clear)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }
        }
        .padding(4).background(DesignTokens.surface).clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(DesignTokens.border, lineWidth: 1))
    }

    private func planCard(name: String, price: String, features: [String], isCurrent: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack { Text(name).font(DesignTokens.bodyFont(size: 16, weight: .semibold)).foregroundStyle(DesignTokens.gold); Spacer()
                if isCurrent { chipBadge("Current", style: .sage) } }
            Text(price).font(DesignTokens.bodyFont(size: 14)).foregroundStyle(DesignTokens.textSecondary)
            ForEach(features, id: \.self) { f in
                Text("• \(f)").font(DesignTokens.bodyFont(size: 13)).foregroundStyle(DesignTokens.textSecondary)
            }
            if !isCurrent { coralButton("Subscribe").padding(.top, 4) }
        }
        .padding(16).background(DesignTokens.surface).clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(isCurrent ? DesignTokens.border : DesignTokens.gold.opacity(0.3), lineWidth: 1))
    }

    private func settingsSection(_ title: String, rows: [(String, String, String)]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title).font(DesignTokens.bodyFont(size: 11, weight: .semibold)).foregroundStyle(DesignTokens.textTertiary).tracking(1.5)
                .padding(.horizontal, 20).padding(.top, 24).padding(.bottom, 6)
            VStack(spacing: 0) {
                ForEach(rows, id: \.1) { icon, label, value in
                    HStack {
                        Text(icon).frame(width: 28)
                        Text(label).font(DesignTokens.bodyFont(size: 15)).foregroundStyle(DesignTokens.textPrimary)
                        Spacer()
                        if !value.isEmpty { Text(value).font(DesignTokens.bodyFont(size: 14)).foregroundStyle(DesignTokens.textTertiary) }
                        Text("›").foregroundStyle(DesignTokens.textTertiary)
                    }
                    .padding(.horizontal, 20).frame(height: 48)
                    if icon != rows.last?.0 || label != rows.last?.1 {
                        Divider().padding(.leading, 68)
                    }
                }
            }
            .background(DesignTokens.surface)
        }
    }

    private func actionButton(icon: String, label: String) -> some View {
        VStack(spacing: 4) {
            Image(systemName: icon).font(.system(size: 18)).foregroundStyle(DesignTokens.textSecondary)
            Text(label).font(DesignTokens.bodyFont(size: 12)).foregroundStyle(DesignTokens.textSecondary)
        }
    }

    private var dividerLine: some View {
        HStack(spacing: 12) {
            Rectangle().fill(DesignTokens.border).frame(height: 1)
            Text("✦").font(.system(size: 14)).foregroundStyle(DesignTokens.gold)
            Rectangle().fill(DesignTokens.border).frame(height: 1)
        }
    }

    private func aiBubble(_ text: String) -> some View {
        HStack { Text(text).font(DesignTokens.bodyFont(size: 14)).foregroundStyle(DesignTokens.textPrimary).lineSpacing(3).padding(.horizontal, 16).padding(.vertical, 12).background(DesignTokens.sageBubble).clipShape(.rect(topLeadingRadius: 18, bottomLeadingRadius: 6, bottomTrailingRadius: 18, topTrailingRadius: 18)); Spacer(minLength: 60) }
    }

    private func userBubble(_ text: String) -> some View {
        HStack { Spacer(minLength: 60); Text(text).font(DesignTokens.bodyFont(size: 14)).foregroundStyle(DesignTokens.textPrimary).lineSpacing(3).padding(.horizontal, 16).padding(.vertical, 12).background(DesignTokens.coralBubble).clipShape(.rect(topLeadingRadius: 18, bottomLeadingRadius: 18, bottomTrailingRadius: 6, topTrailingRadius: 18)) }
    }

    private func actionChip(_ label: String, isSelected: Bool) -> some View {
        Text(label).font(DesignTokens.bodyFont(size: 13, weight: .medium)).foregroundStyle(isSelected ? .white : DesignTokens.textPrimary)
            .padding(.horizontal, 16).padding(.vertical, 10)
            .background(isSelected ? DesignTokens.sage : DesignTokens.surface).clipShape(Capsule())
            .overlay(Capsule().stroke(isSelected ? Color.clear : DesignTokens.border, lineWidth: 1))
    }

    private enum ChipStyle { case coral, sage }
    private func chipBadge(_ text: String, style: ChipStyle) -> some View {
        Text(text).font(DesignTokens.bodyFont(size: 12, weight: .medium))
            .foregroundStyle(style == .coral ? DesignTokens.gold : DesignTokens.sage)
            .padding(.horizontal, 10).padding(.vertical, 4)
            .background(style == .coral ? DesignTokens.gold.opacity(0.1) : DesignTokens.sage.opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(style == .coral ? DesignTokens.gold.opacity(0.2) : DesignTokens.sage.opacity(0.2), lineWidth: 1))
    }

    private func lyricsSection(_ label: String, lines: [String]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(DesignTokens.bodyFont(size: 11, weight: .bold)).foregroundStyle(DesignTokens.gold).tracking(1)
            Text(lines.joined(separator: "\n")).font(DesignTokens.displayFont(size: 14)).italic().foregroundStyle(DesignTokens.textPrimary).lineSpacing(4)
        }
    }

    private func lyricsReviewSection(_ label: String, lines: [String], showEdit: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label).font(DesignTokens.bodyFont(size: 11, weight: .bold)).foregroundStyle(DesignTokens.gold).tracking(1)
            Text(lines.joined(separator: "\n")).font(DesignTokens.displayFont(size: 14)).italic().foregroundStyle(DesignTokens.textPrimary).lineSpacing(4)
            if showEdit { Button {} label: { Text("Edit").font(DesignTokens.bodyFont(size: 13, weight: .medium)).foregroundStyle(DesignTokens.gold) } }
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(DesignTokens.surface).clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(DesignTokens.border, lineWidth: 0.5))
    }
}
#endif
