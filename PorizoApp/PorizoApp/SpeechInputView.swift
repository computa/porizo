//
//  SpeechInputView.swift
//  PorizoApp
//
//  Speech-to-text input overlay matching v1.pen "14 - Speech-to-Text" design.
//  Full-screen modal with microphone button, waveform visualization, and processing states.
//

import SwiftUI
import AVFoundation

// MARK: - Speech Input State

enum SpeechInputState: Equatable {
    case idle
    case recording
    case processing
    case error(String)

    static func == (lhs: SpeechInputState, rhs: SpeechInputState) -> Bool {
        switch (lhs, rhs) {
        case (.idle, .idle), (.recording, .recording), (.processing, .processing):
            return true
        case (.error(let a), .error(let b)):
            return a == b
        default:
            return false
        }
    }
}

// MARK: - Speech Input View

struct SpeechInputView: View {
    let storyId: String?  // Optional - required only for OpenAI backend fallback
    let onTranscription: (String) -> Void
    let onCancel: () -> Void

    @EnvironmentObject private var apiClient: APIClientWrapper
    @EnvironmentObject private var sttRouter: STTRouter
    @StateObject private var recorder = AudioRecorder()

    @State private var state: SpeechInputState = .idle
    @State private var recordingDuration: TimeInterval = 0
    @State private var errorMessage: String?

    var body: some View {
        ZStack {
            // Semi-transparent background (v1.pen: #000000B3 = black 70%)
            Color.black.opacity(0.7)
                .ignoresSafeArea()
                .onTapGesture {
                    // Tap outside to cancel (only in idle state)
                    if state == .idle {
                        onCancel()
                    }
                }

            VStack(spacing: 0) {
                Spacer()

                // Center content
                centerContent

                Spacer()

                // Cancel button (v1.pen: 120x48, surface bg, rounded)
                cancelButton
                    .padding(.bottom, 60)
            }
            .padding(.horizontal, 24)
        }
        .onAppear {
            checkPermissionAndStart()
        }
        .onDisappear {
            if recorder.isRecording {
                _ = recorder.stopRecording()
            }
        }
    }

    // MARK: - Center Content

    private var centerContent: some View {
        VStack(spacing: 32) {
            // Microphone button with glow
            microphoneButton

            // Waveform visualization (v1.pen: 10 bars, gold, 4px wide)
            if state == .recording {
                waveformVisualization
            }

            // Status text
            statusText

            // Duration timer (when recording)
            if state == .recording {
                durationText
            }
        }
    }

    // MARK: - Microphone Button (v1.pen: 80x80 gold circle with glow ring)

    private var microphoneButton: some View {
        Button {
            handleMicrophoneTap()
        } label: {
            ZStack {
                // Outer glow ring (v1.pen: 120x120, radial gradient gold 40% to transparent)
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                DesignTokens.gold.opacity(state == .recording ? 0.4 : 0.25),
                                DesignTokens.gold.opacity(0)
                            ],
                            center: .center,
                            startRadius: 40,
                            endRadius: 60
                        )
                    )
                    .frame(width: 120, height: 120)
                    .scaleEffect(state == .recording ? 1.1 : 1.0)
                    .animation(
                        state == .recording
                            ? .easeInOut(duration: 0.8).repeatForever(autoreverses: true)
                            : .easeInOut(duration: 0.2),
                        value: state == .recording
                    )

                // Inner circle (v1.pen: 80x80 gold)
                Circle()
                    .fill(buttonBackgroundColor)
                    .frame(width: 80, height: 80)

