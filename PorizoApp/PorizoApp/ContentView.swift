//
//  ContentView.swift
//  PorizoApp
//
//  Voice enrollment flow with backend integration.
//  Light mode design with rose accents.
//

import SwiftUI
import CryptoKit

// Reference DesignTokens from MainTabView.swift

// MARK: - Enrollment State Persistence (C4)

/// Persisted state for resuming enrollment after app kill
struct PersistedEnrollmentState: Codable {
    let sessionId: String
    let promptSetId: String?
    let prompts: [EnrollmentPrompt]
    let currentPromptIndex: Int
    let uploadedChunkIds: [String]
    let recordingSettings: RecordingSettings?
    let savedAt: Date

    /// Check if state is still valid (not older than 1 hour)
    var isValid: Bool {
        Date().timeIntervalSince(savedAt) < 3600
    }
}

/// Manager for enrollment state persistence
enum EnrollmentStateManager {
    private static let key = "porizo_enrollment_state"

    /// Save current enrollment state
    static func save(
        sessionId: String,
        promptSetId: String?,
        prompts: [EnrollmentPrompt],
        currentPromptIndex: Int,
        uploadedChunkIds: Set<String>,
        recordingSettings: RecordingSettings?
    ) {
        let state = PersistedEnrollmentState(
            sessionId: sessionId,
            promptSetId: promptSetId,
            prompts: prompts,
            currentPromptIndex: currentPromptIndex,
            uploadedChunkIds: Array(uploadedChunkIds),
            recordingSettings: recordingSettings,
            savedAt: Date()
        )

        if let data = try? JSONEncoder().encode(state) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }

    /// Load saved enrollment state (returns nil if none or expired)
    static func load() -> PersistedEnrollmentState? {
        guard let data = UserDefaults.standard.data(forKey: key),
              let state = try? JSONDecoder().decode(PersistedEnrollmentState.self, from: data),
              state.isValid else {
            return nil
        }
        return state
    }

    /// Clear saved enrollment state
    static func clear() {
        UserDefaults.standard.removeObject(forKey: key)
    }

    /// Check if there's a resumable session
    static var hasResumableSession: Bool {
        load() != nil
    }
}

struct ContentView: View {
    @StateObject private var recorder = AudioRecorder()
    @State private var apiClient: APIClient?

    // App navigation state
    @State private var appState: AppState = .checkingProfile

    // Enrollment state
    @State private var currentStep: EnrollmentStep = .welcome
    @State private var sessionId: String?
    @State private var promptSetId: String?
    @State private var prompts: [EnrollmentPrompt] = []
    @State private var currentPromptIndex: Int = 0
    @State private var recordingSettings: RecordingSettings?
    @State private var uploadedChunkIds: Set<String> = []
    @State private var uploadUrlsByChunkId: [String: UploadURL] = [:]

    // Track creation state
    @State private var currentTrackId: String?
    @State private var currentVersionNum: Int?

    // Player state (shared)
    @StateObject private var playerState = PlayerState()

    // UI state
    @State private var isLoading = false
    @State private var showingError = false
    @State private var errorMessage = ""
    @State private var showingInterruptionAlert = false  // C5: Audio interruption alert
    @State private var showingResumeAlert = false  // C4: Offer to resume enrollment
    @State private var qualityScore: Int?
    @State private var hasVoiceProfile = false  // C8: Track if user has enrolled voice (persists across view updates)
    @State private var consentGranted = false

    // Configuration - Server URL based on build configuration
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

    enum AppState {
        case checkingProfile
        case enrollment
        case mySongs
        case storyWizard
        case creatingTrack
        case lyricsReview
        case trackPlayer
    }

    // Story context from wizard
    @State private var storyContext: StoryContext?

    enum EnrollmentStep {
        case welcome
        case recording  // Dynamic - uses currentPromptIndex
        case processing
        case completed
    }

