//
//  TypingIndicator.swift
//  PorizoApp
//
//  Animated typing indicator that shows three pulsing dots inside a rounded
//  AI-style bubble. Clearly communicates that the AI is processing.
//

import SwiftUI

struct TypingIndicator: View {
    @State private var opacity: Double = 0.4

    var body: some View {
        Text("Thinking...")
            .font(DesignTokens.bodyFont(size: 14, weight: .medium))
            .foregroundStyle(DesignTokens.gold)
            .opacity(opacity)
            .padding(.horizontal, 20)
            .padding(.vertical, 14)
            .background(DesignTokens.surface)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(DesignTokens.gold.opacity(0.35), lineWidth: 0.5)
            )
            .shadow(color: DesignTokens.gold.opacity(0.12), radius: 8, y: 3)
            .onAppear {
                withAnimation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true)) {
                    opacity = 1.0
                }
            }
    }
}

#Preview {
    ZStack {
        DesignTokens.background.ignoresSafeArea()

        VStack(spacing: 20) {
            TypingIndicator()
        }
        .padding(.horizontal, 16)
    }
}
