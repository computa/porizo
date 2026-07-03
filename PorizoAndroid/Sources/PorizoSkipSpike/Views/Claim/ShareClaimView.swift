import SwiftUI

/// U12 deep-link claim sheet for a track share. Server-driven state: preview
/// before claim (U3 playback), PIN entry when required, sign-in-to-claim (Google
/// on Android), and honest lifetime copy. Presented as a sheet — not a tab.
struct ShareClaimView: View {
    let shareId: String
    @State var model = AndroidClaimModel()
    @State var pin = ""
    @Environment(AndroidPlayerModel.self) var player
    @Environment(AndroidAuthModel.self) var auth
    let onClose: () -> Void

    var body: some View {
        ZStack {
            PorizoAndroidTheme.background.ignoresSafeArea()
            VStack(spacing: 20) {
                closeBar
                Spacer()
                content
                Spacer()
            }
            .padding(24)
        }
        .task { await model.loadShare(shareId: shareId) }
    }

    private var closeBar: some View {
        HStack {
            Spacer()
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(PorizoAndroidTheme.textSecondary)
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading, .claiming:
            ProgressView()
        case .preview(let state):
            previewBody(state)
        case .claimed:
            statusBody(symbol: "checkmark.circle", title: "Saved to your library", detail: "Claim in the app to keep it forever.")
        case .unavailable:
            statusBody(symbol: "xmark.circle", title: "This link isn't available", detail: "It may have been claimed already or revoked.")
        case .failed(let message):
            statusBody(symbol: "exclamationmark.triangle", title: "Something went wrong", detail: message)
        }
    }

    @ViewBuilder
    private func previewBody(_ state: ClaimLogic.State) -> some View {
        VStack(spacing: 16) {
            FrauncesTitle(text: model.title ?? "Someone made you something", size: 24, weight: .bold)

            if let preview = model.previewURL {
                PorizoActionButton(title: "Preview", symbol: "play.fill") {
                    player.play(AndroidPlayableTrack(
                        id: shareId, title: model.title ?? "Preview", recipientName: nil,
                        artworkURL: nil, streamURL: preview, isOwnedContent: false
                    ))
                }
            }

            if model.needsPin {
                PorizoTextInput(title: "Enter the PIN", text: pinBinding)
            }

            if auth.isAuthenticated {
                PorizoActionButton(title: "Claim & keep forever", symbol: "checkmark.circle") {
                    Task { await model.claimShare(shareId: shareId, pin: pin) }
                }
            } else {
                PorizoActionButton(title: "Sign in to claim", symbol: "person.circle") {
                    auth.beginAuthSheet()
                }
            }
        }
    }

    @ViewBuilder
    private func statusBody(symbol: String, title: String, detail: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 34))
                .foregroundStyle(PorizoAndroidTheme.gold)
            FrauncesTitle(text: title, size: 22, weight: .bold)
            Text(detail)
                .font(.system(size: 14))
                .foregroundStyle(PorizoAndroidTheme.textSecondary)
                .multilineTextAlignment(.center)
            Button("Done") { onClose() }
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(PorizoAndroidTheme.goldDark)
        }
    }

    private var pinBinding: Binding<String> {
        Binding(get: { pin }, set: { pin = $0 })
    }
}

/// U13 poem-share claim sheet: reveal the verses, then claim into the library.
struct PoemClaimView: View {
    let shareId: String
    @State var model = AndroidClaimModel()
    @State var pin = ""
    @Environment(AndroidAuthModel.self) var auth
    let onClose: () -> Void