    var body: some View {
        Group {
            switch appState {
            case .checkingProfile:
                loadingProfileView

            case .enrollment:
                enrollmentView

            case .mySongs:
                if let client = apiClient {
                    MySongsView(
                        apiClient: client,
                        playerState: playerState,
                        onCreateNew: {
                            appState = .storyWizard
                        },
                        onBack: {
                            appState = .enrollment
                            currentStep = .completed
                        },
                        onDraftSelected: { trackId, versionNum in
                            currentTrackId = trackId
                            currentVersionNum = versionNum
                            appState = .lyricsReview
                        }
                    )
                }

            case .storyWizard:
                if let client = apiClient {
                    NewStoryWizardView(
                        apiClient: client,
                        onComplete: { context in
                            storyContext = context
                            appState = .creatingTrack
                        },
                        onCancel: {
                            appState = .mySongs
                        }
                    )
                }

            case .creatingTrack:
                if let client = apiClient, let context = storyContext {
                    CreatingTrackView(
                        apiClient: client,
                        storyContext: context,
                        // C8: Default to myVoice if user has enrolled voice profile
                        voiceMode: hasVoiceProfile ? .myVoice : .aiVoice,
                        onTrackCreated: { trackId, versionNum in
                            currentTrackId = trackId
                            currentVersionNum = versionNum
                            storyContext = nil
                            appState = .lyricsReview
                        },
                        onError: { error in
                            // Show error and go back to wizard
                            errorMessage = error
                            showingError = true
                            appState = .storyWizard
                        }
                    )
                }

            case .lyricsReview:
                if let client = apiClient,
                   let trackId = currentTrackId,
                   let versionNum = currentVersionNum {
                    LyricsReviewView(
                        apiClient: client,
                        trackId: trackId,
                        versionNum: versionNum,
                        onApproved: {
                            appState = .trackPlayer
                        },
                        onBack: {
                            appState = .mySongs
                        }
                    )
                }

            case .trackPlayer:
                if let client = apiClient,
                   let trackId = currentTrackId,
                   let versionNum = currentVersionNum {
                    TrackPlayerView(
                        apiClient: client,
                        trackId: trackId,
                        versionNum: versionNum,
                        onDone: {
                            // Reset and go to My Songs
                            currentTrackId = nil
                            currentVersionNum = nil
                            appState = .mySongs
                        },
                        onNewSong: {
                            // Create another song
                            currentTrackId = nil
                            currentVersionNum = nil
                            appState = .storyWizard
                        }
                    )
                }
            }
        }
        .onAppear {
            apiClient = APIClient(baseURL: serverURL)
            checkVoiceProfile()
        }
    }

    // MARK: - Loading View

    private var loadingProfileView: some View {
        VStack(spacing: 24) {
            ProgressView()
                .scaleEffect(1.5)
                .tint(DesignTokens.rose)
            Text("Loading...")
                .font(.headline)
                .foregroundColor(DesignTokens.textSecondary)
        }
    }

    // MARK: - Enrollment View

