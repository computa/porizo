//
//  PoemPreviewView.swift
//  PorizoApp
//
//  Displays the generated poem for review with listen and share actions.
//

import SwiftUI

struct PoemPreviewView: View {
    let poem: Poem
    let apiClient: APIClient
    let onRegenerate: () -> Void
    let onDone: () -> Void
    var onShareAction: (() -> Void)? = nil

    @State private var showOptions = false
    @State private var isGeneratingAudio = false
    @State private var activeSheet: ActiveSheet?

    private enum ActiveSheet: String, Identifiable {
        case sharePoem
        var id: String { rawValue }
    }

    var body: some View {
        PoemFullView(
            poem: poem,
            onBack: onDone,
            onMenu: { showOptions = true },
            onListen: { listenToPoem() },
            onShare: {
                if let onShareAction {
                    onShareAction()
                } else {
                    activeSheet = .sharePoem
                }
            }
        )
        .confirmationDialog("Poem Options", isPresented: $showOptions) {
            Button("Try Different Version") {
                onRegenerate()
            }
            Button("Done", role: .cancel) {
                onDone()
            }
        } message: {
            Text("Choose what to do next.")
        }
        .sheet(item: $activeSheet) { sheet in
            switch sheet {
            case .sharePoem:
                PoemShareView(poem: poem)
                    .environment(APIClientWrapper(client: apiClient))
            }
        }
    }

    // MARK: - Listen to Poem (TTS)

    private func listenToPoem() {
        guard !isGeneratingAudio else { return }
        isGeneratingAudio = true
        ToastService.shared.info("Generating audio...")
        Task {
            do {
                let _ = try await apiClient.generatePoemAudio(poemId: poem.id)
                let url = await apiClient.poemAudioURL(poemId: poem.id)
                let headers = await apiClient.streamingAuthHeaders()
                await MainActor.run {
                    isGeneratingAudio = false
                    AudioPlayerService.shared.play(
                        url: url,
                        headers: headers,
                        metadata: NowPlayingMetadata(
                            title: poem.title,
                            artist: "For \(poem.recipientName)"
                        )
                    )
                }
            } catch {
                await MainActor.run {
                    isGeneratingAudio = false
                    ToastService.shared.error(ErrorHandler.poemAudioErrorMessage(error))
                }
            }
        }
    }
}

#Preview {
    PoemPreviewView(
        poem: Poem(
            id: "poem_1",
            userId: "user_1",
            title: "For Chioma",
            recipientName: "Chioma",
            occasion: "birthday",
            tone: "heartfelt",
            status: "generated",
            verses: [
                "You are the morning light,",
                "Soft as the dawn we found together.",
                "Every step, a quiet blessing.",
            ],
            createdAt: "2025-01-01",
            updatedAt: "2025-01-01"
        ),
        apiClient: APIClient(baseURL: AppConfig.apiBaseURL),
        onRegenerate: { },
        onDone: { }
    )
}
