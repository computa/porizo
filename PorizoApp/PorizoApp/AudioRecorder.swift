//
//  AudioRecorder.swift
//  PorizoApp
//
//  Core audio recording functionality using AVFoundation.
//  Records voice samples as WAV files for upload to backend.
//

import Foundation
import AVFoundation
import Observation

/// Handles microphone recording with WAV output format
@Observable
@MainActor
class AudioRecorder: NSObject {

    // MARK: - Observable State

    var isRecording = false
    var duration: TimeInterval = 0
    var audioLevel: Float = 0
    var hasRecording = false
    var permissionGranted = false
    var permissionDenied = false

    // MARK: - Private Properties

    private var audioRecorder: AVAudioRecorder?
    private(set) var recordingURL: URL?
    private var levelTimer: Timer?
    private var durationTimer: Timer?
    @ObservationIgnored nonisolated(unsafe) private var interruptionObserver: NSObjectProtocol?

    // MARK: - Audio Settings (matching backend expectations)

    private let audioSettings: [String: Any] = [
        AVFormatIDKey: Int(kAudioFormatLinearPCM),
        AVSampleRateKey: 44100.0,
        AVNumberOfChannelsKey: 1,
        AVLinearPCMBitDepthKey: 16,
        AVLinearPCMIsFloatKey: false,
        AVLinearPCMIsBigEndianKey: false
    ]

    // MARK: - Initialization

    override init() {
        super.init()
        checkPermission()
        setupInterruptionHandling()
    }

    deinit {
        if let observer = interruptionObserver {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    private func setupInterruptionHandling() {
        interruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            // Extract the interruption type before crossing actor boundary
            // (Notification is not Sendable, but UInt is)
            guard let strongSelf = self,
                  let userInfo = notification.userInfo,
                  let typeValue = userInfo[AVAudioSessionInterruptionTypeKey] as? UInt else {
                return
            }
            Task { @MainActor in
                strongSelf.handleInterruption(typeValue: typeValue)
            }
        }
    }

    private func handleInterruption(typeValue: UInt) {
        guard let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }

        switch type {
        case .began:
            // Phone call or other interruption started — stop recording.
            // Observers of `isRecording` (e.g. VoiceEnrollmentView) sync UI state
            // automatically via .onChange(of: recorder.isRecording).
            if isRecording {
                _ = stopRecording()
            }
        case .ended:
            // Interruption ended — user can restart recording manually.
            break
        @unknown default:
            break
        }
    }

    // MARK: - Permission Handling

    func checkPermission() {
        switch AVAudioApplication.shared.recordPermission {
        case .granted:
            permissionGranted = true
            permissionDenied = false
        case .denied:
            permissionGranted = false
            permissionDenied = true
        case .undetermined:
            permissionGranted = false
            permissionDenied = false
        @unknown default:
            permissionGranted = false
            permissionDenied = false
        }
    }

    func requestPermission() async -> Bool {
        let granted = await withCheckedContinuation { continuation in
            requestRecordPermission { allowed in
                continuation.resume(returning: allowed)
            }
        }
        await MainActor.run {
            self.permissionGranted = granted
            self.permissionDenied = !granted
        }
        return granted
    }

    private func requestRecordPermission(_ completion: @escaping @Sendable (Bool) -> Void) {
        AVAudioApplication.requestRecordPermission(completionHandler: completion)
    }

    // MARK: - Recording

    func startRecording() throws {
        // Configure audio session for high-quality voice capture
        // Use .measurement mode to avoid voice processing that harms singing quality
        // .voiceChat applies echo cancellation, AGC, noise reduction - bad for voice enrollment
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker, .allowBluetoothA2DP])
        try session.setActive(true)

        // Create unique filename in temp directory
        let filename = "recording_\(Date.now.timeIntervalSince1970).wav"
        recordingURL = FileManager.default.temporaryDirectory.appendingPathComponent(filename)

        guard let url = recordingURL else {
            throw RecordingError.invalidURL
        }

        // Initialize recorder
        audioRecorder = try AVAudioRecorder(url: url, settings: audioSettings)
        audioRecorder?.isMeteringEnabled = true
        audioRecorder?.prepareToRecord()

        // Start recording
        guard audioRecorder?.record() == true else {
            throw RecordingError.recordingFailed
        }

        isRecording = true
        duration = 0
        hasRecording = false

        // Start timers for duration and level updates
        startTimers()
    }

    func stopRecording() -> URL? {
        stopTimers()

        audioRecorder?.stop()
        isRecording = false

        // Deactivate audio session to release resources
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)

        guard let originalURL = recordingURL,
              FileManager.default.fileExists(atPath: originalURL.path) else {
            return nil
        }

        // Export to clean WAV format (removes iOS JUNK/FLLR chunks)
        let cleanURL = originalURL.deletingLastPathComponent()
            .appendingPathComponent("clean_\(originalURL.lastPathComponent)")

        do {
            try WAVWriter.exportCleanWAV(from: originalURL, to: cleanURL)

            // Delete original iOS WAV
            try? FileManager.default.removeItem(at: originalURL)

            // Update recording URL to clean file
            recordingURL = cleanURL
            hasRecording = true

            return cleanURL
        } catch {
            // Fallback: return original file if conversion fails
            print("[AudioRecorder] WAV export failed: \(error.localizedDescription). Using original file.")
            Task { @MainActor in ToastService.shared.show("Audio processing issue — using raw recording", type: .warning) }
            hasRecording = true
            return originalURL
        }
    }

    // MARK: - File Access

    func recordingDuration() -> TimeInterval? {
        guard let url = recordingURL else { return nil }
        do {
            let file = try AVAudioFile(forReading: url)
            let frames = Double(file.length)
            return frames / file.fileFormat.sampleRate
        } catch {
            return nil
        }
    }

    func deleteRecording() {
        if let url = recordingURL {
            try? FileManager.default.removeItem(at: url)
        }
        recordingURL = nil
        hasRecording = false
        duration = 0
    }

    // MARK: - Private Helpers

    private func startTimers() {
        // Update duration every 0.1 seconds
        // Capture weak self, then create strong reference before crossing to MainActor
        durationTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            guard let strongSelf = self else { return }
            Task { @MainActor in
                strongSelf.duration = strongSelf.audioRecorder?.currentTime ?? 0
            }
        }

        // Update audio level every 0.05 seconds
        levelTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            guard let strongSelf = self else { return }
            Task { @MainActor in
                strongSelf.audioRecorder?.updateMeters()
                let level = strongSelf.audioRecorder?.averagePower(forChannel: 0) ?? -160
                // Normalize from dB (-160 to 0) to 0-1 range
                strongSelf.audioLevel = max(0, min(1, (level + 50) / 50))
            }
        }
    }

    private func stopTimers() {
        durationTimer?.invalidate()
        durationTimer = nil
        levelTimer?.invalidate()
        levelTimer = nil
    }
}

// MARK: - Errors

enum RecordingError: LocalizedError {
    case invalidURL
    case recordingFailed
    case permissionDenied

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Could not create recording file"
        case .recordingFailed:
            return "Failed to start recording"
        case .permissionDenied:
            return "Microphone permission denied"
        }
    }
}
