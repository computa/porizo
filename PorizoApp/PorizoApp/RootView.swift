//
//  RootView.swift
//  PorizoApp
//
//  Root view that handles app state: splash → onboarding → main app.
//  Light mode design for love and friendship.
//

import SwiftUI
import CryptoKit

struct RootView: View {
    @State private var appState: RootState = .splash
    @State private var apiClient: APIClient?
    @AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding = false

    // Configuration
    #if DEBUG
    // For simulator: use localhost
    // For physical device: use Mac's IP (ifconfig | grep "inet " | grep -v 127.0.0.1)
    #if targetEnvironment(simulator)
    private let serverURL = "http://localhost:3000"
    #else
    private let serverURL = "http://192.168.0.86:3000"
    #endif
    #else
    private let serverURL = "https://api.porizo.com"
    #endif

    enum RootState {
        case splash
        case onboarding
        case main
    }

    var body: some View {
        Group {
            switch appState {
            case .splash:
                SplashView()
                    .onAppear {
                        // Initialize API client
                        let deviceId = getOrCreateDeviceId()
                        apiClient = APIClient(baseURL: serverURL, userId: deviceId)

                        // Transition after splash animation (2.5 seconds) using modern Swift concurrency
                        Task { @MainActor in
                            try? await Task.sleep(for: .seconds(2.5))
                            withAnimation(.easeInOut(duration: 0.5)) {
                                if hasCompletedOnboarding {
                                    appState = .main
                                } else {
                                    appState = .onboarding
                                }
                            }
                        }
                    }

            case .onboarding:
                OnboardingView(
                    onComplete: {
                        hasCompletedOnboarding = true
                        withAnimation(.easeInOut(duration: 0.5)) {
                            appState = .main
                        }
                    },
                    onSkip: {
                        hasCompletedOnboarding = true
                        withAnimation(.easeInOut(duration: 0.5)) {
                            appState = .main
                        }
                    }
                )

            case .main:
                if let client = apiClient {
                    MainTabView(apiClient: client)
                } else {
                    // Fallback - create client if needed
                    MainTabView(apiClient: APIClient(baseURL: serverURL, userId: getOrCreateDeviceId()))
                }
            }
        }
    }

    private func getOrCreateDeviceId() -> String {
        let key = "porizo_device_id"
        if let existing = UserDefaults.standard.string(forKey: key) {
            return existing
        }
        let newId = "ios_\(UUID().uuidString.prefix(12).lowercased())"
        UserDefaults.standard.set(newId, forKey: key)
        return newId
    }
}

// MARK: - Enrollment Flow View (for Settings)

struct EnrollmentFlowView: View {
    let apiClient: APIClient
    let onComplete: () -> Void

    @StateObject private var recorder = AudioRecorder()

    @State private var currentStep: EnrollmentStep = .welcome
    @State private var sessionId: String?
    @State private var promptSetId: String?
    @State private var prompts: [EnrollmentPrompt] = []
    @State private var currentPromptIndex: Int = 0
    @State private var recordingSettings: RecordingSettings?
    @State private var uploadedChunkIds: Set<String> = []
    @State private var uploadUrlsByChunkId: [String: UploadURL] = [:]
    @State private var qualityScore: Int?
    @State private var consentGranted = false

    @State private var isLoading = false
    @State private var showingError = false
    @State private var errorMessage = ""

    // Task references for proper cancellation on view disappear
    @State private var enrollmentTask: Task<Void, Never>?
    @State private var pollingTask: Task<Void, Never>?

    enum EnrollmentStep {
        case welcome
        case recording
        case processing
        case completed
    }

