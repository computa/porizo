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
                        .frame(width: 120, height: 120)

                    Image(systemName: "mic.fill")
                        .font(.system(size: 48))
                        .foregroundColor(.white)
                }
                .scaleEffect(showLogo ? 1 : 0.8)
                .opacity(showLogo ? 1 : 0)

                // Brand name in Playfair Display
                Text("porizo")
                    .font(DesignTokens.displayFont(size: 36))
                    .tracking(2) // letter-spacing: 2pt
                    .foregroundColor(DesignTokens.textPrimary)
                    .opacity(showLogo ? 1 : 0)
                    .offset(y: showLogo ? 0 : 10)
            }
        }
        .onAppear {
            withAnimation(.easeOut(duration: 0.6)) {
                showLogo = true
            }
        }
    }
}

#Preview {
    SplashView()
}
