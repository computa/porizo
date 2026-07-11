import SwiftUI

@main
struct PorizoAppClipApp: App {
    var body: some Scene {
        WindowGroup {
            AppClipReceiverView()
        }
    }
}

struct AppClipReceiverView: View {
    @Environment(\.openURL) private var openURL
    @State private var model = AppClipReceiverModel()

    var body: some View {
        ZStack {
            Color(red: 0.08, green: 0.07, blue: 0.06).ignoresSafeArea()
            VStack(spacing: 24) {
                Text("Porizo")
                    .font(.system(.title, design: .serif, weight: .semibold))
                    .foregroundStyle(Color(red: 0.85, green: 0.58, blue: 0.34))

                Spacer()

                if let gift = model.gift {
                    AsyncImage(url: gift.artworkURL) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        Color.white.opacity(0.08)
                    }
                    .frame(width: 240, height: 240)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .accessibilityHidden(true)

                    VStack(spacing: 8) {
                        Text(gift.title)
                            .font(.title2.weight(.semibold))
                            .multilineTextAlignment(.center)
                        if let sender = gift.senderName {
                            Text("A song from \(sender)")
                                .foregroundStyle(.secondary)
                        }
                    }

                    Text("This song was made for you.")
                        .font(.headline)

                    Text("Open it in Porizo to claim it, keep it in your library, and hear the full song.")
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)

                    Button {
                        Task {
                            if let url = await model.prepareFullAppHandoff() {
                                openURL(url)
                            }
                        }
                    } label: {
                        Label(
                            model.isPreparingHandoff ? "Preparing your song…" : "Get Porizo and play",
                            systemImage: "arrow.down.app.fill"
                        )
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(model.isPreparingHandoff)
                } else if let error = model.errorMessage {
                    ContentUnavailableView("Song unavailable", systemImage: "music.note", description: Text(error))
                    Button("Try again") { Task { await model.reload() } }
                        .buttonStyle(.borderedProminent)
                } else {
                    ProgressView("Opening your song…")
                }

                Spacer()
            }
            .padding(24)
            .foregroundStyle(.white)
        }
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
            guard let url = activity.webpageURL else { return }
            Task { await model.load(invocationURL: url) }
        }
    }
}