    var body: some View {
        ZStack {
            PorizoAndroidTheme.background.ignoresSafeArea()
            VStack(spacing: 16) {
                HStack {
                    Spacer()
                    Button(action: onClose) {
                        Image(systemName: "xmark")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(PorizoAndroidTheme.textSecondary)
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain)
                }
                content
            }
            .padding(24)
        }
        .task { await model.loadPoemShare(shareId: shareId) }
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading, .claiming:
            Spacer(); ProgressView(); Spacer()
        case .preview:
            ScrollView {
                VStack(spacing: 14) {
                    FrauncesTitle(text: model.title ?? "A poem for you", size: 24, weight: .bold)
                    ForEach(Array(model.poemVerses.enumerated()), id: \.offset) { _, verse in
                        Text(verse)
                            .font(.system(size: 17)).italic()
                            .foregroundStyle(PorizoAndroidTheme.textPrimary)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity)
                    }
                    if model.needsPin {
                        PorizoTextInput(title: "Enter the PIN", text: pinBinding)
                    }
                    if auth.isAuthenticated {
                        PorizoActionButton(title: "Claim & keep forever", symbol: "checkmark.circle") {
                            Task { await model.claimPoem(shareId: shareId, pin: pin) }
                        }
                    } else {
                        PorizoActionButton(title: "Sign in to claim", symbol: "person.circle") {
                            auth.beginAuthSheet()
                        }
                    }
                }
            }
        case .claimed:
            Spacer()
            VStack(spacing: 12) {
                Image(systemName: "checkmark.circle").font(.system(size: 34)).foregroundStyle(PorizoAndroidTheme.gold)
                FrauncesTitle(text: "Saved to your library", size: 22, weight: .bold)
                Button("Done") { onClose() }.foregroundStyle(PorizoAndroidTheme.goldDark)
            }
            Spacer()
        case .unavailable, .failed:
            Spacer()
            VStack(spacing: 12) {
                Image(systemName: "exclamationmark.triangle").font(.system(size: 34)).foregroundStyle(PorizoAndroidTheme.textSecondary)
                FrauncesTitle(text: "This link isn't available", size: 22, weight: .bold)
                Button("Done") { onClose() }.foregroundStyle(PorizoAndroidTheme.goldDark)
            }
            Spacer()
        }
    }

    private var pinBinding: Binding<String> {
        Binding(get: { pin }, set: { pin = $0 })
    }
}

/// U12 receiver-handoff claim sheet (opaque id). Resolves the handoff to a claim
/// token, then claims — persisting the id across install→login→claim.
struct ReceiverClaimView: View {
    let handoffId: String
    @State var model = AndroidClaimModel()
    @State var claimToken = ""
    @State var pin = ""
    @Environment(AndroidAuthModel.self) var auth
    let onClose: () -> Void

    var body: some View {
        ZStack {
            PorizoAndroidTheme.background.ignoresSafeArea()
            VStack(spacing: 20) {
                HStack {
                    Spacer()
                    Button(action: onClose) {
                        Image(systemName: "xmark")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(PorizoAndroidTheme.textSecondary)
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain)
                }
                Spacer()
                content
                Spacer()
            }
            .padding(24)
        }
        .task { await model.loadReceiverHandoff(handoffId: handoffId) }
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading, .claiming:
            ProgressView()
        case .preview:
            VStack(spacing: 16) {
                FrauncesTitle(text: "Someone sent you something", size: 24, weight: .bold)
                Text("Claim in the app to keep it forever.")
                    .font(.system(size: 14))
                    .foregroundStyle(PorizoAndroidTheme.textSecondary)
                if auth.isAuthenticated {
                    PorizoActionButton(title: "Claim", symbol: "checkmark.circle") {
                        Task { await model.claimReceiver(claimToken: claimToken, pin: pin) }
                    }
                } else {
                    PorizoActionButton(title: "Sign in to claim", symbol: "person.circle") {
                        auth.beginAuthSheet()
                    }
                }
            }
        case .claimed:
            VStack(spacing: 12) {
                Image(systemName: "checkmark.circle").font(.system(size: 34)).foregroundStyle(PorizoAndroidTheme.gold)
                FrauncesTitle(text: "Saved to your library", size: 22, weight: .bold)
                Button("Done") { onClose() }.foregroundStyle(PorizoAndroidTheme.goldDark)
            }
        case .unavailable, .failed:
            VStack(spacing: 12) {
                Image(systemName: "exclamationmark.triangle").font(.system(size: 34)).foregroundStyle(PorizoAndroidTheme.textSecondary)
                FrauncesTitle(text: "This link isn't available", size: 22, weight: .bold)
                Button("Done") { onClose() }.foregroundStyle(PorizoAndroidTheme.goldDark)
            }
        }
    }
}
