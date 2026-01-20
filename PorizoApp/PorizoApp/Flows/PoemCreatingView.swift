//
//  PoemCreatingView.swift
//  PorizoApp
//
//  Shows a loading state while generating a poem from a confirmed story.
//

import SwiftUI

struct PoemCreatingView: View {
    let apiClient: APIClient
    let storyId: String
    let onPoemReady: (Poem) -> Void
    let onNeedsDetails: ([StoryPoemGap], String?) -> Void
    let onError: (String) -> Void

    @State private var statusMessage = "Preparing your poem..."
    @State private var progress: Int = 0
    @State private var didStart = false

    var body: some View {
        NavigationView {
            ZStack {
                DesignTokens.background.ignoresSafeArea()

                VStack(spacing: 32) {
                    Spacer()

                    ZStack {
                        Circle()
                            .stroke(DesignTokens.roseMuted, lineWidth: 8)
                            .frame(width: 160, height: 160)

                        Circle()
                            .trim(from: 0, to: CGFloat(progress) / 100)
                            .stroke(DesignTokens.rose, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                            .frame(width: 160, height: 160)
                            .rotationEffect(.degrees(-90))
                            .animation(.linear(duration: 0.3), value: progress)

                        Image(systemName: "text.quote")
                            .font(.system(size: 44))
                            .foregroundColor(DesignTokens.rose)
                    }

                    VStack(spacing: 12) {
                        Text(statusMessage)
                            .font(.headline)
                            .foregroundColor(DesignTokens.textPrimary)

                        Text("We’re shaping your story into a poem.")
                            .font(.subheadline)
                            .foregroundColor(DesignTokens.textSecondary)
                    }

                    Spacer()
                }
                .padding()
            }
            .navigationTitle("Creating Poem")
            .navigationBarTitleDisplayMode(.inline)
            .navigationBarBackButtonHidden(true)
        }
        .onAppear {
            if !didStart {
                didStart = true
                createPoem()
            }
        }
    }

    private func createPoem() {
        Task {
            do {
                await MainActor.run {
                    statusMessage = "Confirming your story..."
                    progress = 25
                }

                _ = try await apiClient.confirmStoryV2(storyId: storyId)

                await MainActor.run {
                    statusMessage = "Writing your poem..."
                    progress = 70
                }

                let result = try await apiClient.createPoemFromStory(storyId: storyId)

                await MainActor.run {
                    progress = 100
                }

                switch result {
                case .poem(let payload):
                    await MainActor.run {
                        onPoemReady(payload.poem)
                    }
                case .gaps(let payload):
                    await MainActor.run {
                        let question = payload.suggestedQuestion ?? "Could you share one more detail so I can finish the poem?"
                        onNeedsDetails(payload.gaps, question)
                    }
                }
            } catch {
                await MainActor.run {
                    onError(error.localizedDescription)
                }
            }
        }
    }
}

#Preview {
    PoemCreatingView(
        apiClient: APIClient(baseURL: "http://localhost:3000"),
        storyId: "story_123",
        onPoemReady: { _ in },
        onNeedsDetails: { _, _ in },
        onError: { _ in }
    )
}
