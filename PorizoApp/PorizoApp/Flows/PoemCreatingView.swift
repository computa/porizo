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
    let storyDraftVersion: Int?
    let finalNotes: String?
    let onPoemReady: (Poem) -> Void
    let onNeedsDetails: ([StoryPoemGap], String?) -> Void
    let onError: (String) -> Void
    let onCancel: () -> Void

    @State private var statusMessage = "Preparing your poem..."
    @State private var progress: Int = 0
    @State private var didStart = false
    @State private var createTask: Task<Void, Never>?

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Custom header with cancel button (v1.pen: 56h)
                HStack {
                    Button {
                        onCancel()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundColor(.white)
                            .frame(width: 44, height: 44)
                            .background(DesignTokens.surface)
                            .clipShape(Circle())
                    }
                    .accessibilityLabel("Cancel poem creation")

                    Spacer()

                    Text("Creating Poem")
                        .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                        .foregroundColor(DesignTokens.textTertiary)

                    Spacer()

                    // Spacer to balance layout
                    Color.clear.frame(width: 44, height: 44)
                }
                .padding(.horizontal, 20)
                .frame(height: 56)

                // Content
                VStack(spacing: 32) {
                    Spacer()

                    ZStack {
                        Circle()
                            .stroke(DesignTokens.gold.opacity(0.15), lineWidth: 8)
                            .frame(width: 160, height: 160)

                        Circle()
                            .trim(from: 0, to: CGFloat(progress) / 100)
                            .stroke(DesignTokens.gold, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                            .frame(width: 160, height: 160)
                            .rotationEffect(.degrees(-90))
                            .animation(.linear(duration: 0.3), value: progress)

                        Image(systemName: "text.quote")
                            .font(.system(size: 44))
                            .foregroundColor(DesignTokens.gold)
                    }

                    VStack(spacing: 12) {
                        Text(statusMessage)
                            .font(.headline)
                            .foregroundColor(DesignTokens.textPrimary)

                        Text("We're shaping your story into a poem.")
                            .font(.subheadline)
                            .foregroundColor(DesignTokens.textSecondary)

                        if let storyDraftVersion {
                            Text("Using story draft v\(storyDraftVersion)")
                                .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                                .foregroundColor(DesignTokens.textSecondary)
                        }
                    }

                    Spacer()
                }
                .padding()
            }
        }
        .onAppear {
            if !didStart {
                didStart = true
                createPoem()
            }
        }
        .onDisappear {
            createTask?.cancel()
        }
    }

    private func createPoem() {
        createTask = Task {
            do {
                await MainActor.run {
                    statusMessage = "Confirming your story..."
                    progress = 25
                }

                let confirmResponse = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "confirmStoryV2") {
                    try await apiClient.confirmStoryV2(
                        storyId: storyId,
                        additionalNotes: finalNotes
                    )
                }
                if let confirmedVersion = confirmResponse.narrativeVersion {
                    await MainActor.run {
                        statusMessage = "Locked story draft v\(confirmedVersion)..."
                    }
                }

                await MainActor.run {
                    statusMessage = "Writing your poem..."
                    progress = 70
                }

                let result = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "createPoemFromStory") {
                    try await apiClient.createPoemFromStory(storyId: storyId)
                }

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
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    onError(error.localizedDescription)
                }
            }
        }
    }
}

#Preview {
    PoemCreatingView(
        apiClient: APIClient(baseURL: AppConfig.apiBaseURL),
        storyId: "story_123",
        storyDraftVersion: 3,
        finalNotes: nil,
        onPoemReady: { _ in },
        onNeedsDetails: { _, _ in },
        onError: { _ in },
        onCancel: { }
    )
}
