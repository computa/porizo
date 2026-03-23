//
//  TypingIndicator.swift
//  PorizoApp
//
//  Animated typing indicator that shows three pulsing dots inside a rounded
//  AI-style bubble. Clearly communicates that the AI is processing.
//

import SwiftUI

struct TypingIndicator: View {
    @State private var dotOffsets: [CGFloat] = [0, 0, 0]

    var body: some View {
        HStack(spacing: 8) {
            ForEach(0..<3, id: \.self) { index in
                Circle()
                    .fill(DesignTokens.gold)
                    .frame(width: 10, height: 10)
                    .shadow(color: DesignTokens.gold.opacity(0.4), radius: 3, y: 0)
                    .offset(y: dotOffsets[index])
            }
        }
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
            animateDots()
        }
    }

    private func animateDots() {
        for index in 0..<3 {
            withAnimation(
                .easeInOut(duration: 0.45)
                .repeatForever(autoreverses: true)
                .delay(Double(index) * 0.15)
            ) {
                dotOffsets[index] = -6
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
