//
//  RootView.swift
//  PorizoApp
//
//  Root view that handles app state: enrollment vs main app.
//

import SwiftUI

struct RootView: View {
    @State private var appState: RootState = .loading
    @State private var apiClient: APIClient?

    // Configuration
    #if DEBUG
    private let serverURL = "http://172.20.10.11:3000"
    #else
    private let serverURL = "https://api.porizo.com"
    #endif

    enum RootState {
        case loading
        case enrollment
        case main
    }

    var body: some View {
        Group {
            switch appState {
            case .loading:
                loadingView

            case .enrollment:
                if let client = apiClient {
                    EnrollmentFlowView(
                        apiClient: client,
                        onComplete: {
                            withAnimation {
                                appState = .main
                            }
                        }
                    )
                }

            case .main:
                if let client = apiClient {
                    MainTabView(apiClient: client)
                }
            }
        }
        .onAppear {
            initializeApp()
        }
    }

    private var loadingView: some View {
        VStack(spacing: 16) {
            ProgressView()
                .scaleEffect(1.2)

            Text("Loading...")
                .foregroundColor(.secondary)
        }
    }

    private func initializeApp() {
        // Create API client with device ID
        let deviceId = getOrCreateDeviceId()
        let client = APIClient(baseURL: serverURL, userId: deviceId)
        self.apiClient = client

        // Check if user has a voice profile
        Task {
            do {
                let status = try await client.getVoiceProfile()
                await MainActor.run {
                    withAnimation {
                        if status.hasProfile {
                            appState = .main
                        } else {
                            appState = .enrollment
                        }
                    }
                }
            } catch {
                // On error, go to enrollment (will show welcome)
                await MainActor.run {
                    withAnimation {
                        appState = .enrollment
                    }
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

// MARK: - Enrollment Flow View

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
    @State private var qualityScore: Int?
    @State private var consentGranted = false

    @State private var isLoading = false
    @State private var showingError = false
    @State private var errorMessage = ""

    enum EnrollmentStep {
        case welcome
        case recording
        case processing
        case completed
    }

    var body: some View {
        NavigationStack {
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
            .navigationTitle(navigationTitle)
            .navigationBarTitleDisplayMode(.inline)
            .alert("Error", isPresented: $showingError) {
                Button("OK", role: .cancel) { }
            } message: {
                Text(errorMessage)
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

            Image(systemName: "waveform.circle.fill")
                .font(.system(size: 80))
                .foregroundColor(.accentColor)

            VStack(spacing: 12) {
                Text("Let's Set Up Your Voice")
                    .font(.title.bold())

                Text("Record a few phrases so your songs can sound like you singing. This takes about 2 minutes.")
                    .multilineTextAlignment(.center)
                    .foregroundColor(.secondary)
                    .padding(.horizontal, 32)
            }

            Spacer()

            // Consent toggle
            Toggle(isOn: $consentGranted) {
                Text("I consent to my voice being used to create personalized songs")
                    .font(.subheadline)
            }
            .padding(.horizontal, 24)

            Button {
                startEnrollment()
            } label: {
                Text("Get Started")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(consentGranted ? Color.accentColor : Color.gray)
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
                    .foregroundColor(.secondary)
                Spacer()
            }
            .padding(.horizontal)

            ProgressView(value: Double(currentPromptIndex), total: Double(prompts.count))
                .padding(.horizontal)

            Spacer()

            // Current prompt
            if currentPromptIndex < prompts.count {
                let prompt = prompts[currentPromptIndex]

                VStack(spacing: 16) {
                    Text(prompt.type == "spoken" ? "Say this:" : "Sing this:")
                        .font(.subheadline)
                        .foregroundColor(.secondary)

                    Text(prompt.text)
                        .font(.title2)
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
                        .fill(recorder.isRecording ? Color.red : Color.accentColor)
                        .frame(width: 80, height: 80)

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
                .foregroundColor(.secondary)

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

            Text("Creating your voice profile...")
                .font(.headline)

            Text("This may take a minute")
                .foregroundColor(.secondary)

            Spacer()
        }
    }

    // MARK: - Completed View

    private var completedView: some View {
        VStack(spacing: 24) {
            Spacer()

            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 80))
                .foregroundColor(.green)

            VStack(spacing: 12) {
                Text("Voice Profile Ready!")
                    .font(.title.bold())

                if let score = qualityScore {
                    Text("Quality score: \(score)%")
                        .foregroundColor(.secondary)
                }

                Text("You can now create personalized songs that sound like you.")
                    .multilineTextAlignment(.center)
                    .foregroundColor(.secondary)
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
                    .background(Color.accentColor)
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
        Task {
            do {
                let response = try await apiClient.startEnrollment()
                await MainActor.run {
                    sessionId = response.sessionId
                    promptSetId = response.promptSetId
                    prompts = response.prompts ?? []
                    recordingSettings = response.recordingSettings
                    isLoading = false
                    withAnimation {
                        currentStep = .recording
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

        isLoading = true
        Task {
            do {
                let data = try Data(contentsOf: url)
                let response = try await apiClient.uploadChunk(
                    sessionId: sessionId,
                    chunkId: prompt.id,
                    audioData: data
                )

                await MainActor.run {
                    uploadedChunkIds.insert(response.chunkId)
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

        Task {
            do {
                _ = try await apiClient.completeEnrollment(sessionId: sessionId)
                // Poll for completion
                await pollForVoiceProfile()
            } catch {
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
            try? await Task.sleep(nanoseconds: 2_000_000_000) // 2 seconds

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

        // Timeout
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
