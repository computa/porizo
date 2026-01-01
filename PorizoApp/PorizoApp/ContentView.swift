//
//  ContentView.swift
//  PorizoApp
//
//  Voice enrollment flow with backend integration.
//

import SwiftUI

struct ContentView: View {
    @StateObject private var recorder = AudioRecorder()
    @State private var apiClient: APIClient?

    // Enrollment state
    @State private var currentStep: EnrollmentStep = .welcome
    @State private var sessionId: String?
    @State private var spokenChunkURL: URL?
    @State private var sungChunkURL: URL?

    // UI state
    @State private var isLoading = false
    @State private var showingError = false
    @State private var errorMessage = ""
    @State private var qualityScore: Int?

    // Configuration - Your Mac's local IP for development
    private let serverURL = "http://192.168.0.86:3000"

    enum EnrollmentStep {
        case welcome
        case recordSpoken
        case recordSung
        case processing
        case completed
    }

    var body: some View {
        NavigationView {
            VStack(spacing: 24) {
                switch currentStep {
                case .welcome:
                    welcomeView
                case .recordSpoken:
                    recordingView(prompt: "Please read aloud:", text: spokenPrompt, type: .spoken)
                case .recordSung:
                    recordingView(prompt: "Please sing:", text: sungPrompt, type: .sung)
                case .processing:
                    processingView
                case .completed:
                    completedView
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
            .onAppear {
                apiClient = APIClient(baseURL: serverURL)
            }
        }
    }

    // MARK: - Prompts

    private let spokenPrompt = "The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs."

    private let sungPrompt = "La la la, la la la la la, la la la la la la la"

    // MARK: - Welcome View

    private var welcomeView: some View {
        VStack(spacing: 32) {
            Spacer()

            Image(systemName: "waveform.circle.fill")
                .font(.system(size: 80))
                .foregroundColor(.blue)

            VStack(spacing: 12) {
                Text("Create Your Voice Profile")
                    .font(.title2)
                    .fontWeight(.bold)

                Text("We'll record your voice to create personalized songs that sound like you singing.")
                    .font(.body)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }

            VStack(alignment: .leading, spacing: 16) {
                enrollmentStepRow(number: 1, text: "Read a short phrase aloud")
                enrollmentStepRow(number: 2, text: "Sing a simple melody")
                enrollmentStepRow(number: 3, text: "We create your voice profile")
            }
            .padding()
            .background(Color(.systemGray6))
            .cornerRadius(12)

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
            .buttonStyle(.borderedProminent)
            .disabled(isLoading)
        }
    }

    private func enrollmentStepRow(number: Int, text: String) -> some View {
        HStack(spacing: 12) {
            Text("\(number)")
                .font(.caption)
                .fontWeight(.bold)
                .frame(width: 24, height: 24)
                .background(Color.blue)
                .foregroundColor(.white)
                .clipShape(Circle())

            Text(text)
                .font(.subheadline)
        }
    }

    // MARK: - Recording View

    private func recordingView(prompt: String, text: String, type: PromptType) -> some View {
        VStack(spacing: 24) {
            // Progress indicator
            HStack {
                Circle()
                    .fill(type == .spoken ? Color.blue : Color.gray)
                    .frame(width: 12, height: 12)
                Rectangle()
                    .fill(Color.gray.opacity(0.3))
                    .frame(height: 2)
                    .frame(maxWidth: 40)
                Circle()
                    .fill(type == .sung ? Color.blue : Color.gray)
                    .frame(width: 12, height: 12)
            }

            Text(prompt)
                .font(.headline)
                .foregroundColor(.secondary)

            Text(text)
                .font(.title3)
                .multilineTextAlignment(.center)
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
                    toggleRecording(type: type)
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
                    proceedToNextStep(type: type)
                } label: {
                    if isLoading {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                            .frame(maxWidth: .infinity)
                            .padding()
                    } else {
                        Text(type == .spoken ? "Continue to Singing" : "Create Voice Profile")
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
                // Reset for another enrollment (for testing)
                resetEnrollment()
            } label: {
                Text("Start Over")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding()
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

                withAnimation {
                    currentStep = .recordSpoken
                }
            } catch {
                errorMessage = error.localizedDescription
                showingError = true
            }
        }
    }

    private func toggleRecording(type: PromptType) {
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

    private func proceedToNextStep(type: PromptType) {
        // Set loading immediately to prevent double-taps
        guard !isLoading else { return }
        isLoading = true

        Task {
            defer { isLoading = false }

            guard let client = apiClient,
                  let session = sessionId,
                  let audioData = recorder.getRecordingData() else {
                errorMessage = "Missing recording data"
                showingError = true
                return
            }

            do {
                let chunkId = type == .spoken ? "chunk_spoken" : "chunk_sung"
                _ = try await client.uploadChunk(
                    sessionId: session,
                    chunkId: chunkId,
                    audioData: audioData
                )

                // Save URL for reference
                if type == .spoken {
                    spokenChunkURL = recorder.getRecordingURL()
                    recorder.deleteRecording()
                    withAnimation {
                        currentStep = .recordSung
                    }
                } else {
                    sungChunkURL = recorder.getRecordingURL()
                    recorder.deleteRecording()
                    await completeEnrollment()
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
            qualityScore = profile.qualityScore.map { Int($0) }

            withAnimation {
                currentStep = .completed
            }
        } catch {
            await MainActor.run {
                errorMessage = error.localizedDescription
                showingError = true
                currentStep = .recordSung
            }
        }
    }

    private func resetEnrollment() {
        sessionId = nil
        spokenChunkURL = nil
        sungChunkURL = nil
        qualityScore = nil
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
