//
//  AppBackgroundView.swift
//  PorizoApp
//
//  Shared app background with the splash-screen gradient
//  and subtle particles for visual continuity.
//

import SwiftUI

struct AppBackgroundView: View {
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    DesignTokens.gold.opacity(0.15),
                    DesignTokens.background
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            ParticleFieldView()
        }
        .ignoresSafeArea()
    }
}

private struct ParticleFieldView: View {
    private let particles: [BackgroundParticle] = [
        BackgroundParticle(x: 0.12, y: 0.14, size: 6, opacity: 0.10),
        BackgroundParticle(x: 0.86, y: 0.18, size: 4, opacity: 0.08),
        BackgroundParticle(x: 0.72, y: 0.32, size: 5, opacity: 0.09),
        BackgroundParticle(x: 0.24, y: 0.34, size: 3, opacity: 0.06),
        BackgroundParticle(x: 0.08, y: 0.52, size: 4, opacity: 0.08),
        BackgroundParticle(x: 0.88, y: 0.58, size: 6, opacity: 0.10),
        BackgroundParticle(x: 0.66, y: 0.64, size: 3, opacity: 0.06),
        BackgroundParticle(x: 0.18, y: 0.72, size: 5, opacity: 0.08),
        BackgroundParticle(x: 0.44, y: 0.78, size: 4, opacity: 0.07),
        BackgroundParticle(x: 0.76, y: 0.84, size: 3, opacity: 0.06),
        BackgroundParticle(x: 0.30, y: 0.90, size: 6, opacity: 0.09),
        BackgroundParticle(x: 0.54, y: 0.12, size: 4, opacity: 0.07)
    ]

    var body: some View {
        GeometryReader { geometry in
            ForEach(particles) { particle in
                Circle()
                    .fill(DesignTokens.gold.opacity(particle.opacity))
                    .frame(width: particle.size, height: particle.size)
                    .position(
                        x: particle.x * geometry.size.width,
                        y: particle.y * geometry.size.height
                    )
            }
        }
        .allowsHitTesting(false)
    }
}

private struct BackgroundParticle: Identifiable {
    let id = UUID()
    let x: CGFloat
    let y: CGFloat
    let size: CGFloat
    let opacity: Double
}

#Preview {
    AppBackgroundView()
}