    private var enrollmentView: some View {
        NavigationView {
            VStack(spacing: 24) {
                // Check for permission denied state first
                if recorder.permissionDenied {
                    permissionDeniedView
                } else {
                    switch currentStep {
                    case .welcome:
                        welcomeView
                    case .recording:
                        if let currentPrompt = currentPrompt {
                            recordingView(prompt: currentPrompt)
                        } else {
                            processingView // Fallback if no prompts
                        }
                    case .processing:
                        processingView
                    case .completed:
                        completedView
                    }
                }
            }
            .padding()
            .navigationTitle("Voice Enrollment")
            .navigationBarTitleDisplayMode(.inline)
            .alert("Error", isPresented: $showingError) {
                Button("OK") { }
            } message: {
                Text(errorMessage)
            }
            // C5: Show alert when recording is interrupted (e.g., by phone call)
            .alert("Recording Interrupted", isPresented: $showingInterruptionAlert) {
                Button("Retry") {
                    // User can try again manually
                }
            } message: {
                Text("Your recording was interrupted by a phone call or system event. Please try recording again.")
            }
            // C5: Detect when recording is interrupted
            .onChange(of: recorder.wasInterrupted) { _, wasInterrupted in
                if wasInterrupted {
                    showingInterruptionAlert = true
                }
            }
            // C4: Offer to resume incomplete enrollment
            .alert("Resume Enrollment?", isPresented: $showingResumeAlert) {
                Button("Resume") {
                    resumeEnrollment()
                }
                Button("Start Over", role: .destructive) {
                    EnrollmentStateManager.clear()
                    currentStep = .welcome
                }
            } message: {
                Text("You have an incomplete voice enrollment. Would you like to continue where you left off?")
            }
            // C4: Check for resumable session on appear
            .onAppear {
                if appState == .enrollment && currentStep == .welcome {
                    if EnrollmentStateManager.hasResumableSession {
                        showingResumeAlert = true
                    }
                }
            }
        }
    }

    // MARK: - Resume Enrollment (C4)

    private func resumeEnrollment() {
        guard let state = EnrollmentStateManager.load() else {
            EnrollmentStateManager.clear()
            return
        }

        // Restore state
        sessionId = state.sessionId
        promptSetId = state.promptSetId
        prompts = state.prompts
        currentPromptIndex = state.currentPromptIndex
        uploadedChunkIds = Set(state.uploadedChunkIds)
        recordingSettings = state.recordingSettings

        // Jump to recording step
        currentStep = .recording
    }

    // MARK: - Check Voice Profile

    private func checkVoiceProfile() {
        guard let client = apiClient else {
            appState = .enrollment
            return
        }

        Task {
            do {
                let profile = try await client.getVoiceProfile()
                await MainActor.run {
                    if profile.hasProfile {
                        // User already has a voice profile, go to My Songs
                        hasVoiceProfile = true  // C8: Track for voice mode routing
                        if let score = profile.qualityScore {
                            qualityScore = Int(score)
                        }
                        appState = .mySongs
                    } else {
                        // Need to enroll
                        hasVoiceProfile = false
                        appState = .enrollment
                    }
                }
            } catch {
                // On error, start enrollment
                await MainActor.run {
                    appState = .enrollment
                }
            }
        }
    }

    // MARK: - Permission Denied View

    private var permissionDeniedView: some View {
        VStack(spacing: 32) {
            Spacer()

            Image(systemName: "mic.slash.fill")
                .font(.system(size: 80))
                .foregroundColor(DesignTokens.error)

            VStack(spacing: 12) {
                Text("Microphone Access Required")
                    .font(.title2)
                    .fontWeight(.bold)
                    .foregroundColor(DesignTokens.textPrimary)

                Text("Porizo needs microphone access to record your voice and create personalized songs. Please enable microphone access in Settings.")
                    .font(.body)
                    .foregroundColor(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }

            Spacer()

            Button {
                openSettings()
            } label: {
                HStack {
                    Image(systemName: "gear")
                    Text("Open Settings")
                }
                .font(.headline)
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)
                .padding()
                .background(DesignTokens.rose)
                .cornerRadius(12)
            }

            Button {
                recorder.checkPermission()
            } label: {
                Text("I've Enabled Access")
                    .font(.subheadline)
                    .foregroundColor(DesignTokens.textSecondary)
            }
        }
    }

    private func openSettings() {
        guard let settingsURL = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(settingsURL)
    }

    // MARK: - Computed Properties

    /// Current prompt based on index
    private var currentPrompt: EnrollmentPrompt? {
        guard currentPromptIndex < prompts.count else { return nil }
        return prompts[currentPromptIndex]
    }

    /// Whether this is the last prompt
    private var isLastPrompt: Bool {
        currentPromptIndex == prompts.count - 1
    }

