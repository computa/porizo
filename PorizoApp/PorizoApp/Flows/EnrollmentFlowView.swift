//
//  EnrollmentFlowView.swift
//  PorizoApp
//
//  Voice enrollment flow for recording prompts and creating a voice profile.
//  Used from SettingsTabView for initial enrollment and re-enrollment.
//

import SwiftUI
import CryptoKit

struct EnrollmentFlowView: View {
    let apiClient: APIClient
    let existingScore: Double?  // For re-enrollment comparison display
    let onComplete: () -> Void

    init(apiClient: APIClient, existingScore: Double? = nil, onComplete: @escaping () -> Void) {
        self.apiClient = apiClient
        self.existingScore = existingScore
        self.onComplete = onComplete
    }

    @State private var recorder = AudioRecorder()

    @State private var currentStep: EnrollmentStep = .welcome
    @State private var sessionId: String?
    @State private var prompts: [EnrollmentPrompt] = []
    @State private var currentPromptIndex: Int = 0
    @State private var uploadedChunkIds: Set<String> = []
    @State private var uploadUrlsByChunkId: [String: UploadURL] = [:]
    @State private var qualityScore: Int?

    @State private var isLoading = false
    @State private var showingError = false
    @State private var errorMessage = ""

    // Enrollment outcome for re-enrollment flow
    @State private var enrollmentOutcome: EnrollmentOutcome?
    @State private var newScore: Double?

    // Task references for proper cancellation on view disappear
    @State private var enrollmentTask: Task<Void, Never>?
    @State private var pollingTask: Task<Void, Never>?
    @State private var countdownTask: Task<Void, Never>?
    @State private var uploadTask: Task<Void, Never>?

    // Countdown timer state
    @State private var countdownSeconds: Int = 0
    @State private var isCountingDown: Bool = false
    private let recordingDuration: Int = 5  // seconds per recording

    // Processing status cycling
    @State private var processingStatusIndex: Int = 0


