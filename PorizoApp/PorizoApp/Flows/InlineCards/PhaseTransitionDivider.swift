//
//  PhaseTransitionDivider.swift
//  PorizoApp
//
//  Subtle gold divider marking a phase transition in the creation flow.
//  Carries its own vertical padding so VStack(spacing: 4) stays untouched.
//

import SwiftUI

struct PhaseTransitionDivider: View {
    let icon: String
    var label: String? = nil
    var topPadding: CGFloat = 20
    var bottomPadding: CGFloat = 16

    var body: some View {
        HStack(spacing: 10) {
            Rectangle()
                .fill(DesignTokens.gold.opacity(0.25))
                .frame(height: 0.5)

            Image(systemName: icon)
                .font(.system(size: 12))
                .foregroundStyle(DesignTokens.gold.opacity(0.6))

            if let label {
                Text(label.uppercased())
                    .font(DesignTokens.bodyFont(size: 10, weight: .bold))
                    .foregroundStyle(DesignTokens.gold.opacity(0.5))
                    .tracking(1.5)
            }

            Rectangle()
                .fill(DesignTokens.gold.opacity(0.25))
                .frame(height: 0.5)
        }
        .padding(.top, topPadding)
        .padding(.bottom, bottomPadding)
    }
}

#Preview {
    ZStack {
        DesignTokens.background.ignoresSafeArea()

        VStack(spacing: 16) {
            PhaseTransitionDivider(icon: "mic.fill", label: "VOICE")
            PhaseTransitionDivider(icon: "music.note.list")
            PhaseTransitionDivider(icon: "waveform", label: "RENDERING")
            PhaseTransitionDivider(icon: "play.circle.fill")
        }
        .padding(.horizontal, 16)
    }
}
