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
    let onNeedsInput: (StoryGuidanceResponse) -> Void
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
                        createTask?.cancel()
                        createTask = nil
                        onCancel()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundStyle(.white)
                            .frame(width: 44, height: 44)
                            .background(DesignTokens.surface)
                            .clipShape(Circle())
                    }
                    .accessibilityLabel("Cancel poem creation")

                    Spacer()

                    Text("Creating Poem")
                        .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                        .foregroundStyle(DesignTokens.textTertiary)

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
                            .foregroundStyle(DesignTokens.gold)
                    }

                    VStack(spacing: 12) {
                        Text(statusMessage)
                            .font(.headline)
                            .foregroundStyle(DesignTokens.textPrimary)

                        Text("We're shaping your story into a poem.")
                            .font(.subheadline)
                            .foregroundStyle(DesignTokens.textSecondary)

                        if let storyDraftVersion {
                            Text("Using story draft v\(storyDraftVersion)")
                                .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                                .foregroundStyle(DesignTokens.textSecondary)
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
    }

    private func createPoem() {
        createTask = Task {
            defer {
                Task { @MainActor in
                    createTask = nil
                }
            }
            do {
                await MainActor.run {
                    statusMessage = "Confirming your story..."
                    progress = 25
                }

                let confirmResult = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "confirmStoryV2") {
                    try await apiClient.confirmStoryV2(
                        storyId: storyId,
                        additionalNotes: finalNotes
                    )
                }
                switch confirmResult {
                case .needsInput(let guidance):
                    guard !Task.isCancelled else { return }
                    await MainActor.run {
                        onNeedsInput(guidance)
                    }
                    return
                case .confirmed(let confirmResponse):
                    if let confirmedVersion = confirmResponse.narrativeVersion {
                        await MainActor.run {
                            statusMessage = "Locked story draft v\(confirmedVersion)..."
                        }
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
                    guard !Task.isCancelled else { return }
                    await MainActor.run {
                        onPoemReady(payload.poem)
                    }
                case .gaps(let payload):
                    guard !Task.isCancelled else { return }
                    await MainActor.run {
                        let question = payload.suggestedQuestion ?? "Could you share one more detail so I can finish the poem?"
                        onNeedsDetails(payload.gaps, question)
                    }
                }
            } catch {
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    onError(ErrorHandler.friendlyMessage(for: error, context: "Creating poem"))
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
        onNeedsInput: { _ in },
        onNeedsDetails: { _, _ in },
        onError: { _ in },
        onCancel: { }
    )
}
