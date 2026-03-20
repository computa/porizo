import SwiftUI

struct WaveformVisualizer: View {
    @State private var animating = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let barCount: Int
    let maxHeight: CGFloat
    let animated: Bool

    init(barCount: Int = 9, maxHeight: CGFloat = 110, animated: Bool = true) {
        self.barCount = barCount
        self.maxHeight = maxHeight
        self.animated = animated
    }

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<barCount, id: \.self) { index in
                WaveformBar(
                    index: index,
                    totalBars: barCount,
                    maxHeight: maxHeight,
                    isAnimating: animating && animated && !reduceMotion
                )
            }
        }
        .frame(height: maxHeight)
        .onAppear {
            if animated && !reduceMotion {
                animating = true
            }
        }
    }
}

private struct WaveformBar: View {
    let index: Int
    let totalBars: Int
    let maxHeight: CGFloat
    let isAnimating: Bool

    @State private var height: CGFloat = 0

    private var baseHeight: CGFloat {
        let center = (totalBars - 1) / 2
        let distance = abs(index - center)
        let heights: [CGFloat] = [1.0, 0.82, 0.59, 0.36, 0.18]
        let normalizedHeight = distance < heights.count ? heights[distance] : 0.18
        return maxHeight * normalizedHeight
    }

    private var barOpacity: Double {
        let center = (totalBars - 1) / 2
        let distance = abs(index - center)
        let opacities: [Double] = [1.0, 1.0, 0.56, 0.44, 0.31]
        return distance < opacities.count ? opacities[distance] : 0.31
    }

    var body: some View {
        RoundedRectangle(cornerRadius: 2)
            .fill(DesignTokens.gold.opacity(barOpacity))
            .frame(width: 4, height: isAnimating ? height : baseHeight)
            .onAppear {
                height = baseHeight
                if isAnimating {
                    startAnimation()
                }
            }
            .onChange(of: isAnimating) { _, newValue in
                if newValue {
                    startAnimation()
                }
            }
    }

    private func startAnimation() {
        let delay = Double(index) * 0.1
        withAnimation(
            .easeInOut(duration: 0.6)
            .repeatForever(autoreverses: true)
            .delay(delay)
        ) {
            height = baseHeight * (0.3 + Double.random(in: 0...0.7))
        }
    }
}
