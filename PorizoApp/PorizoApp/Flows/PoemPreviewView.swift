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
            onShare: { activeSheet = .sharePoem }
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
                    .environmentObject(APIClientWrapper(client: apiClient))
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
                let url = apiClient.poemAudioURL(poemId: poem.id)
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
                    ToastService.shared.error(poemAudioErrorMessage(error))
                }
            }
        }
    }

    private func poemAudioErrorMessage(_ error: Error) -> String {
        guard let apiError = error as? APIClientError else {
            return "Could not play poem audio. Please try again."
        }

        switch apiError {
        case .rateLimited:
            return "You have reached the poem audio limit. Please wait and try again."
        case .networkError:
            return "Network issue while generating poem audio. Please try again."
        case .serverError(let message):
            return message.isEmpty ? "Could not generate poem audio. Please try again." : message
        case .httpError(_, let body):
            if body.localizedCaseInsensitiveContains("FST_ERR_CTP_EMPTY_JSON_BODY") {
                return "Audio request was rejected by the server. Please try again."
            }
            return "Could not generate poem audio. Please try again."
        default:
            return "Could not play poem audio. Please try again."
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
