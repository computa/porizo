//
//  CoachingTipView.swift
//  PorizoApp
//

import SwiftUI
import Combine

#if os(iOS)

struct CoachingTipView: View {
    let tip: CoachingTip?

    var body: some View {
        Group {
            if let tip = tip {
                HStack(spacing: 10) {
                    Image(systemName: tip.iconName)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(tip.iconColor)

                    Text(tip.message)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.white)
                        .multilineTextAlignment(.leading)

                    Spacer()
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(tip.backgroundColor)
                .cornerRadius(12)
                .transition(.asymmetric(
                    insertion: .move(edge: .bottom).combined(with: .opacity),
                    removal: .opacity
                ))
            }
        }
        .animation(.easeInOut(duration: 0.3), value: tip?.id)
    }
}

struct CoachingTip: Identifiable, Equatable {
    let id: String
    let message: String
    let iconName: String
    let severity: Severity

    enum Severity {
        case info
        case warning
        case success
    }

    var iconColor: Color {
        switch severity {
        case .info: return .blue
        case .warning: return .yellow
        case .success: return .green
        }
    }

    var backgroundColor: Color {
        switch severity {
        case .info: return Color.blue.opacity(0.2)
        case .warning: return Color.yellow.opacity(0.15)
        case .success: return Color.green.opacity(0.2)
        }
    }

    static let speakLouder = CoachingTip(
        id: "speak_louder",
        message: "Speak a bit louder or move closer to your phone",
        iconName: "speaker.wave.2.fill",
        severity: .warning
    )

    static let tooLoud = CoachingTip(
        id: "too_loud",
        message: "You're a bit loud — no need to shout!",
        iconName: "speaker.wave.3.fill",
        severity: .warning
    )

    static let findQuieterSpot = CoachingTip(
        id: "find_quieter_spot",
        message: "Try to find a quieter spot if possible",
        iconName: "ear.trianglebadge.exclamationmark",
        severity: .warning
    )

    static let veryNoisy = CoachingTip(
        id: "very_noisy",
        message: "It's quite noisy here — recording quality may be affected",
        iconName: "waveform.badge.exclamationmark",
        severity: .warning
    )

    static let greatConditions = CoachingTip(
        id: "great_conditions",
        message: "Great! Keep going",
        iconName: "checkmark.circle.fill",
        severity: .success
    )

    static let readyToRecord = CoachingTip(
        id: "ready_to_record",
        message: "Tap to start recording when ready",
        iconName: "mic.fill",
        severity: .info
    )
}

class CoachingTipManager: ObservableObject {
    @Published var currentTip: CoachingTip?

    private var lastTipChange = Date.distantPast
    private let minTipDuration: TimeInterval = 2.0
    private var consecutiveGoodFrames = 0
    private let goodFramesThreshold = 20

    func update(with metrics: LiveAudioMetrics, isRecording: Bool) {
        let now = Date()

        // Don't change tips too frequently
        guard now.timeIntervalSince(lastTipChange) >= minTipDuration else {
            return
        }

        let newTip = selectTip(for: metrics, isRecording: isRecording)

        if metrics.qualityLevel >= 2 && metrics.isLevelGood && !metrics.isClipping {
            consecutiveGoodFrames += 1
        } else {
            consecutiveGoodFrames = 0
        }

        if newTip?.id != currentTip?.id {
            currentTip = newTip
            lastTipChange = now
        }
    }

    private func selectTip(for metrics: LiveAudioMetrics, isRecording: Bool) -> CoachingTip? {
        if !isRecording && !metrics.isSpeechDetected {
            return .readyToRecord
        }

        if metrics.isClipping {
            return .tooLoud
        }

        if metrics.rmsLevel < -50 {
            return .speakLouder
        }

        if metrics.noiseFloor > -25 {
            return .veryNoisy
        }

        if metrics.noiseFloor > -35 {
            return .findQuieterSpot
        }

        if consecutiveGoodFrames > goodFramesThreshold && isRecording {
            if consecutiveGoodFrames < goodFramesThreshold + 40 {
                return .greatConditions
            }
            return nil
        }

        return nil
    }

    func reset() {
        currentTip = nil
        lastTipChange = Date.distantPast
        consecutiveGoodFrames = 0
    }
}

// MARK: - Previews

#Preview("Coaching Tips") {
    VStack(spacing: 16) {
        CoachingTipView(tip: .speakLouder)
        CoachingTipView(tip: .tooLoud)
        CoachingTipView(tip: .findQuieterSpot)
        CoachingTipView(tip: .veryNoisy)
        CoachingTipView(tip: .greatConditions)
        CoachingTipView(tip: .readyToRecord)
    }
    .padding()
    .background(Color.black)
}

#endif
