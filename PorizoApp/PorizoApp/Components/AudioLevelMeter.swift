//
//  AudioLevelMeter.swift
//  PorizoApp
//

import SwiftUI

#if os(iOS)

struct AudioLevelMeter: View {
    let level: Float
    let isClipping: Bool
    var orientation: Orientation = .vertical
    var size: CGSize = CGSize(width: 8, height: 120)

    enum Orientation {
        case vertical
        case horizontal
    }

    private var levelColor: Color {
        if isClipping {
            return .red
        }

        let db = (level * 60) - 60

        if db < -40 || db > -6 {
            return .red
        } else if db < -30 || db > -12 {
            return .yellow
        } else {
            return .green
        }
    }

    private var clampedLevel: CGFloat {
        CGFloat(min(1, max(0, level)))
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: orientation == .vertical ? .bottom : .leading) {
                // Background track
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color.black.opacity(0.3))

                // Level indicator
                RoundedRectangle(cornerRadius: 4)
                    .fill(levelColor)
                    .frame(
                        width: orientation == .vertical ? nil : geometry.size.width * clampedLevel,
                        height: orientation == .vertical ? geometry.size.height * clampedLevel : nil
                    )
                    .animation(.easeOut(duration: 0.05), value: level)

                // Zone markers (vertical only)
                if orientation == .vertical {
                    VStack(spacing: 0) {
                        // Red zone top (-6 to 0 dB)
                        Rectangle()
                            .fill(Color.clear)
                            .frame(height: geometry.size.height * 0.1)

                        // Yellow zone top (-12 to -6 dB)
                        Rectangle()
                            .fill(Color.clear)
                            .frame(height: geometry.size.height * 0.1)
                            .overlay(
                                Rectangle()
                                    .fill(Color.white.opacity(0.2))
                                    .frame(height: 1),
                                alignment: .bottom
                            )

                        // Green zone (-30 to -12 dB)
                        Rectangle()
                            .fill(Color.clear)
                            .frame(height: geometry.size.height * 0.3)
                            .overlay(
                                Rectangle()
                                    .fill(Color.white.opacity(0.2))
                                    .frame(height: 1),
                                alignment: .bottom
                            )

                        // Yellow zone bottom (-40 to -30 dB)
                        Rectangle()
                            .fill(Color.clear)
                            .frame(height: geometry.size.height * 0.167)

                        // Red zone bottom (-60 to -40 dB)
                        Spacer()
                    }
                }
            }
        }
        .frame(
            width: orientation == .vertical ? size.width : size.height,
            height: orientation == .vertical ? size.height : size.width
        )
    }
}

struct AudioLevelBars: View {
    let level: Float
    let isClipping: Bool
    var barCount: Int = 5
    var spacing: CGFloat = 2
    var barSize: CGSize = CGSize(width: 4, height: 20)

    var body: some View {
        HStack(spacing: spacing) {
            ForEach(0..<barCount, id: \.self) { index in
                let threshold = Float(index + 1) / Float(barCount)
                let isActive = level >= threshold

                RoundedRectangle(cornerRadius: 2)
                    .fill(barColor(for: index, isActive: isActive))
                    .frame(width: barSize.width, height: barSize.height)
                    .animation(.easeOut(duration: 0.05), value: level)
            }
        }
    }

    private func barColor(for index: Int, isActive: Bool) -> Color {
        guard isActive else {
            return Color.gray.opacity(0.3)
        }

        if isClipping {
            return .red
        }

        let position = Float(index) / Float(barCount - 1)
        if position > 0.8 {
            return .red
        } else if position > 0.6 {
            return .yellow
        } else {
            return .green
        }
    }
}

// MARK: - Previews

#Preview("Vertical Meter") {
    VStack(spacing: 20) {
        HStack(spacing: 20) {
            AudioLevelMeter(level: 0.2, isClipping: false)
            AudioLevelMeter(level: 0.5, isClipping: false)
            AudioLevelMeter(level: 0.8, isClipping: false)
            AudioLevelMeter(level: 0.95, isClipping: true)
        }
    }
    .padding()
    .background(Color.black)
}

#Preview("Level Bars") {
    VStack(spacing: 20) {
        AudioLevelBars(level: 0.2, isClipping: false)
        AudioLevelBars(level: 0.5, isClipping: false)
        AudioLevelBars(level: 0.8, isClipping: false)
        AudioLevelBars(level: 1.0, isClipping: true)
    }
    .padding()
    .background(Color.black)
}

#endif
