//
//  SplashView.swift
//  PorizoApp
//
//  Splash screen matching v1.pen "00 - Splash" design.
//  Clean, centered logo with subtle fade-in animation.
//

import SwiftUI

struct SplashView: View {
    @State private var showLogo = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            // Background: Deep velvet black
            DesignTokens.background.ignoresSafeArea()

            // Centered logo container
            VStack(spacing: 24) {
                // Gold mic circle (120x120)
                ZStack {
                    Circle()
                        .fill(DesignTokens.gold)
                        .frame(width: 96, height: 96)

                    Image(systemName: "mic.fill")
                        .font(.system(size: 40))
                        .foregroundStyle(.white)
                }
                .scaleEffect(reduceMotion ? 1 : (showLogo ? 1 : 0.8))
                .opacity(showLogo ? 1 : 0)

                // Brand name in Playfair Display
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
            }
        }
    }
}

#Preview {
    SplashView()
}