    /// Minimum recording duration (from server or default)
    private var minRecordingDuration: TimeInterval {
        Double(recordingSettings?.maxChunkDurationSec ?? 5)
    }

    // MARK: - Welcome View

    private var welcomeView: some View {
        VStack(spacing: 32) {
            Spacer()

            ZStack {
                Circle()
                    .fill(DesignTokens.roseMuted)
                    .frame(width: 120, height: 120)

                Image(systemName: "waveform.circle.fill")
                    .font(.system(size: 56))
                    .foregroundColor(DesignTokens.rose)
            }

            VStack(spacing: 12) {
                Text("Create Your Voice Profile")
                    .font(.title2)
                    .fontWeight(.bold)
                    .foregroundColor(DesignTokens.textPrimary)

                Text("We'll record your voice to create personalized songs that sound like you singing.")
                    .font(.body)
                    .foregroundColor(DesignTokens.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }

            VStack(alignment: .leading, spacing: 16) {
                enrollmentStepRow(number: 1, text: "Read a short phrase aloud")
                enrollmentStepRow(number: 2, text: "Sing a simple melody")
                enrollmentStepRow(number: 3, text: "We create your voice profile")
            }
            .padding()
            .background(DesignTokens.backgroundSubtle)
            .cornerRadius(12)

            // Consent checkbox - required before proceeding
            Button {
                consentGranted.toggle()
            } label: {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: consentGranted ? "checkmark.square.fill" : "square")
                        .font(.title2)
                        .foregroundColor(consentGranted ? DesignTokens.rose : DesignTokens.textTertiary)

                    Text("I consent to Porizo recording and processing my voice to create personalized songs. I understand my voice data will be stored securely.")
                        .font(.footnote)
                        .foregroundColor(DesignTokens.textSecondary)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .buttonStyle(.plain)
            .padding(.horizontal)

            Spacer()

            Button {
                startEnrollment()
            } label: {
                if isLoading {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                        .frame(maxWidth: .infinity)
                        .padding()
                } else {
                    Text("Start Recording")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding()
                }
            }
            .foregroundColor(.white)
            .background(isLoading || !consentGranted ? DesignTokens.textTertiary : DesignTokens.rose)
            .cornerRadius(12)
            .disabled(isLoading || !consentGranted)
        }
    }

    private func enrollmentStepRow(number: Int, text: String) -> some View {
        HStack(spacing: 12) {
            Text("\(number)")
                .font(.caption)
                .fontWeight(.bold)
                .frame(width: 24, height: 24)
                .background(DesignTokens.rose)
                .foregroundColor(.white)
                .clipShape(Circle())

            Text(text)
                .font(.subheadline)
                .foregroundColor(DesignTokens.textPrimary)
        }
    }

    // MARK: - Recording View

    private func recordingView(prompt: EnrollmentPrompt) -> some View {
        let promptType = PromptType(rawValue: prompt.type) ?? .spoken
        let headerText = promptType == .spoken ? "Please read aloud:" : "Please sing:"

        return VStack(spacing: 24) {
            // Dynamic progress indicator
            promptProgressIndicator

            Text(headerText)
                .font(.headline)
                .foregroundColor(.secondary)

            VStack(spacing: 8) {
                Text(prompt.text)
                    .font(.title3)
                    .multilineTextAlignment(.center)

                if let hint = prompt.durationHintSec {
                    Text("Target: ~\(hint) seconds")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                if let pitch = prompt.pitchHint {
                    Text(pitch)
                        .font(.caption)
                        .foregroundColor(.blue)
                }
            }
            .padding()
            .background(Color(.systemGray6))
            .cornerRadius(12)

            Spacer()

            // Audio visualization
            ZStack {
                Circle()
                    .stroke(Color.gray.opacity(0.3), lineWidth: 4)
                    .frame(width: 180, height: 180)

                Circle()
                    .fill(recorder.isRecording ? Color.red.opacity(0.2) : Color.blue.opacity(0.1))
                    .frame(width: 160, height: 160)
                    .scaleEffect(recorder.isRecording ? 1 + CGFloat(recorder.audioLevel) * 0.3 : 1)
                    .animation(.easeInOut(duration: 0.1), value: recorder.audioLevel)

                Image(systemName: recorder.isRecording ? "mic.fill" : "mic")
                    .font(.system(size: 50))
                    .foregroundColor(recorder.isRecording ? .red : .blue)
            }

            Text(formatDuration(recorder.duration))
                .font(.system(size: 40, weight: .light, design: .monospaced))
                .foregroundColor(recorder.isRecording ? .red : .primary)

            Text(recorder.isRecording ? "Recording... (minimum 5 seconds)" : "Tap to start recording")
                .font(.subheadline)
                .foregroundColor(.secondary)

            Spacer()

            // Control buttons
            HStack(spacing: 24) {
                if recorder.hasRecording && !recorder.isRecording {
                    Button {
                        recorder.playRecording()
                    } label: {
                        Image(systemName: "play.fill")
                            .font(.title2)
                            .frame(width: 56, height: 56)
                            .background(Color.green)
                            .foregroundColor(.white)
                            .clipShape(Circle())
                    }
                }

                Button {
                    toggleRecording()
                } label: {
                    Image(systemName: recorder.isRecording ? "stop.fill" : "circle.fill")
                        .font(.system(size: 28))
                        .frame(width: 72, height: 72)
                        .background(recorder.isRecording ? Color.gray : Color.red)
                        .foregroundColor(.white)
                        .clipShape(Circle())
                }

                if recorder.hasRecording && !recorder.isRecording {
                    Button {
                        recorder.deleteRecording()
                    } label: {
                        Image(systemName: "arrow.counterclockwise")
                            .font(.title2)
                            .frame(width: 56, height: 56)
                            .background(Color.orange)
                            .foregroundColor(.white)
                            .clipShape(Circle())
                    }
                }
            }

            if recorder.hasRecording && !recorder.isRecording && recorder.duration >= 5 {
                Button {
                    proceedToNextPrompt()
                } label: {
                    if isLoading {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                            .frame(maxWidth: .infinity)
                            .padding()
                    } else {
                        Text(isLastPrompt ? "Create Voice Profile" : "Next Prompt (\(currentPromptIndex + 2)/\(prompts.count))")
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding()
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(isLoading)
            }
        }
    }

    /// Dynamic progress indicator showing N prompts
    private var promptProgressIndicator: some View {
        HStack(spacing: 4) {
            ForEach(0..<prompts.count, id: \.self) { index in
                Circle()
                    .fill(index <= currentPromptIndex ? Color.blue : Color.gray.opacity(0.3))
                    .frame(width: 10, height: 10)

                if index < prompts.count - 1 {
                    Rectangle()
                        .fill(index < currentPromptIndex ? Color.blue : Color.gray.opacity(0.3))
                        .frame(width: 12, height: 2)
                }
            }
        }
        .padding(.horizontal)
    }

    // MARK: - Processing View

    private var processingView: some View {
        VStack(spacing: 32) {
            Spacer()

            ProgressView()
                .scaleEffect(2)

            Text("Creating Your Voice Profile")
                .font(.title2)
                .fontWeight(.semibold)

            Text("This may take a moment...")
                .font(.body)
                .foregroundColor(.secondary)

            Spacer()
        }
    }

    // MARK: - Completed View

    private var completedView: some View {
        VStack(spacing: 32) {
            Spacer()

            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 80))
                .foregroundColor(.green)

            Text("Voice Profile Created!")
                .font(.title2)
                .fontWeight(.bold)

            if let score = qualityScore {
                VStack(spacing: 8) {
                    Text("Quality Score")
                        .font(.subheadline)
                        .foregroundColor(.secondary)

                    Text("\(score)")
                        .font(.system(size: 48, weight: .bold))
                        .foregroundColor(score >= 70 ? .green : .orange)
                }
                .padding()
                .background(Color(.systemGray6))
                .cornerRadius(12)
            }

            Text("Your voice profile is ready. You can now create personalized songs!")
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            Spacer()

            Button {
                // Navigate to My Songs
                appState = .mySongs
            } label: {
                HStack {
                    Image(systemName: "music.note.list")
                    Text("My Songs")
                }
                .font(.headline)
                .frame(maxWidth: .infinity)
                .padding()
            }
            .buttonStyle(.borderedProminent)

            Button {
                // Navigate to create new song
                appState = .storyWizard
            } label: {
                HStack {
                    Image(systemName: "wand.and.stars")
                    Text("Create New Song")
                }
                .font(.subheadline)
                .frame(maxWidth: .infinity)
                .padding()
            }
            .buttonStyle(.bordered)

            Button {
                // Reset for another enrollment (for testing)
                resetEnrollment()
            } label: {
                Text("Re-record Voice")
                    .font(.subheadline)
            }
            .buttonStyle(.bordered)
        }
    }

    // MARK: - Actions

    private func startEnrollment() {
        // Set loading immediately to prevent double-taps
        guard !isLoading else { return }
        isLoading = true

        Task {
            defer { isLoading = false }

            do {
                // Request mic permission first
                if !recorder.permissionGranted {
                    let granted = await recorder.requestPermission()
                    if !granted {
                        errorMessage = "Microphone permission is required"
                        showingError = true
                        return
                    }
                }

                // Start enrollment session with backend
                guard let client = apiClient else { return }
                let session = try await client.startEnrollment()
                sessionId = session.sessionId
                promptSetId = session.promptSetId
                recordingSettings = session.recordingSettings
                uploadUrlsByChunkId = Dictionary(
                    uniqueKeysWithValues: (session.uploadUrls ?? []).map { ($0.chunkId, $0) }
                )

                // Use server prompts or fallback to default
                if let serverPrompts = session.prompts, !serverPrompts.isEmpty {
                    prompts = serverPrompts
                } else {
                    // Fallback prompts if server doesn't provide any
                    prompts = [
                        EnrollmentPrompt(id: "chunk_spoken_1", text: "The quick brown fox jumps over the lazy dog.", type: "spoken", durationHintSec: 5, pitchHint: nil),
                        EnrollmentPrompt(id: "chunk_spoken_2", text: "Pack my box with five dozen liquor jugs.", type: "spoken", durationHintSec: 5, pitchHint: nil),
                        EnrollmentPrompt(id: "chunk_sung_1", text: "La la la, la la la la la, la la la la la la la", type: "sung", durationHintSec: 8, pitchHint: "Start comfortable, go up")
                    ]
                }

                currentPromptIndex = 0
                uploadedChunkIds = []

                withAnimation {
                    currentStep = .recording
                }
            } catch {
                errorMessage = error.localizedDescription
                showingError = true
            }
        }
    }

    private func toggleRecording() {
        if recorder.isRecording {
            _ = recorder.stopRecording()
        } else {
            Task {
                do {
                    try recorder.startRecording()
                } catch {
                    errorMessage = error.localizedDescription
                    showingError = true
                }
            }
        }
    }

    private func proceedToNextPrompt() {
        // Set loading immediately to prevent double-taps
        guard !isLoading else { return }
        isLoading = true

        Task {
            defer { isLoading = false }

            guard let client = apiClient,
                  let session = sessionId,
                  let audioData = recorder.getRecordingData(),
                  let currentPrompt = currentPrompt else {
                errorMessage = "Missing recording data"
                showingError = true
                return
            }
            guard let uploadUrl = uploadUrlsByChunkId[currentPrompt.id] else {
                errorMessage = "Missing upload URL for this prompt"
                showingError = true
                return
            }

            do {
                // Upload using prompt's id as chunk_id
                _ = try await client.uploadChunk(
                    sessionId: session,
                    chunkId: currentPrompt.id,
                    audioData: audioData,
                    uploadUrl: uploadUrl,
                    durationSec: recorder.recordingDuration() ?? max(0.1, recorder.duration),
                    checksum: SHA256.hash(data: audioData)
                        .map { String(format: "%02x", $0) }
                        .joined()
                )

                // Track uploaded chunk
                uploadedChunkIds.insert(currentPrompt.id)

                // C4: Save enrollment state for resumption if app is killed
                if let session = sessionId {
                    EnrollmentStateManager.save(
                        sessionId: session,
                        promptSetId: promptSetId,
                        prompts: prompts,
                        currentPromptIndex: currentPromptIndex,
                        uploadedChunkIds: uploadedChunkIds,
                        recordingSettings: recordingSettings
                    )
                }

                // Clear recording for next prompt
                recorder.deleteRecording()

                if isLastPrompt {
                    // All prompts completed, finalize enrollment
                    await completeEnrollment()
                } else {
                    // Move to next prompt
                    withAnimation {
                        currentPromptIndex += 1
                    }
                }
            } catch {
                errorMessage = error.localizedDescription
                showingError = true
            }
        }
    }

    private func completeEnrollment() async {
        withAnimation {
            currentStep = .processing
        }

        guard let client = apiClient,
              let session = sessionId else { return }

        do {
            let profile = try await client.completeEnrollment(sessionId: session)

            // Backend returns 202 with status: "processing"
            // If quality_score is already present, use it
            if let score = profile.qualityScore {
                qualityScore = Int(score)
                // C4: Clear saved enrollment state on success
                EnrollmentStateManager.clear()
                withAnimation {
                    currentStep = .completed
                }
                return
            }

            // Otherwise, poll for completion
            await pollForProfileCompletion(client: client)
        } catch {
            await MainActor.run {
                errorMessage = error.localizedDescription
                showingError = true
                // Go back to last prompt on error
                currentStep = .recording
            }
        }
    }

    private func pollForProfileCompletion(client: APIClient) async {
        // Poll every 2 seconds for up to 60 seconds
        let maxAttempts = 30
        let pollInterval: UInt64 = 2_000_000_000 // 2 seconds in nanoseconds

        for _ in 0..<maxAttempts {
            try? await Task.sleep(nanoseconds: pollInterval)

            do {
                let status = try await client.getVoiceProfile()
                if status.hasProfile, let score = status.qualityScore {
                    await MainActor.run {
                        qualityScore = Int(score)
                        // C4: Clear saved enrollment state on success
                        EnrollmentStateManager.clear()
                        withAnimation {
                            currentStep = .completed
                        }
                    }
                    return
                }
            } catch {
                // Continue polling on transient errors
                continue
            }
        }

        // Timeout - show error
        await MainActor.run {
            errorMessage = "Voice profile processing timed out. Please try again."
            showingError = true
            currentStep = .recording
        }
    }

    private func resetEnrollment() {
        // C4: Clear any saved enrollment state
        EnrollmentStateManager.clear()

        sessionId = nil
        promptSetId = nil
        prompts = []
        currentPromptIndex = 0
        recordingSettings = nil
        uploadedChunkIds = []
        uploadUrlsByChunkId = [:]
        qualityScore = nil
        consentGranted = false
        recorder.deleteRecording()
        withAnimation {
            currentStep = .welcome
        }
    }

    private func formatDuration(_ duration: TimeInterval) -> String {
        let minutes = Int(duration) / 60
        let seconds = Int(duration) % 60
        let tenths = Int((duration.truncatingRemainder(dividingBy: 1)) * 10)
        return String(format: "%d:%02d.%d", minutes, seconds, tenths)
    }
}

#Preview {
    ContentView()
}
