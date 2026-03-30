//
//  CreatingTrackView.swift
//  PorizoApp
//
//  Shows a loading state while creating a track from the story context.
//  Velvet & Gold design system.
//

import SwiftUI

// Reference DesignTokens from MainTabView.swift

struct CreatingTrackView: View {
    let apiClient: APIClient
    let storyContext: StoryContext
    let voiceMode: VoiceMode
    let voiceGender: VoiceGender?
    let onTrackCreated: (String, Int, Lyrics) -> Void
    let onNeedsInput: (StoryGuidanceResponse) -> Void
    let onError: (String) -> Void
    let onCancel: () -> Void

    @State private var controller: TrackCreationController
    @State private var createTask: Task<Void, Never>?
    @State private var didStartCreation = false

    init(
        apiClient: APIClient,
        storyContext: StoryContext,
        voiceMode: VoiceMode,
        voiceGender: VoiceGender?,
        onTrackCreated: @escaping (String, Int, Lyrics) -> Void,
        onNeedsInput: @escaping (StoryGuidanceResponse) -> Void,
        onError: @escaping (String) -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.apiClient = apiClient
        self.storyContext = storyContext
        self.voiceMode = voiceMode
        self.voiceGender = voiceGender
        self.onTrackCreated = onTrackCreated
        self.onNeedsInput = onNeedsInput
        self.onError = onError
        self.onCancel = onCancel
        self._controller = State(initialValue: TrackCreationController(apiClient: apiClient))
    }

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
                            .foregroundStyle(.white)
                            .frame(width: 44, height: 44)
                            .background(DesignTokens.surface)
                            .clipShape(Circle())
                    }
                    .accessibilityLabel("Cancel song creation")

                    Spacer()

                    Text("Creating Song")
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

                    // Animated visualization
                    ZStack {
                        Circle()
                            .stroke(DesignTokens.gold.opacity(0.15), lineWidth: 8)
                            .frame(width: 160, height: 160)

                        Circle()
                            .trim(from: 0, to: CGFloat(controller.progress) / 100)
                            .stroke(DesignTokens.gold, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                            .frame(width: 160, height: 160)
                            .rotationEffect(.degrees(-90))
                            .animation(.linear(duration: 0.3), value: controller.progress)

                        Image(systemName: "wand.and.stars")
                            .font(.system(size: 50))
                            .foregroundStyle(DesignTokens.gold)
                    }

                    VStack(spacing: 12) {
                        Text(controller.statusMessage)
                            .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                            .foregroundStyle(DesignTokens.textPrimary)

                        Text("For \(storyContext.recipientName)")
                            .font(DesignTokens.bodyFont(size: 14))
                            .foregroundStyle(DesignTokens.textSecondary)

                        Text("\(storyContext.occasion.displayName) \(storyContext.occasion.emoji)")
                            .font(DesignTokens.bodyFont(size: 12))
                            .foregroundStyle(DesignTokens.gold)

                        if let narrativeVersion = storyContext.narrativeVersion {
                            Text("Using story draft v\(narrativeVersion)")
                                .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                                .foregroundStyle(DesignTokens.textSecondary)
                        }

                        if let finalNotes = storyContext.finalNotes, !finalNotes.isEmpty {
                            Text("Final notes will be applied before lock-in.")
                                .font(DesignTokens.bodyFont(size: 12))
                                .foregroundStyle(DesignTokens.textSecondary)
                        }
                    }

                    Spacer()
                }
                .padding()
            }
        }
        .onAppear {
            guard !didStartCreation else { return }
            didStartCreation = true
            createTrack()
        }
        .onDisappear {
            createTask?.cancel()
        }
    }

    private func createTrack() {
        createTask = Task {
            do {
                let result = try await controller.createTrack(
                    storyContext: storyContext,
                    voiceMode: voiceMode,
                    voiceGender: voiceGender
                )
                switch result {
                case .created(let payload):
                    onTrackCreated(payload.trackId, payload.versionNum, payload.lyrics)
                case .needsInput(let guidance):
                    onNeedsInput(guidance)
                }
            } catch {
                guard !Task.isCancelled else { return }
                onError(error.localizedDescription)
            }
        }
    }

}

#Preview {
    CreatingTrackView(
        apiClient: APIClient(baseURL: AppConfig.apiBaseURL),
        storyContext: StoryContext(
            storyId: nil,
            recipientName: "Sarah",
            occasion: .anniversary,
            specificMemory: "The night we danced in the rain",
            memoryAnswers: [],
            specialPhrases: nil,
            whatMakesThemSpecial: nil,
            style: "soul",
            narrativeVersion: 3,
            finalNotes: nil,
            storyProvenance: nil
        ),
        voiceMode: .aiVoice,
        voiceGender: nil,
        onTrackCreated: { _, _, _ in },
        onNeedsInput: { _ in },
        onError: { _ in },
        onCancel: { }
    )
}
