//
//  BrandMarkView.swift
//  PorizoApp
//
//  Reusable decorative brand mark sourced from the shipped B4 icon.
//

import SwiftUI

struct BrandMarkView: View {
    let size: CGFloat
    var shadowColor: Color = .clear
    var shadowRadius: CGFloat = 0
    var shadowY: CGFloat = 0

    var body: some View {
        Image("BrandMark")
            .resizable()
            .renderingMode(.original)
            .interpolation(.high)
            .scaledToFit()
            .frame(width: size, height: size)
            .shadow(color: shadowColor, radius: shadowRadius, y: shadowY)
            .accessibilityHidden(true)
    }
}

#Preview {
    ZStack {
        DesignTokens.background.ignoresSafeArea()
        BrandMarkView(size: 96, shadowColor: DesignTokens.gold.opacity(0.28), shadowRadius: 20, shadowY: 4)
    }
}
