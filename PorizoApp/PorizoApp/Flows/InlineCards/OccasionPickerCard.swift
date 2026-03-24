//
//  OccasionPickerCard.swift
//  PorizoApp
//
//  Inline occasion picker shown after type selection and before the story session starts.
//

import SwiftUI

struct OccasionPickerCard: View {
    let onSelect: (Occasion) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 0) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(DesignTokens.gold)
                    .frame(width: 3)

                Text("What occasion is this for?")
                    .font(DesignTokens.bodyFont(size: 15))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .lineSpacing(3)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
            }
            .background(DesignTokens.surface)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .stroke(DesignTokens.border.opacity(0.5), lineWidth: 0.5)
            )

            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    ForEach(Occasion.allCases) { occasion in
                        Button {
                            onSelect(occasion)
                        } label: {
                            HStack(spacing: 6) {
                                Text(occasion.emoji)
                                    .font(.system(size: 14))
                                Text(occasion.displayName)
                                    .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(DesignTokens.surface)
                            .foregroundStyle(DesignTokens.textSecondary)
                            .clipShape(Capsule())
                            .overlay(
                                Capsule()
                                    .stroke(DesignTokens.border, lineWidth: 0.5)
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .scrollIndicators(.hidden)
        }
    }
}

#Preview {
    ZStack {
        DesignTokens.background.ignoresSafeArea()

        OccasionPickerCard { _ in }
            .padding(.horizontal, 16)
    }
}