                // Icon
                buttonIcon
            }
        }
        .buttonStyle(.plain)
        .disabled(state == .processing)
    }

    private var buttonBackgroundColor: Color {
        switch state {
        case .idle:
            return DesignTokens.gold
        case .recording:
            return DesignTokens.error // Red when recording (tap to stop)
        case .processing:
            return DesignTokens.gold.opacity(0.5)
        case .error:
            return DesignTokens.gold
        }
    }

    @ViewBuilder
    private var buttonIcon: some View {
        switch state {
        case .idle, .error:
            // Microphone icon (v1.pen: 36x36, dark)
            Image(systemName: "mic.fill")
                .font(.system(size: 36))
                .foregroundColor(DesignTokens.background)
        case .recording:
            // Stop icon (square)
            RoundedRectangle(cornerRadius: 4)
                .fill(Color.white)
                .frame(width: 28, height: 28)
        case .processing:
            // Loading spinner
            ProgressView()
                .progressViewStyle(CircularProgressViewStyle(tint: DesignTokens.background))
                .scaleEffect(1.2)
        }
    }

    // MARK: - Waveform Visualization (v1.pen: 10 gold bars, varied heights)

    private var waveformVisualization: some View {
        HStack(spacing: 6) {
            ForEach(0..<10, id: \.self) { index in
                SpeechWaveformBar(
                    audioLevel: recorder.audioLevel,
                    index: index,
                    isAnimating: state == .recording
                )
            }
        }
        .frame(height: 40)
    }

    // MARK: - Status Text (v1.pen: 24pt semibold white)

    private var statusText: some View {
        VStack(spacing: 8) {
            Text(statusTitle)
                .font(DesignTokens.bodyFont(size: 24, weight: .semibold))
                .foregroundColor(DesignTokens.textPrimary)

            Text(statusSubtitle)
                .font(DesignTokens.bodyFont(size: 14))
                .foregroundColor(DesignTokens.textTertiary)
        }
        .multilineTextAlignment(.center)
    }

    private var statusTitle: String {
        switch state {
        case .idle:
            return "Tap to speak"
        case .recording:
            return "Listening..."
        case .processing:
            return "Processing..."
        case .error(let message):
            return message
        }
    }

    private var statusSubtitle: String {
        switch state {
        case .idle:
            return "Share your thoughts by voice"
        case .recording:
            return "Tap the mic to stop"
        case .processing:
            return "Transcribing your audio"
        case .error:
            return "Tap mic to try again"
        }
    }

    // MARK: - Duration Text

    private var durationText: some View {
        Text(formatDuration(recorder.duration))
            .font(DesignTokens.bodyFont(size: 16, weight: .medium))
            .foregroundColor(DesignTokens.textSecondary)
            .monospacedDigit()
    }

    // MARK: - Cancel Button (v1.pen: 120x48, surface bg, 24 radius)

    private var cancelButton: some View {
        Button {
            handleCancel()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "xmark")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundColor(DesignTokens.textSecondary)

                Text("Cancel")
                    .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                    .foregroundColor(DesignTokens.textSecondary)
            }
            .frame(width: 120, height: 48)
            .background(DesignTokens.surface)
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Actions

    private func checkPermissionAndStart() {
        if recorder.permissionDenied {
            state = .error("Microphone access denied")
            return
        }

        if !recorder.permissionGranted {
            Task {
                let granted = await recorder.requestPermission()
                if !granted {
                    state = .error("Microphone access denied")
                }
            }
        }
    }

    private func handleMicrophoneTap() {
        switch state {
        case .idle, .error:
            startRecording()
        case .recording:
            stopRecordingAndTranscribe()
        case .processing:
            break // Ignore taps while processing
        }
    }

    private func startRecording() {
        // Check permission first
        if recorder.permissionDenied {
            state = .error("Microphone access denied")
            return
        }

        do {
            try recorder.startRecording()
            state = .recording
        } catch {
            state = .error("Failed to start recording")
        }
    }

    private func stopRecordingAndTranscribe() {
        guard let audioURL = recorder.stopRecording() else {
            state = .error("No audio recorded")
            return
        }

        state = .processing

        Task {
            await transcribeAudio(url: audioURL)
        }
    }

    private func transcribeAudio(url: URL) async {
        print("[SpeechInputView] Starting transcription for storyId=\(storyId ?? "nil")")
        do {
            // Get audio data
            guard let audioData = try? Data(contentsOf: url) else {
                print("[SpeechInputView] Failed to read audio file at \(url)")
                await MainActor.run {
                    state = .error("Failed to read audio")
                }
                return
            }
            print("[SpeechInputView] Audio data loaded: \(audioData.count) bytes")

            // Generate filename
            let filename = "speech_\(Date().timeIntervalSince1970).wav"

            // Use STTRouter for multi-provider transcription with fallback
            let result = try await sttRouter.transcribe(
                audioData: audioData,
                storyId: storyId,
                filename: filename
            )

            await MainActor.run {
                if !result.text.isEmpty {
                    print("[SpeechInputView] Transcription successful: \(result.text.prefix(50))...")
                    onTranscription(result.text)
                } else {
                    print("[SpeechInputView] Transcription returned empty text")
                    state = .error("No speech detected")
                }
            }
        } catch let error as STTError {
            print("[SpeechInputView] STTError: \(error)")
            await MainActor.run {
                switch error {
                case .noSpeechDetected:
                    state = .error("No speech detected. Try speaking closer to the microphone.")
                case .permissionDenied:
                    state = .error("Speech recognition access denied. Enable in Settings > Privacy.")
                case .providerUnavailable(let provider):
                    state = .error("Speech provider '\(provider)' unavailable. Trying alternatives...")
                case .transcriptionFailed(let reason):
                    state = .error("Transcription failed: \(reason)")
                case .unsupportedFormat(let format):
                    state = .error("Audio format '\(format)' not supported.")
                case .cancelled:
                    state = .idle  // User cancelled, just reset
                case .networkError(let reason):
                    state = .error("Network error: \(reason)")
                case .modelNotDownloaded(let model):
                    state = .error("Speech model '\(model)' not downloaded.")
                case .rateLimitExceeded:
                    state = .error("Too many requests. Please wait a moment.")
                case .unknown(let reason):
                    state = .error("Unknown error: \(reason)")
                }
            }
        } catch {
            print("[SpeechInputView] Unexpected error: \(error.localizedDescription)")
            await MainActor.run {
                state = .error("Transcription failed: \(error.localizedDescription)")
            }
        }

        // Clean up recording
        recorder.deleteRecording()
    }

    private func handleCancel() {
        if recorder.isRecording {
            _ = recorder.stopRecording()
        }
        recorder.deleteRecording()
        onCancel()
    }

    // MARK: - Helpers

    private func formatDuration(_ duration: TimeInterval) -> String {
        let minutes = Int(duration) / 60
        let seconds = Int(duration) % 60
        return String(format: "%d:%02d", minutes, seconds)
    }
}

