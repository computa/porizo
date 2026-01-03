//
//  SplashView.swift
//  PorizoApp
//
//  Animated launch screen with particle globe visualization.
//  Light mode design conveying love and warmth.
//

import SwiftUI

struct SplashView: View {
    @State private var showLogo = false
    @State private var showParticles = false
    @State private var rotationAngle: Double = 0
    @State private var pulseScale: CGFloat = 1.0

    var body: some View {
        ZStack {
            // Light gradient background
            LinearGradient(
                colors: [
                    DesignTokens.roseMuted,
                    Color.white
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 32) {
                Spacer()

                // Animated particle globe with mic
                ZStack {
                    // Outer glow ring
                    Circle()
                        .stroke(DesignTokens.roseLight.opacity(0.3), lineWidth: 2)
                        .frame(width: 180, height: 180)
                        .scaleEffect(pulseScale)

                    // Particle ring
                    ParticleRingView(rotationAngle: rotationAngle)
                        .frame(width: 150, height: 150)
                        .opacity(showParticles ? 1 : 0)

                    // Center mic icon
                    ZStack {
                        Circle()
                            .fill(
                                LinearGradient(
                                    colors: [DesignTokens.rose, DesignTokens.roseDark],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                            .frame(width: 80, height: 80)
                            .shadow(color: DesignTokens.rose.opacity(0.3), radius: 20, x: 0, y: 10)

                        Image(systemName: "mic.fill")
                            .font(.system(size: 32, weight: .medium))
                            .foregroundColor(.white)
                    }
                    .scaleEffect(showLogo ? 1 : 0.5)
                    .opacity(showLogo ? 1 : 0)
                }

                // Logo text
                VStack(spacing: 8) {
                    Text("Porizo")
                        .font(.system(size: 36, weight: .bold, design: .rounded))
                        .foregroundColor(DesignTokens.textPrimary)

                    Text("Songs from the heart")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(DesignTokens.textSecondary)
                }
                .opacity(showLogo ? 1 : 0)
                .offset(y: showLogo ? 0 : 20)

                Spacer()
                Spacer()
            }
        }
        .onAppear {
            startAnimations()
        }
    }

    private func startAnimations() {
        // Logo fade in
        withAnimation(.easeOut(duration: 0.6)) {
            showLogo = true
        }

        // Particles fade in
        withAnimation(.easeOut(duration: 0.8).delay(0.3)) {
            showParticles = true
        }

        // Continuous rotation
        withAnimation(.linear(duration: 20).repeatForever(autoreverses: false)) {
            rotationAngle = 360
        }

        // Pulse animation
        withAnimation(.easeInOut(duration: 2).repeatForever(autoreverses: true)) {
            pulseScale = 1.1
        }
    }
}

// MARK: - Particle Ring

struct ParticleRingView: View {
    let rotationAngle: Double
    let particleCount = 12

    var body: some View {
        GeometryReader { geometry in
            let center = CGPoint(x: geometry.size.width / 2, y: geometry.size.height / 2)
            let radius = min(geometry.size.width, geometry.size.height) / 2

            ZStack {
                ForEach(0..<particleCount, id: \.self) { index in
                    let angle = (Double(index) / Double(particleCount)) * 360 + rotationAngle
                    let x = center.x + CGFloat(cos(angle * .pi / 180)) * radius
                    let y = center.y + CGFloat(sin(angle * .pi / 180)) * radius
                    let size: CGFloat = index % 3 == 0 ? 8 : (index % 2 == 0 ? 6 : 4)

                    Circle()
                        .fill(particleColor(for: index))
                        .frame(width: size, height: size)
                        .position(x: x, y: y)
                        .shadow(color: DesignTokens.rose.opacity(0.5), radius: 4)
                }
            }
        }
    }

    private func particleColor(for index: Int) -> Color {
        let colors: [Color] = [
            DesignTokens.rose,
            DesignTokens.roseLight,
            DesignTokens.roseDark
        ]
        return colors[index % colors.count]
    }
}

#Preview {
    SplashView()
}
