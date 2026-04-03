//
//  SplashView.swift
//  PorizoApp
//
//  Splash screen with pulsing coral glow behind the mic circle.
//  Warm Canvas design — radial pulse animation with fade-in.
//

import SwiftUI

struct SplashView: View {
    @State private var showLogo = false
    @State private var pulsePhase = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            DesignTokens.background.ignoresSafeArea()

            VStack(spacing: 24) {
                ZStack {
                    // Outer radial glow — pulsing coral halo
                    if !reduceMotion {
                        Circle()
                            .fill(
                                RadialGradient(
                                    colors: [
                                        DesignTokens.gold.opacity(0.3),
                                        DesignTokens.gold.opacity(0.08),
                                        DesignTokens.gold.opacity(0)
                                    ],
                                    center: .center,
                                    startRadius: 30,
                                    endRadius: 100
                                )
                            )
                            .frame(width: 200, height: 200)
                            .scaleEffect(pulsePhase ? 1.15 : 0.9)
                            .opacity(showLogo ? (pulsePhase ? 0.6 : 1.0) : 0)

                        // Inner glow ring
                        Circle()
                            .fill(
                                RadialGradient(
                                    colors: [
                                        DesignTokens.gold.opacity(0.15),
                                        DesignTokens.gold.opacity(0)
                                    ],
                                    center: .center,
                                    startRadius: 48,
                                    endRadius: 80
                                )
                            )
                            .frame(width: 160, height: 160)
                            .scaleEffect(pulsePhase ? 1.05 : 0.95)
                            .opacity(showLogo ? 1.0 : 0)
                    }

                    // Gold mic circle
                    Circle()
                        .fill(DesignTokens.gold)
                        .frame(width: 96, height: 96)
                        .shadow(color: DesignTokens.gold.opacity(0.3), radius: 20, y: 4)

                    Image(systemName: "mic.fill")
                        .font(.system(size: 40))
                        .foregroundStyle(.white)
                }
                .scaleEffect(reduceMotion ? 1 : (showLogo ? 1 : 0.8))
                .opacity(showLogo ? 1 : 0)

                Text("porizo")
                    .font(DesignTokens.displayFont(size: 24))
                    .italic()
                    .foregroundStyle(DesignTokens.gold)
                    .opacity(showLogo ? 1 : 0)
                    .offset(y: reduceMotion ? 0 : (showLogo ? 0 : 10))
            }
        }
        .onAppear {
            if reduceMotion {
                showLogo = true
            } else {
                withAnimation(.easeOut(duration: 0.6)) {
                    showLogo = true
                }
                withAnimation(
                    .easeInOut(duration: 1.8)
                    .repeatForever(autoreverses: true)
                ) {
                    pulsePhase = true
                }
            }
        }
    }
}

#Preview {
    SplashView()
}
