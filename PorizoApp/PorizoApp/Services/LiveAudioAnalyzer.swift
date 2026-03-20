//
//  LiveAudioAnalyzer.swift
//  PorizoApp
//

import Foundation
import AVFoundation
import Observation

#if os(iOS)

/// Analyzes microphone input in real-time and publishes audio metrics.
///
/// Usage:
/// ```swift
/// @State private var analyzer = LiveAudioAnalyzer()
///
/// // Start analyzing
/// try analyzer.start()
///
/// // Observe metrics
/// Text("Level: \(analyzer.metrics.qualityDescription)")
///
/// // Stop when done
/// analyzer.stop()
/// ```
@MainActor @Observable
final class LiveAudioAnalyzer {

    private(set) var metrics: LiveAudioMetrics = .silent
    private(set) var isAnalyzing: Bool = false
    private(set) var errorMessage: String?

    @ObservationIgnored private var audioEngine: AVAudioEngine?
    @ObservationIgnored private let analysisQueue = DispatchQueue(label: "com.porizo.audioAnalysis", qos: .userInteractive)
    @ObservationIgnored private nonisolated(unsafe) var rmsHistory: [Float] = []
    @ObservationIgnored private let rmsHistoryMaxSize = 40
    @ObservationIgnored private nonisolated(unsafe) var consecutiveClippingFrames: Int = 0
    @ObservationIgnored private let clippingFrameThreshold = 3
    @ObservationIgnored private let bufferSize: AVAudioFrameCount = 2048

    init() {}

    func start() throws {
        guard !isAnalyzing else { return }

        do {
            try configureAudioSession()
            try setupAudioEngine()
            isAnalyzing = true
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
            throw error
        }
    }

    func stop() {
        guard isAnalyzing else { return }

        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine?.stop()
        audioEngine = nil

        isAnalyzing = false
        reset()
    }

    func reset() {
        analysisQueue.sync {
            rmsHistory.removeAll()
            consecutiveClippingFrames = 0
        }
        metrics = .silent
    }

    private func configureAudioSession() throws {
        let session = AVAudioSession.sharedInstance()

        try session.setCategory(
            .playAndRecord,
            mode: .measurement,
            options: [.defaultToSpeaker, .allowBluetoothA2DP]
        )
        try session.setActive(true)
    }

    private func setupAudioEngine() throws {
        let engine = AVAudioEngine()
        let inputNode = engine.inputNode

        // Enable Apple Voice Processing for on-device noise reduction
        if inputNode.isVoiceProcessingEnabled == false {
            do {
                try inputNode.setVoiceProcessingEnabled(true)
            } catch {
                // Voice processing not available, continue without it
            }
        }

        let format = inputNode.outputFormat(forBus: 0)

        guard format.sampleRate > 0, format.channelCount > 0 else {
            throw AnalyzerError.invalidAudioFormat
        }

        inputNode.installTap(
            onBus: 0,
            bufferSize: bufferSize,
            format: format
        ) { [weak self] buffer, _ in
            self?.processAudioBuffer(buffer)
        }

        engine.prepare()
        try engine.start()

        self.audioEngine = engine
    }

    private nonisolated func processAudioBuffer(_ buffer: AVAudioPCMBuffer) {
        guard let channelData = buffer.floatChannelData else { return }

        let frameLength = Int(buffer.frameLength)
        guard frameLength > 0 else { return }

        let samples = channelData[0]

        var sumOfSquares: Float = 0
        var peak: Float = 0

        for i in 0..<frameLength {
            let sample = samples[i]
            let absSample = abs(sample)
            sumOfSquares += sample * sample
            if absSample > peak {
                peak = absSample
            }
        }

        let rms = sqrt(sumOfSquares / Float(frameLength))

        let rmsDB = max(-60, 20 * log10(max(rms, 1e-6)))
        let peakDB = max(-60, 20 * log10(max(peak, 1e-6)))

        analysisQueue.async { [weak self] in
            guard let self = self else { return }

            self.rmsHistory.append(rmsDB)
            if self.rmsHistory.count > self.rmsHistoryMaxSize {
                self.rmsHistory.removeFirst()
            }

            let noiseFloor = self.rmsHistory.min() ?? -60
            let snr = rmsDB - noiseFloor

            let isFrameClipping = peakDB > LiveAudioMetrics.Threshold.clippingThreshold
            if isFrameClipping {
                self.consecutiveClippingFrames += 1
            } else {
                self.consecutiveClippingFrames = 0
            }
            let isClipping = self.consecutiveClippingFrames >= self.clippingFrameThreshold
            let isSpeechDetected = snr > LiveAudioMetrics.Threshold.speechDetectionMargin

            let newMetrics = LiveAudioMetrics(
                rmsLevel: rmsDB,
                peakLevel: peakDB,
                noiseFloor: noiseFloor,
                snrEstimate: snr,
                isClipping: isClipping,
                isSpeechDetected: isSpeechDetected,
                timestamp: Date.now
            )

            Task { @MainActor [weak self] in
                self?.metrics = newMetrics
            }
        }
    }
}

extension LiveAudioAnalyzer {

    enum AnalyzerError: LocalizedError {
        case invalidAudioFormat
        case audioSessionFailed(underlying: Error)
        case engineStartFailed(underlying: Error)

        var errorDescription: String? {
            switch self {
            case .invalidAudioFormat:
                return "Invalid audio format from microphone"
            case .audioSessionFailed(let error):
                return "Audio session error: \(error.localizedDescription)"
            case .engineStartFailed(let error):
                return "Audio engine failed to start: \(error.localizedDescription)"
            }
        }
    }
}

extension LiveAudioAnalyzer {

    @discardableResult
    func tryStart() -> Bool {
        do {
            try start()
            return true
        } catch {
            return false
        }
    }

    var isEnvironmentSuitable: Bool {
        metrics.isEnvironmentQuiet && !metrics.isClipping
    }

    var isSpeakingWell: Bool {
        metrics.isSpeechDetected && metrics.isLevelGood && !metrics.isClipping
    }
}

#endif