    enum EnrollmentStep {
        case welcome
        case recording
        case processing
        case completed
    }

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 0) {
                switch currentStep {
                case .welcome:
                    welcomeView

                case .recording:
                    recordingView

                case .processing:
                    processingView

                case .completed:
                    completedView
                }
            }
        }
        .alert("Error", isPresented: $showingError) {
            Button("OK", role: .cancel) { }
        } message: {
            Text(errorMessage)
        }
        .onDisappear {
            enrollmentTask?.cancel()
            pollingTask?.cancel()
            countdownTask?.cancel()
            uploadTask?.cancel()
            if recorder.isRecording {
                _ = recorder.stopRecording()
            }
        }
    }

    // MARK: - Welcome View

    private var welcomeView: some View {
        VStack(spacing: 0) {
            // Back button
            HStack {
                Button { dismiss() } label: {
                    Image(systemName: "arrow.left")
                        .font(.system(size: 18))
                        .foregroundStyle(DesignTokens.textPrimary)
                        .frame(width: 44, height: 44)
                        .background(Color.black.opacity(0.05))
                        .clipShape(Circle())
                }
                Spacer()
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)

            Spacer()

            // Icon
            Circle()
                .fill(DesignTokens.gold)
                .frame(width: 64, height: 64)
                .overlay(
                    Image(systemName: "mic.fill")
                        .font(.system(size: 32))
                        .foregroundStyle(.white)
                )

            // Title + Subtitle
            VStack(spacing: DesignTokens.spacing12) {
                Text("Make it sound\nlike you")
                    .font(DesignTokens.displayFont(size: 24))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .multilineTextAlignment(.center)

                Text("Record a few phrases and your songs will sing in your voice")
                    .font(DesignTokens.bodyFont(size: 15))
                    .foregroundStyle(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 32)
            .padding(.top, DesignTokens.spacing16)

            // 3-step progress indicator
            HStack(spacing: 0) {
                ForEach([(1, "Record\nphrases"), (2, "We\nprocess"), (3, "Songs in\nyour voice")], id: \.0) { step, label in
                    if step > 1 {
                        // Connector line
                        Rectangle()
                            .fill(DesignTokens.textTertiary.opacity(0.3))
                            .frame(height: 2)
                            .frame(maxWidth: 32)
                    }
                    VStack(spacing: 6) {
                        Circle()
                            .fill(DesignTokens.gold.opacity(0.1))
                            .frame(width: 44, height: 44)
                            .overlay(
                                Text("\(step)")
                                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                                    .foregroundStyle(DesignTokens.gold)
                            )
                        Text(label)
                            .font(DesignTokens.bodyFont(size: 12))
                            .foregroundStyle(DesignTokens.textSecondary)
                            .multilineTextAlignment(.center)
                    }
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Three steps: Record phrases, We process, Songs in your voice")
            .padding(.top, 32)

            Spacer()

            // CTA
            VStack(spacing: DesignTokens.spacing16) {
                Button {
                    startEnrollment()
                } label: {
                    Text("Start Recording")
                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(DesignTokens.gold)
                        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
                }
                .disabled(isLoading)

                Button { dismiss() } label: {
                    Text("Maybe later")
                        .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                        .foregroundStyle(DesignTokens.textSecondary)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 40)
        }
    }

    // MARK: - Recording View

    private var recordingView: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 20) {
                // Header: "Phrase N of M" + close button
                HStack {
                    Text("Phrase \(currentPromptIndex + 1) of \(max(prompts.count, 6))")
                        .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        .foregroundStyle(DesignTokens.textPrimary)
                    Spacer()
                    Button { dismiss() } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(DesignTokens.textSecondary)
                            .frame(width: 30, height: 30)
                            .background(Color.black.opacity(0.05))
                            .clipShape(Circle())
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 16)

                // Progress dots
                HStack(spacing: 6) {
                    let totalDots = max(prompts.count, 6)
                    ForEach(0..<totalDots, id: \.self) { i in
                        Circle()
                            .fill(i <= currentPromptIndex ? DesignTokens.gold : DesignTokens.border)
                            .frame(width: 8, height: 8)
                    }
                }

                Spacer()

                // Prompt card
                if currentPromptIndex < prompts.count {
                    Text(prompts[currentPromptIndex].text)
                        .font(DesignTokens.displayFont(size: 20))
                        .foregroundStyle(DesignTokens.textPrimary)
                        .multilineTextAlignment(.center)
                        .padding(24)
                        .frame(maxWidth: .infinity)
                        .background(DesignTokens.surface)
                        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusLarge))
                        .padding(.horizontal, 20)
                }

                EnrollmentLevelMeter(isRecording: recorder.isRecording)

                // Record button
                Button {
                    if recorder.isRecording {
                        cancelCountdownAndStopRecording()
                    } else {
                        startRecordingWithCountdown()
                    }
                } label: {
                    Circle()
                        .fill(recorder.isRecording ? DesignTokens.error : DesignTokens.gold)
                        .frame(width: 72, height: 72)
                        .overlay(
                            Group {
                                if recorder.isRecording {
                                    RoundedRectangle(cornerRadius: 4)
                                        .fill(.white)
                                        .frame(width: 24, height: 24)
                                } else {
                                    Image(systemName: "mic.fill")
                                        .font(.system(size: 28))
                                        .foregroundStyle(.white)
                                }
                            }
                        )
                }
                .disabled(isLoading)
                .accessibilityLabel(recorder.isRecording ? "Stop recording" : "Start recording")
                .accessibilityValue(recorder.isRecording ? "\(countdownSeconds) seconds remaining" : "Ready to record")

                EnrollmentCountdownLabel(
                    isRecording: recorder.isRecording,
                    countdownSeconds: countdownSeconds
                )

                Spacer()

                // Upload progress / Next indicator
                Group {
                    if isLoading {
                        HStack(spacing: 8) {
                            ProgressView().tint(.white)
                            Text("Uploading...")
                                .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                        }
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(DesignTokens.gold.opacity(0.6))
                        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
                    } else {
                        Text("Next →")
                            .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(DesignTokens.gold)
                            .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
                            .opacity(0.4)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 32)
            }
        }
    }

    // MARK: - Processing View

    private let processingStatuses = [
        "Analyzing quality...",
        "Checking clarity...",
        "Building voice model...",
        "Almost done..."
    ]

    private var processingView: some View {
        VStack(spacing: 20) {
            Spacer()

            ProgressView()
                .scaleEffect(1.5)
                .tint(DesignTokens.gold)

            Text("Processing your voice...")
                .font(DesignTokens.displayFont(size: 20))
                .foregroundStyle(DesignTokens.textPrimary)

            Text("This takes about 30 seconds")
                .font(DesignTokens.bodyFont(size: 13))
                .foregroundStyle(DesignTokens.textTertiary)

            Text(processingStatuses[processingStatusIndex % processingStatuses.count])
                .font(DesignTokens.bodyFont(size: 14))
                .foregroundStyle(DesignTokens.textSecondary)
                .animation(.easeInOut(duration: 0.4), value: processingStatusIndex)

            Spacer()
        }
        .task {
            processingStatusIndex = 0
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(2.5))
                guard !Task.isCancelled else { return }
                processingStatusIndex += 1
            }
        }
    }

    // MARK: - Completed View

    private var completedView: some View {
        VStack(spacing: 16) {
            Spacer()

            // Sage checkmark circle
            Circle()
                .fill(DesignTokens.sage)
                .frame(width: 64, height: 64)
                .overlay(
                    Image(systemName: "checkmark")
                        .font(.system(size: 28, weight: .semibold))
                        .foregroundStyle(.white)
                )

            // Title
            Text(outcomeTitle)
                .font(DesignTokens.displayFont(size: 24))
                .foregroundStyle(DesignTokens.textPrimary)

            // Score display
            VStack(spacing: 8) {
                if let outcome = enrollmentOutcome,
                   outcome == .keptExisting,
                   let newScoreVal = newScore,
                   let existingScoreVal = existingScore {
                    Text("New attempt: \(Int(newScoreVal))/100")
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundStyle(DesignTokens.textTertiary)
                    Text("Your \(Int(existingScoreVal))/100 profile is better")
                        .font(DesignTokens.bodyFont(size: 14, weight: .medium))
                        .foregroundStyle(DesignTokens.textSecondary)
                } else if let outcome = enrollmentOutcome,
                          outcome == .upgraded,
                          let existingScoreVal = existingScore,
                          let newScoreVal = qualityScore {
                    HStack(spacing: 8) {
                        Text("\(Int(existingScoreVal))/100")
                            .font(DesignTokens.bodyFont(size: 14))
                            .foregroundStyle(DesignTokens.textTertiary)
                            .strikethrough()
                        Image(systemName: "arrow.right")
                            .font(.system(size: 12))
                            .foregroundStyle(DesignTokens.sage)
                        Text("\(newScoreVal)/100")
                            .font(DesignTokens.bodyFont(size: 14, weight: .semibold))
                            .foregroundStyle(DesignTokens.sage)
                    }
                } else if let score = qualityScore {
                    Text("Quality: \(score)/100")
                        .font(DesignTokens.bodyFont(size: 14))
                        .foregroundStyle(DesignTokens.textSecondary)

                    // Quality bar
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            RoundedRectangle(cornerRadius: 4)
                                .fill(DesignTokens.border)
                                .frame(height: 8)
                            RoundedRectangle(cornerRadius: 4)
                                .fill(DesignTokens.sage)
                                .frame(width: geo.size.width * CGFloat(score) / 100.0, height: 8)
                        }
                    }
                    .frame(height: 8)
                }
            }
            .frame(width: 260)

            // Outcome message
            Text(outcomeMessage)
                .font(DesignTokens.bodyFont(size: 15))
                .foregroundStyle(DesignTokens.sage)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)

            Spacer()

            // CTA
            Button {
                onComplete()
            } label: {
                Text(outcomeButtonText)
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(DesignTokens.gold)
                    .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusCTA))
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 40)
        }
    }

    // MARK: - Outcome Helpers

    private var outcomeTitle: String {
        guard let outcome = enrollmentOutcome else {
            return "Voice enrolled!"
        }
        switch outcome {
        case .new: return "Voice enrolled!"
        case .upgraded: return "Voice upgraded!"
        case .keptExisting: return "Enrollment complete"
        }
    }

    private var outcomeMessage: String {
        guard let outcome = enrollmentOutcome else {
            if let score = qualityScore, score >= 70 {
                return "Excellent — your songs will sound great"
            }
            return "Your songs will now sing in your voice"
        }
        switch outcome {
        case .new:
            if let score = qualityScore, score >= 70 {
                return "Excellent — your songs will sound great"
            }
            return "Your songs will now sing in your voice"
        case .upgraded:
            return "Nice improvement! Your songs will sound even better"
        case .keptExisting:
            return "Your existing profile was kept because it has better quality"
        }
    }

    private var outcomeButtonText: String {
        guard let outcome = enrollmentOutcome else {
            return "Done"
        }
        switch outcome {
        case .new, .upgraded: return "Done"
        case .keptExisting: return "Done"
        }
    }

    // MARK: - Actions

    private func startEnrollment() {
        isLoading = true
        enrollmentTask = Task {
            do {
                let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "startEnrollment") {
                    try await apiClient.startEnrollment()
                }
                await MainActor.run {
                    sessionId = response.sessionId
                    prompts = response.prompts ?? []
                    uploadUrlsByChunkId = Dictionary(
                        uniqueKeysWithValues: (response.uploadUrls ?? []).map { ($0.chunkId, $0) }
                    )
                    isLoading = false
                    withAnimation {
                        currentStep = .recording
                    }
                }
            } catch {
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    showingError = true
                    isLoading = false
                }
            }
        }
    }

    private func startRecordingWithCountdown() {
        do {
            try recorder.startRecording()
            countdownSeconds = recordingDuration
            isCountingDown = true

            // Start countdown timer
            countdownTask?.cancel()
            countdownTask = Task { @MainActor in
                while countdownSeconds > 0 && !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(1))
                    guard !Task.isCancelled else { return }
                    countdownSeconds -= 1
                }

                // Auto-stop when countdown reaches zero
                guard !Task.isCancelled, recorder.isRecording else { return }
                isCountingDown = false
                _ = recorder.stopRecording()
                uploadCurrentRecording()
            }
        } catch {
            errorMessage = error.localizedDescription
            showingError = true
        }
    }

    private func cancelCountdownAndStopRecording() {
        countdownTask?.cancel()
        countdownTask = nil
        isCountingDown = false
        countdownSeconds = 0

        if recorder.isRecording {
            _ = recorder.stopRecording()
            uploadCurrentRecording()
        }
    }

    private func uploadCurrentRecording() {
        guard let sessionId = sessionId,
              let url = recorder.recordingURL,
              currentPromptIndex < prompts.count else { return }

        let prompt = prompts[currentPromptIndex]
        guard let uploadUrl = uploadUrlsByChunkId[prompt.id] else {
            startEnrollment()
            return
        }

        isLoading = true
        uploadTask?.cancel()
        uploadTask = Task {
            do {
                let (data, checksum) = try await Task.detached(priority: .userInitiated) {
                    let data = try Data(contentsOf: url)
                    let checksum = SHA256.hash(data: data)
                        .map { String(format: "%02x", $0) }
                        .joined()
                    return (data, checksum)
                }.value
                guard !Task.isCancelled else { return }
                let durationSec = recorder.recordingDuration() ?? max(0.1, recorder.duration)
                let response = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "uploadChunk") {
                    try await apiClient.uploadChunk(
                        sessionId: sessionId,
                        chunkId: prompt.id,
                        audioData: data,
                        uploadUrl: uploadUrl,
                        durationSec: durationSec,
                        checksum: checksum
                    )
                }

                guard !Task.isCancelled else { return }
                await MainActor.run {
                    guard !Task.isCancelled else { return }
                    if response.status == "accepted" {
                        uploadedChunkIds.insert(prompt.id)
                    }
                    if let nextUploadUrl = response.nextUploadUrl {
                        uploadUrlsByChunkId[nextUploadUrl.chunkId] = nextUploadUrl
                    }
                    recorder.deleteRecording()
                    isLoading = false

                    // Move to next prompt or finish
                    if currentPromptIndex < prompts.count - 1 {
                        currentPromptIndex += 1
                    } else {
                        finalizeEnrollment()
                    }
                }
            } catch {
                await MainActor.run {
                    guard !Task.isCancelled else { return }
                    errorMessage = error.localizedDescription
                    showingError = true
                    isLoading = false
                }
            }
        }
    }

    private func finalizeEnrollment() {
        guard let sessionId = sessionId else { return }

        withAnimation {
            currentStep = .processing
        }

        pollingTask?.cancel()
        pollingTask = Task {
            do {
                let result = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "completeEnrollment") {
                    try await apiClient.completeEnrollment(sessionId: sessionId)
                }

                // Capture outcome from enrollment response
                await MainActor.run {
                    if let outcomeString = result.outcome {
                        enrollmentOutcome = EnrollmentOutcome(rawValue: outcomeString)
                    }
                    if let quality = result.quality {
                        newScore = quality.newScore
                        qualityScore = Int(quality.score)
                    }
                }

                // Server creates profile synchronously — if we have a score, skip polling
                if qualityScore != nil {
                    await MainActor.run {
                        withAnimation { currentStep = .completed }
                    }
                    return
                }

                // Fallback: poll for profile if score wasn't in the response
                await pollForVoiceProfile(estimatedCompletionSec: result.estimatedCompletionSec)
            } catch {
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    showingError = true
                    currentStep = .recording
                }
            }
        }
    }

    private func pollForVoiceProfile(estimatedCompletionSec: Int? = nil) async {
        var consecutiveFailures = 0
        // Floor of 180s defends against stale server hints (older deploys
        // returned 30s, which timed out the polling sheet on the happy path
        // even though the persona-creation pipeline takes 2–4 minutes wall
        // clock at Suno). The hint bumps the budget further when the server
        // signals a longer-than-typical run.
        let hintSeconds = estimatedCompletionSec ?? 180
        let maxSeconds = max(180, hintSeconds * 2)
        let attempts = max(90, maxSeconds / 2)

        for _ in 0..<attempts {
            // Check for cancellation before sleeping
            guard !Task.isCancelled else { return }

            try? await Task.sleep(for: .seconds(2))

            // Check again after sleep (in case cancelled while sleeping)
            guard !Task.isCancelled else { return }

            do {
                let status = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "getVoiceProfile") {
                    try await apiClient.getVoiceProfile()
                }
                consecutiveFailures = 0  // Reset on any successful response

                if status.hasProfile, let score = status.qualityScore {
                    await MainActor.run {
                        // Only update qualityScore if not already set from enrollment response
                        if qualityScore == nil {
                            qualityScore = Int(score)
                        }
                        withAnimation {
                            currentStep = .completed
                        }
                    }
                    return
                }
            } catch {
                consecutiveFailures += 1
                print("[Enrollment] Poll attempt failed (\(consecutiveFailures)): \(error.localizedDescription)")

                // Surface persistent failures after 5 consecutive errors
                if consecutiveFailures >= 5 {
                    await MainActor.run {
                        errorMessage = "Unable to verify voice profile. Please check your connection and try again."
                        showingError = true
                        dismiss()
                    }
                    return
                }
                continue
            }
        }

        // Timeout (only show if not cancelled)
        guard !Task.isCancelled else { return }
        await MainActor.run {
            errorMessage = "Voice profile is still processing. You can check back from Settings."
            showingError = true
            dismiss()
        }
    }
}

private struct EnrollmentLevelMeter: View {
    let isRecording: Bool

    var body: some View {
        HStack(spacing: 4) {
            ForEach([15, 25, 35, 25, 15], id: \.self) { height in
                RoundedRectangle(cornerRadius: 2)
                    .fill(DesignTokens.gold.opacity(isRecording ? 1.0 : 0.3))
                    .frame(width: 4, height: CGFloat(height))
            }
        }
        .frame(height: 40)
        .animation(
            isRecording
                ? .easeInOut(duration: 0.3).repeatForever(autoreverses: true)
                : .easeOut(duration: 0.3),
            value: isRecording
        )
    }
}

private struct EnrollmentCountdownLabel: View {
    let isRecording: Bool
    let countdownSeconds: Int

    var body: some View {
        Text(isRecording ? "Recording... \(countdownSeconds)s" : "Tap to record")
            .font(DesignTokens.bodyFont(size: 13))
            .foregroundStyle(DesignTokens.textTertiary)
    }
}