// MARK: - Speech Waveform Bar

private struct SpeechWaveformBar: View {
    let audioLevel: Float
    let index: Int
    let isAnimating: Bool

    @State private var height: CGFloat = 12

    // Base heights from v1.pen design (varied pattern)
    private var baseHeight: CGFloat {
        let heights: [CGFloat] = [12, 24, 32, 40, 28, 36, 20, 32, 16, 28]
        return heights[index % heights.count]
    }

    var body: some View {
        RoundedRectangle(cornerRadius: 2)
            .fill(DesignTokens.gold)
            .frame(width: 4, height: height)
            .onChange(of: audioLevel) { _, newLevel in
                if isAnimating {
                    // Scale height based on audio level
                    let scale = 0.5 + CGFloat(newLevel) * 1.5
                    withAnimation(.easeOut(duration: 0.05)) {
                        height = min(40, max(8, baseHeight * scale))
                    }
                }
            }
            .onAppear {
                height = baseHeight * 0.5
                if isAnimating {
                    startIdleAnimation()
                }
            }
            .onChange(of: isAnimating) { _, newValue in
                if newValue {
                    startIdleAnimation()
                } else {
                    withAnimation(.easeOut(duration: 0.2)) {
                        height = 12
                    }
                }
            }
    }

    private func startIdleAnimation() {
        // Staggered animation for organic feel
        let delay = Double(index) * 0.05
        withAnimation(
            .easeInOut(duration: 0.4 + Double.random(in: 0...0.2))
            .repeatForever(autoreverses: true)
            .delay(delay)
        ) {
            height = baseHeight * (0.6 + Double.random(in: 0...0.4))
        }
    }
}

// MARK: - Preview

#Preview("Idle State") {
    let apiClient = APIClient(baseURL: "http://localhost:3000")
    return SpeechInputView(
        storyId: "preview-story",
        onTranscription: { text in
            print("Transcription: \(text)")
        },
        onCancel: {
            print("Cancelled")
        }
    )
    .environmentObject(APIClientWrapper(baseURL: "http://localhost:3000"))
    .environmentObject(STTRouter(apiClient: apiClient))
}

#Preview("Recording State") {
    ZStack {
        Color.black.ignoresSafeArea()

        VStack(spacing: 32) {
            // Simulated recording state
            ZStack {
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                DesignTokens.gold.opacity(0.4),
                                DesignTokens.gold.opacity(0)
                            ],
                            center: .center,
                            startRadius: 40,
                            endRadius: 60
                        )
                    )
                    .frame(width: 120, height: 120)

                Circle()
                    .fill(DesignTokens.error)
                    .frame(width: 80, height: 80)

                RoundedRectangle(cornerRadius: 4)
                    .fill(Color.white)
                    .frame(width: 28, height: 28)
            }

            // Waveform
            HStack(spacing: 6) {
                ForEach([12, 24, 32, 40, 28, 36, 20, 32, 16, 28], id: \.self) { height in
                    RoundedRectangle(cornerRadius: 2)
                        .fill(DesignTokens.gold)
                        .frame(width: 4, height: CGFloat(height))
                }
            }

            VStack(spacing: 8) {
                Text("Listening...")
                    .font(DesignTokens.bodyFont(size: 24, weight: .semibold))
                    .foregroundColor(DesignTokens.textPrimary)

                Text("Tap the mic to stop")
                    .font(DesignTokens.bodyFont(size: 14))
                    .foregroundColor(DesignTokens.textTertiary)
            }

            Text("0:05")
                .font(DesignTokens.bodyFont(size: 16, weight: .medium))
                .foregroundColor(DesignTokens.textSecondary)
                .monospacedDigit()
        }
    }
}
