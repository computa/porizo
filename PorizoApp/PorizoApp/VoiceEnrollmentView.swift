//
//  VoiceEnrollmentView.swift
//  PorizoApp
//
//  Voice enrollment screen for recording phrases to create a voice profile.
//  Matches v1.pen "09 - Voice Enrollment" design.
//

import SwiftUI
import AVFoundation

// MARK: - Voice Enrollment View

struct VoiceEnrollmentView: View {
    @Binding var completedProfile: VoiceProfile?
    @Environment(\.dismiss) private var dismiss
    @Environment(APIClientWrapper.self) private var apiClient
    @State private var recorder = AudioRecorder()
    @State private var audioAnalyzer = LiveAudioAnalyzer()
    @State private var coachingManager = CoachingTipManager()

    // MARK: - UI State

    @State private var currentPhraseIndex: Int = 0
    @State private var recordedPhrases: Set<Int> = []
    @State private var isRecording: Bool = false
    @State private var showCompletionView: Bool = false
    @State private var completedQualityTier: QualityTier?

    // MARK: - Backend Integration State

    @State private var enrollmentSession: EnrollmentSession?
    @State private var currentUploadUrl: UploadURL?
    @State private var isUploading: Bool = false
    @State private var enrollmentError: String?
    @State private var showErrorAlert: Bool = false
    @State private var isStartingSession: Bool = false
    @State private var isCompletingEnrollment: Bool = false

    // MARK: - Timer State

    /// Cancellable auto-stop timer task
    @State private var autoStopTask: Task<Void, Never>?

    // MARK: - Constants

    /// Maximum recording duration before auto-stop (seconds)
    private let maxRecordingDuration: UInt64 = 5

    // MARK: - Computed Properties

    /// Prompts from backend session, or empty if not loaded yet
    private var prompts: [EnrollmentPrompt] {
        enrollmentSession?.prompts ?? []
    }

    /// Current prompt being recorded
    private var currentPrompt: EnrollmentPrompt? {
        guard currentPhraseIndex < prompts.count else { return nil }
        return prompts[currentPhraseIndex]
    }

    /// Whether the current phrase has been recorded
    private var canProceed: Bool {
        recordedPhrases.contains(currentPhraseIndex)
    }

    /// Whether this is the last phrase
    private var isLastPhrase: Bool {
        !prompts.isEmpty && currentPhraseIndex == prompts.count - 1
    }

    /// Overall loading state
    private var isLoading: Bool {
        isStartingSession || isUploading || isCompletingEnrollment
    }

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header
                header