    var body: some View {
        NavigationStack {
            ZStack {
                DesignTokens.background.ignoresSafeArea()

                VStack {
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
            .navigationTitle(navigationTitle)
            .navigationBarTitleDisplayMode(.inline)
            .alert("Error", isPresented: $showingError) {
                Button("OK", role: .cancel) { }
            } message: {
                Text(errorMessage)
            }
            .onDisappear {
                // Cancel any running tasks to prevent resource leaks
                enrollmentTask?.cancel()
                pollingTask?.cancel()
            }
        }
    }

    private var navigationTitle: String {
        switch currentStep {
        case .welcome: return "Voice Enrollment"
        case .recording: return "Record Your Voice"
        case .processing: return "Processing"
        case .completed: return "Complete"
        }
    }

    // MARK: - Welcome View

    private var welcomeView: some View {
        VStack(spacing: 24) {
            Spacer()

            // Icon with rose theme
            ZStack {
                Circle()
                    .fill(DesignTokens.roseMuted)
                    .frame(width: 120, height: 120)

                Image(systemName: "waveform.circle.fill")
                    .font(.system(size: 56))
                    .foregroundColor(DesignTokens.rose)
            }

            VStack(spacing: 12) {
                Text("Let's Set Up Your Voice")
                    .font(.title.bold())
                    .foregroundColor(DesignTokens.textPrimary)

                Text("Record a few phrases so your songs can sound like you singing. This takes about 2 minutes.")
                    .multilineTextAlignment(.center)
                    .foregroundColor(DesignTokens.textSecondary)
                    .padding(.horizontal, 32)
            }

            Spacer()

            // Consent toggle
            Toggle(isOn: $consentGranted) {
                Text("I consent to my voice being used to create personalized songs")
                    .font(.subheadline)
                    .foregroundColor(DesignTokens.textPrimary)
            }
            .toggleStyle(SwitchToggleStyle(tint: DesignTokens.rose))
            .padding(.horizontal, 24)

            Button {
                startEnrollment()
            } label: {
                Text("Get Started")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(consentGranted ? DesignTokens.rose : DesignTokens.textTertiary)
                    .foregroundColor(.white)
                    .cornerRadius(12)
            }
            .disabled(!consentGranted || isLoading)
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
    }

    // MARK: - Recording View

    private var recordingView: some View {
        VStack(spacing: 24) {
            // Progress
            HStack {
                Text("Prompt \(currentPromptIndex + 1) of \(prompts.count)")
                    .font(.subheadline)
                    .foregroundColor(DesignTokens.textSecondary)
                Spacer()
            }
            .padding(.horizontal)

            ProgressView(value: Double(currentPromptIndex), total: Double(prompts.count))
                .tint(DesignTokens.rose)
                .padding(.horizontal)

            Spacer()

            // Current prompt
            if currentPromptIndex < prompts.count {
                let prompt = prompts[currentPromptIndex]

                VStack(spacing: 16) {
                    Text(prompt.type == "spoken" ? "Say this:" : "Sing this:")
                        .font(.subheadline)
                        .foregroundColor(DesignTokens.textSecondary)

                    Text(prompt.text)
                        .font(.title2)
                        .foregroundColor(DesignTokens.textPrimary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                }
            }

            Spacer()

            // Recording button
            Button {
                if recorder.isRecording {
                    stopRecording()
                } else {
                    startRecording()
                }
            } label: {
                ZStack {
                    Circle()
                        .fill(recorder.isRecording ? DesignTokens.error : DesignTokens.rose)
                        .frame(width: 80, height: 80)
                        .accentShadow(color: recorder.isRecording ? DesignTokens.error : DesignTokens.rose)

                    if recorder.isRecording {
                        RoundedRectangle(cornerRadius: 4)
                            .fill(.white)
                            .frame(width: 24, height: 24)
                    } else {
                        Circle()
                            .fill(.white)
                            .frame(width: 24, height: 24)
                    }
                }
            }

            Text(recorder.isRecording ? "Tap to stop" : "Tap to record")
                .font(.subheadline)
                .foregroundColor(DesignTokens.textSecondary)

            Spacer()
        }
        .padding(.top)
    }

    // MARK: - Processing View

    private var processingView: some View {
        VStack(spacing: 24) {
            Spacer()

            ProgressView()
                .scaleEffect(1.5)
                .tint(DesignTokens.rose)

            Text("Creating your voice profile...")
                .font(.headline)
                .foregroundColor(DesignTokens.textPrimary)

            Text("This may take a minute")
                .foregroundColor(DesignTokens.textSecondary)

            Spacer()
        }
    }

    // MARK: - Completed View

    private var completedView: some View {
        VStack(spacing: 24) {
            Spacer()

            ZStack {
                Circle()
                    .fill(DesignTokens.success.opacity(0.1))
                    .frame(width: 120, height: 120)

                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 64))
                    .foregroundColor(DesignTokens.success)
            }

            VStack(spacing: 12) {
                Text("Voice Profile Ready!")
                    .font(.title.bold())
                    .foregroundColor(DesignTokens.textPrimary)

                if let score = qualityScore {
                    Text("Quality score: \(score)%")
                        .foregroundColor(DesignTokens.textSecondary)
                }

                Text("You can now create personalized songs that sound like you.")
                    .multilineTextAlignment(.center)
                    .foregroundColor(DesignTokens.textSecondary)
                    .padding(.horizontal, 32)
            }

            Spacer()

            Button {
                onComplete()
            } label: {
                Text("Start Creating")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(DesignTokens.rose)
                    .foregroundColor(.white)
                    .cornerRadius(12)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
    }

    // MARK: - Actions

    private func startEnrollment() {
        isLoading = true
        enrollmentTask = Task {
            do {
                let response = try await apiClient.startEnrollment()
                await MainActor.run {
                    sessionId = response.sessionId
                    promptSetId = response.promptSetId
                    prompts = response.prompts ?? []
                    recordingSettings = response.recordingSettings
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

    private func startRecording() {
        do {
            try recorder.startRecording()
        } catch {
            errorMessage = error.localizedDescription
            showingError = true
        }
    }

    private func stopRecording() {
        _ = recorder.stopRecording()
        uploadCurrentRecording()
    }

    private func uploadCurrentRecording() {
        guard let sessionId = sessionId,
              let url = recorder.recordingURL,
              currentPromptIndex < prompts.count else { return }

        let prompt = prompts[currentPromptIndex]
        guard let uploadUrl = uploadUrlsByChunkId[prompt.id] else {
            errorMessage = "Missing upload URL for this prompt. Please restart enrollment."
            showingError = true
            return
        }

        isLoading = true
        Task {
            do {
                let data = try Data(contentsOf: url)
                let durationSec = recorder.recordingDuration() ?? max(0.1, recorder.duration)
                let checksum = SHA256.hash(data: data)
                    .map { String(format: "%02x", $0) }
                    .joined()
                let response = try await apiClient.uploadChunk(
                    sessionId: sessionId,
                    chunkId: prompt.id,
                    audioData: data,
                    uploadUrl: uploadUrl,
                    durationSec: durationSec,
                    checksum: checksum
                )

                await MainActor.run {
                    if response.status == "accepted" {
                        uploadedChunkIds.insert(prompt.id)
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

        pollingTask = Task {
            do {
                _ = try await apiClient.completeEnrollment(sessionId: sessionId)
                // Poll for completion (check cancellation inside polling loop)
                await pollForVoiceProfile()
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

    private func pollForVoiceProfile() async {
        for _ in 0..<60 { // 2 minutes max
            // Check for cancellation before sleeping
            guard !Task.isCancelled else { return }

            try? await Task.sleep(nanoseconds: 2_000_000_000) // 2 seconds

            // Check again after sleep (in case cancelled while sleeping)
            guard !Task.isCancelled else { return }

            do {
                let status = try await apiClient.getVoiceProfile()
                if status.hasProfile, let score = status.qualityScore {
                    await MainActor.run {
                        qualityScore = Int(score)
                        withAnimation {
                            currentStep = .completed
                        }
                    }
                    return
                }
            } catch {
                continue
            }
        }

        // Timeout (only show if not cancelled)
        guard !Task.isCancelled else { return }
        await MainActor.run {
            errorMessage = "Voice profile processing timed out. Please try again."
            showingError = true
            currentStep = .welcome
        }
    }
}

#Preview {
    RootView()
}
