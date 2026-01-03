//
//  CreatingTrackView.swift
//  PorizoApp
//
//  Shows a loading state while creating a track from the story context.
//  Light mode design with rose accents.
//

import SwiftUI

// Reference DesignTokens from MainTabView.swift

struct CreatingTrackView: View {
    let apiClient: APIClient
    let storyContext: StoryContext
    let onTrackCreated: (String, Int) -> Void
    let onError: (String) -> Void

    @State private var statusMessage = "Creating your song..."
    @State private var progress: Int = 0

    var body: some View {
        NavigationView {
            ZStack {
                DesignTokens.background.ignoresSafeArea()

                VStack(spacing: 32) {
                    Spacer()

                    // Animated visualization
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

                        Image(systemName: "wand.and.stars")
                            .font(.system(size: 50))
                            .foregroundColor(DesignTokens.rose)
                    }

                    VStack(spacing: 12) {
                        Text(statusMessage)
                            .font(.headline)
                            .foregroundColor(DesignTokens.textPrimary)

                        Text("For \(storyContext.recipientName)")
                            .font(.subheadline)
                            .foregroundColor(DesignTokens.textSecondary)

                        Text("\(storyContext.occasion.displayName) \(storyContext.occasion.emoji)")
                            .font(.caption)
                            .foregroundColor(DesignTokens.rose)
                    }

                    Spacer()
                }
                .padding()
            }
            .navigationTitle("Creating Song")
            .navigationBarTitleDisplayMode(.inline)
            .navigationBarBackButtonHidden(true)
        }
        .onAppear {
            createTrack()
        }
    }

    private func createTrack() {
        Task {
            do {
                // Step 1: Create the track
                statusMessage = "Setting up your song..."
                progress = 20

                let trackRequest = CreateTrackRequest(
                    title: "Song for \(storyContext.recipientName)",
                    occasion: storyContext.occasion.rawValue,
                    recipientName: storyContext.recipientName,
                    style: storyContext.style.rawValue,
                    durationTarget: 60,
                    voiceMode: "user_voice",
                    message: buildMessage(from: storyContext),
                    specificMemory: storyContext.specificMemory,
                    memoryAnswers: storyContext.memoryAnswers.isEmpty ? nil : storyContext.memoryAnswers,
                    specialPhrases: storyContext.specialPhrases,
                    whatMakesThemSpecial: storyContext.whatMakesThemSpecial,
                    relationshipType: nil,
                    yearsKnown: nil
                )

                let trackResponse = try await apiClient.createTrack(request: trackRequest)
                progress = 50

                // Step 2: Create the first version
                statusMessage = "Preparing lyrics generation..."
                progress = 70

                let versionResponse = try await apiClient.createVersion(
                    trackId: trackResponse.trackId,
                    renderType: "preview"
                )
                progress = 100

                // Done - hand off to lyrics review
                await MainActor.run {
                    onTrackCreated(trackResponse.trackId, versionResponse.versionNum)
                }

            } catch {
                await MainActor.run {
                    onError(error.localizedDescription)
                }
            }
        }
    }

    /// Build a message string from the story context for legacy compatibility
    private func buildMessage(from context: StoryContext) -> String {
        var parts: [String] = []

        // Start with the memory
        parts.append(context.specificMemory)

        // Add memory answers if present
        for answer in context.memoryAnswers {
            if !answer.answer.isEmpty {
                parts.append(answer.answer)
            }
        }

        // Add what makes them special
        if let special = context.whatMakesThemSpecial, !special.isEmpty {
            parts.append(special)
        }

        return parts.joined(separator: ". ")
    }
}

#Preview {
    CreatingTrackView(
        apiClient: APIClient(baseURL: "http://localhost:3000"),
        storyContext: StoryContext(
            recipientName: "Sarah",
            occasion: .anniversary,
            specificMemory: "The night we danced in the rain",
            memoryAnswers: [],
            specialPhrases: nil,
            whatMakesThemSpecial: nil,
            style: .soul
        ),
        onTrackCreated: { _, _ in },
        onError: { _ in }
    )
}