                // Content
                if isStartingSession {
                    // Loading state while fetching prompts
                    loadingView
                } else if prompts.isEmpty {
                    // Error state - no prompts loaded
                    errorStateView
                } else {
                    // Main enrollment content
                    enrollmentContent
                }
            }
        }
        .navigationBarHidden(true)
        .task {
            await startEnrollmentSession()
            // Start audio analyzer for real-time feedback
            audioAnalyzer.tryStart()
        }
        .fullScreenCover(isPresented: $showCompletionView) {
            if let tier = completedQualityTier {
                EnrollmentCompletionView(qualityTier: tier) {
                    dismiss()
                }
            }
        }
        .alert("Enrollment Error", isPresented: $showErrorAlert) {
            Button("OK") { }
        } message: {
            Text(enrollmentError ?? "An unknown error occurred")
        }
        .onDisappear {
            // Clean up recording and analyzer if user navigates away
            autoStopTask?.cancel()
            audioAnalyzer.stop()
            if recorder.isRecording {
                _ = recorder.stopRecording()
            }
        }
        .onChange(of: audioAnalyzer.metrics) { _, newMetrics in
            coachingManager.update(with: newMetrics, isRecording: isRecording)
        }
    }

    // MARK: - Loading View

    private var loadingView: some View {
        VStack(spacing: 16) {
            Spacer()
            ProgressView()
                .progressViewStyle(CircularProgressViewStyle(tint: DesignTokens.gold))
                .scaleEffect(1.2)
            Text("Setting up voice enrollment...")
                .font(.system(size: 14))
                .foregroundStyle(DesignTokens.textSecondary)
            Spacer()
        }
    }

    // MARK: - Error State View

    private var errorStateView: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 48))
                .foregroundStyle(DesignTokens.textSecondary)
            Text("Failed to load enrollment prompts")
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(DesignTokens.textPrimary)
            Button {
                Task { await startEnrollmentSession() }
            } label: {
                Text("Try Again")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(DesignTokens.background)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 12)
                    .background(DesignTokens.gold)
                    .clipShape(.rect(cornerRadius: 20))
            }
            .buttonStyle(.plain)
            Spacer()
        }
    }

    // MARK: - Enrollment Content

    private var enrollmentContent: some View {
        VStack(spacing: 16) {
            // Progress indicator with environment quality
            HStack {
                progressIndicator
                Spacer()
                EnvironmentQualityBadge(metrics: audioAnalyzer.metrics, compact: true)
            }

            // Prompt badge
            promptBadge

            // Prompt text
            promptText

            // Hint text
            hintText

            Spacer()

            // Record button with level meter
            HStack(spacing: 16) {
                // Left level meter
                AudioLevelMeter(
                    level: audioAnalyzer.metrics.normalizedLevel,
                    isClipping: audioAnalyzer.metrics.isClipping,
                    size: CGSize(width: 6, height: 100)
                )
                .opacity(isRecording ? 1.0 : 0.3)

                // Record button with loading overlay
                ZStack {
                    recordButton
                    if isUploading {
                        uploadingOverlay
                    }
                }

                // Right level meter (mirrored)
                AudioLevelMeter(
                    level: audioAnalyzer.metrics.normalizedLevel,
                    isClipping: audioAnalyzer.metrics.isClipping,
                    size: CGSize(width: 6, height: 100)
                )
                .opacity(isRecording ? 1.0 : 0.3)
            }

            // Waveform placeholder
            waveformPlaceholder

            // Coaching tips
            CoachingTipView(tip: coachingManager.currentTip)
                .padding(.horizontal, -4)

            Spacer()

            // Navigation row
            navigationRow
        }
        .padding(20)
    }

    // MARK: - Uploading Overlay

    private var uploadingOverlay: some View {
        VStack(spacing: 8) {
            ProgressView()
                .progressViewStyle(CircularProgressViewStyle(tint: .white))
            Text("Uploading...")
                .font(.system(size: 12))
                .foregroundStyle(.white)
        }
        .frame(width: 120, height: 120)
        .background(Color.black.opacity(0.6))
        .clipShape(.rect(cornerRadius: 60))
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Button {
                dismiss()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(DesignTokens.surface)
                    .clipShape(Circle())
            }

            Spacer()

            Text("Voice Setup")
                .font(DesignTokens.displayFont(size: 20))
                .foregroundStyle(DesignTokens.textPrimary)

            Spacer()

            Color.clear
                .frame(width: 44, height: 44)
        }
        .padding(.horizontal, 20)
        .frame(height: 56)
    }

    // MARK: - Progress Indicator

    private var progressIndicator: some View {
        HStack(spacing: 8) {
            ForEach(0..<prompts.count, id: \.self) { index in
                Circle()
                    .fill(progressDotColor(for: index))
                    .frame(width: 8, height: 8)
            }

            Text("Phrase \(currentPhraseIndex + 1) of \(prompts.count)")
                .font(.system(size: 14))
                .foregroundStyle(DesignTokens.textSecondary)
        }
    }

    private func progressDotColor(for index: Int) -> Color {
        if recordedPhrases.contains(index) {
            return DesignTokens.success
        } else if index == currentPhraseIndex {
            return DesignTokens.gold
        } else {
            return DesignTokens.border
        }
    }

    // MARK: - Prompt Badge

    private var promptBadge: some View {
        Text(currentPrompt?.type.uppercased() ?? "SPOKEN")
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(DesignTokens.gold)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(DesignTokens.surface)
            .clipShape(.rect(cornerRadius: 16))
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(DesignTokens.border, lineWidth: 1)
            )
    }

    // MARK: - Prompt Text

    private var promptText: some View {
        Text("\"\(currentPrompt?.text ?? "Loading...")\"")
            .font(DesignTokens.displayFont(size: 24))
            .foregroundStyle(DesignTokens.textPrimary)
            .multilineTextAlignment(.center)
            .lineSpacing(8)
            .padding(.horizontal, 16)
    }

    // MARK: - Hint Text

    private var hintText: some View {
        Text(currentPrompt?.hint ?? "")
            .font(.system(size: 14))
            .foregroundStyle(DesignTokens.textSecondary)
            .multilineTextAlignment(.center)
            .lineSpacing(4)
    }

    // MARK: - Record Button

    private var recordButton: some View {
        Button {
            toggleRecording()
        } label: {
            ZStack {
                // Outer ring
                Circle()
                    .fill(DesignTokens.gold.opacity(0.2))
                    .frame(width: 120, height: 120)

                // Inner button
                Circle()
                    .fill(isRecording ? DesignTokens.error : DesignTokens.gold)
                    .frame(width: 88, height: 88)

                // Icon
                if isRecording {
                    RoundedRectangle(cornerRadius: 4)
                        .fill(Color.white)
                        .frame(width: 28, height: 28)
                } else {
                    Image(systemName: "mic.fill")
                        .font(.system(size: 32))
                        .foregroundStyle(DesignTokens.background)
                }
            }
        }
        .buttonStyle(.plain)
        .scaleEffect(isRecording ? 1.05 : 1.0)
        .animation(.easeInOut(duration: 0.2), value: isRecording)
        .disabled(isUploading)
    }

    // MARK: - Waveform Placeholder (Compact)

    private var waveformPlaceholder: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8)
                .fill(DesignTokens.surface)
                .frame(height: 48)

            if isRecording {
                // Animated bars for recording indicator
                HStack(spacing: 3) {
                    ForEach(0..<20, id: \.self) { index in
                        WaveformBar(isAnimating: isRecording, delay: Double(index) * 0.05)
                    }
                }
            } else if isUploading {
                HStack(spacing: 6) {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: DesignTokens.gold))
                        .scaleEffect(0.8)
                    Text("Uploading...")
                        .font(.system(size: 13))
                        .foregroundStyle(DesignTokens.gold)
                }
            } else if recordedPhrases.contains(currentPhraseIndex) {
                HStack(spacing: 6) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(DesignTokens.success)

                    Text("Recorded")
                        .font(.system(size: 13))
                        .foregroundStyle(DesignTokens.success)
                }
            } else {
                Text("Tap the microphone to begin")
                    .font(.system(size: 13))
                    .foregroundStyle(DesignTokens.textTertiary)
            }
        }
    }

    // MARK: - Navigation Row

    private var navigationRow: some View {
        HStack {
            Button {
                advanceToNextPhrase()
            } label: {
                Text("Skip Phrase")
                    .font(.system(size: 16))
                    .foregroundStyle(DesignTokens.gold)
            }
            .buttonStyle(.plain)
            .disabled(isUploading || isLastPhrase)
            .opacity(isLastPhrase ? 0.4 : 1.0)

            Spacer()

            if isCompletingEnrollment {
                ProgressView()
                    .progressViewStyle(CircularProgressViewStyle(tint: DesignTokens.gold))
            } else {
                Button {
                    if isLastPhrase && canProceed {
                        Task { await completeEnrollmentFlow() }
                    } else {
                        advanceToNextPhrase()
                    }
                } label: {
                    Text(isLastPhrase ? "Complete" : "Next Phrase")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(DesignTokens.background)
                        .padding(.horizontal, 24)
                        .padding(.vertical, 14)
                        .background(canProceed ? DesignTokens.gold : DesignTokens.gold.opacity(0.4))
                        .clipShape(.rect(cornerRadius: 24))
                }
                .buttonStyle(.plain)
                .disabled(!canProceed || isUploading)
            }
        }
        .padding(.vertical, 16)
    }

    // MARK: - Actions

    private func toggleRecording() {
        if isRecording {
            stopRecording()
        } else {
            startRecording()
        }
    }

    private func startRecording() {
        do {
            try recorder.startRecording()
            isRecording = true

            // Cancel any existing auto-stop task
            autoStopTask?.cancel()

            // Start cancellable auto-stop timer
            autoStopTask = Task { @MainActor in
                do {
                    try await Task.sleep(for: .seconds(maxRecordingDuration))
                    // Only stop if still recording (task wasn't cancelled)
                    if recorder.isRecording {
                        stopRecording()
                    }
                } catch {
                    // Task was cancelled - this is expected on manual stop or navigation
                }
            }
        } catch {
            enrollmentError = "Recording failed: \(error.localizedDescription)"
            showErrorAlert = true
        }
    }

    private func stopRecording() {
        // Cancel auto-stop timer since we're stopping manually
        autoStopTask?.cancel()
        autoStopTask = nil

        guard let url = recorder.stopRecording() else {
            isRecording = false
            return
        }

        guard let session = enrollmentSession,
              let uploadUrl = currentUploadUrl else {
            isRecording = false
            enrollmentError = "Recording could not be saved. Please try again."
            showErrorAlert = true
            return
        }

        isRecording = false
        recordedPhrases.insert(currentPhraseIndex)

        // Upload in background, then auto-advance
        Task {
            await uploadChunk(
                sessionId: session.sessionId,
                chunkId: uploadUrl.chunkId,
                localUrl: url,
                uploadUrl: uploadUrl
            )
        }
    }

    private func advanceToNextPhrase() {
        guard currentPhraseIndex < prompts.count - 1 else { return }
        withAnimation(.easeInOut(duration: 0.2)) {
            currentPhraseIndex += 1
        }
    }

    // MARK: - Backend Integration

    private func startEnrollmentSession() async {
        isStartingSession = true
        defer { isStartingSession = false }

        do {
            let session = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "startEnrollment") {
                try await apiClient.client.startEnrollment()
            }
            enrollmentSession = session
            currentUploadUrl = session.uploadUrls?.first
        } catch {
            enrollmentError = "Failed to start enrollment: \(error.localizedDescription)"
            showErrorAlert = true
        }
    }

    private func uploadChunk(
        sessionId: String,
        chunkId: String,
        localUrl: URL,
        uploadUrl: UploadURL
    ) async {
        isUploading = true
        defer { isUploading = false }

        do {
            guard let audioData = try? Data(contentsOf: localUrl) else {
                throw APIClientError.invalidResponse
            }

            let duration = recorder.recordingDuration() ?? max(0.1, recorder.duration)

            let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "uploadChunk") {
                try await apiClient.client.uploadChunk(
                    sessionId: sessionId,
                    chunkId: chunkId,
                    audioData: audioData,
                    uploadUrl: uploadUrl,
                    durationSec: duration,
                    checksum: nil
                )
            }

            // Get next upload URL for next phrase
            currentUploadUrl = response.nextUploadUrl

            // Auto-advance after upload completes
            await MainActor.run {
                if currentPhraseIndex < prompts.count - 1 {
                    advanceToNextPhrase()
                }
                // Note: Don't auto-complete on last phrase - let user tap "Complete" button
            }
        } catch {
            await MainActor.run {
                enrollmentError = "Upload failed: \(error.localizedDescription)"
                showErrorAlert = true
            }
        }
    }

    private func completeEnrollmentFlow() async {
        guard let session = enrollmentSession else { return }

        isCompletingEnrollment = true
        defer { isCompletingEnrollment = false }

        // Stop audio analyzer before completing
        await MainActor.run {
            audioAnalyzer.stop()
        }

        do {
            let profile = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "completeEnrollment") {
                try await apiClient.client.completeEnrollment(sessionId: session.sessionId)
            }

            await MainActor.run {
                // Determine quality tier from profile score
                let tier: QualityTier
                if let score = profile.qualityScore {
                    tier = QualityTier(from: score)
                } else {
                    // Default to good if score not yet available (processing)
                    tier = .good
                }

                completedQualityTier = tier
                enrollmentError = nil
                completedProfile = profile
                showCompletionView = true
            }
        } catch {
            await MainActor.run {
                enrollmentError = "Enrollment failed: \(error.localizedDescription)"
                showErrorAlert = true
            }
        }
    }
}

// MARK: - EnrollmentPrompt Extension

extension EnrollmentPrompt {
    /// Hint text for the enrollment prompt
    var hint: String {
        type == "spoken"
            ? "Read this phrase naturally, like you're speaking to a friend."
            : "Sing this phrase in your natural voice."
    }
}

// MARK: - Waveform Bar

private struct WaveformBar: View {
    let isAnimating: Bool
    let delay: Double

    @State private var height: CGFloat = 8

    var body: some View {
        RoundedRectangle(cornerRadius: 2)
            .fill(DesignTokens.gold)
            .frame(width: 4, height: height)
            .onAppear {
                if isAnimating {
                    startAnimation()
                }
            }
            .onChange(of: isAnimating) { _, newValue in
                if newValue {
                    startAnimation()
                } else {
                    height = 8
                }
            }
    }

    private func startAnimation() {
        withAnimation(
            .easeInOut(duration: 0.3)
            .repeatForever(autoreverses: true)
            .delay(delay)
        ) {
            height = CGFloat.random(in: 12...32)
        }
    }
}

// MARK: - Preview

#Preview {
    VoiceEnrollmentView(completedProfile: .constant(nil))
        .environment(APIClientWrapper(baseURL: AppConfig.apiBaseURL))
}
