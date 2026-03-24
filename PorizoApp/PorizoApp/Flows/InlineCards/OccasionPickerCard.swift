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
            PromptBubble(text: "What occasion is this for?")

            CompactChipScroll {
                ForEach(Occasion.allCases) { occasion in
                    CompactChip(label: occasion.displayName, emoji: occasion.emoji, isSelected: false) {
                        onSelect(occasion)
                    }
                }
            }
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
