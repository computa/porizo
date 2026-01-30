//
//  LiveAudioMetrics.swift
//  PorizoApp
//

import Foundation

struct LiveAudioMetrics: Sendable, Equatable {

    let rmsLevel: Float
    let peakLevel: Float
    let noiseFloor: Float
    let snrEstimate: Float
    let isClipping: Bool
    let isSpeechDetected: Bool
    let timestamp: Date

    var isLevelGood: Bool {
        rmsLevel >= -30 && rmsLevel <= -12
    }

    var isEnvironmentQuiet: Bool {
        noiseFloor < -35
    }

    var qualityDescription: String {
        if isClipping {
            return "Too Loud"
        }
        if rmsLevel < -50 {
            return "Too Quiet"
        }
        if noiseFloor > -25 {
            return "Very Noisy"
        }
        if noiseFloor > -35 {
            return "Noisy"
        }
        if isLevelGood {
            return "Great"
        }
        if rmsLevel > -12 {
            return "A Bit Loud"
        }
        return "Good"
    }

    var qualityLevel: Int {
        if isClipping || rmsLevel < -50 || noiseFloor > -25 {
            return 0 // Poor
        }
        if noiseFloor > -35 || rmsLevel > -10 {
            return 1 // Fair
        }
        if isLevelGood && isEnvironmentQuiet {
            return 3 // Great
        }
        return 2 // Good
    }

    var normalizedLevel: Float {
        let clamped = max(-60, min(0, rmsLevel))
        return (clamped + 60) / 60
    }

    var normalizedPeakLevel: Float {
        let clamped = max(-60, min(0, peakLevel))
        return (clamped + 60) / 60
    }

    static let silent = LiveAudioMetrics(
        rmsLevel: -60,
        peakLevel: -60,
        noiseFloor: -60,
        snrEstimate: 0,
        isClipping: false,
        isSpeechDetected: false,
        timestamp: Date()
    )

    enum Threshold {
        static let minLevel: Float = -50
        static let maxLevel: Float = -10
        static let idealLevelLow: Float = -30
        static let idealLevelHigh: Float = -12
        static let clippingThreshold: Float = -3
        static let quietEnvironment: Float = -35
        static let noisyEnvironment: Float = -25
        static let speechDetectionMargin: Float = 10
    }
}
