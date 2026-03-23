//
//  VoiceSelectionChips.swift
//  PorizoApp
//
//  Inline voice selection chips for the All-in-Chat creation flow.
//  Appears as a system message bubble with three voice option chips below.
//

import SwiftUI

struct VoiceSelectionChips: View {
    let onSelect: (VoiceMode, VoiceGender?) -> Void
    let onMyVoice: () -> Void
    @State private var selected: String?

    private struct ChipOption: Identifiable {
        let id: String
        let label: String
        let icon: String
    }

    private let options: [ChipOption] = [
        ChipOption(id: "ai_female", label: "AI Female", icon: "person.fill"),
        ChipOption(id: "ai_male", label: "AI Male", icon: "person.fill"),
        ChipOption(id: "my_voice", label: "My Voice", icon: "mic.fill"),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // System message bubble with gold accent bar
            HStack(spacing: 0) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(DesignTokens.gold)
                    .frame(width: 3)

                Text("How should your song sound?")
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

            // Voice option chips
            HStack(spacing: 8) {
                ForEach(options) { option in
                    chipButton(option: option)
                }
            }
        }
    }

    private func chipButton(option: ChipOption) -> some View {
        let isSelected = selected == option.id

        return Button {
            withAnimation(.easeInOut(duration: 0.15)) {
                selected = option.id
            }
            switch option.id {
            case "ai_female":
                onSelect(.aiVoice, .female)
            case "ai_male":
                onSelect(.aiVoice, .male)
            case "my_voice":
                onMyVoice()
            default:
                break
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: option.icon)
                    .font(.system(size: 12))
                Text(option.label)
                    .font(DesignTokens.bodyFont(size: 13, weight: .medium))
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .boldChipStyle(isSelected: isSelected)
        }
        .buttonStyle(.plain)
    }
}

#Preview {
    ZStack {
        DesignTokens.background.ignoresSafeArea()

        VStack(spacing: 16) {
            VoiceSelectionChips(
                onSelect: { mode, gender in
                    print("Selected: \(mode) \(gender?.displayName ?? "none")")
                },
                onMyVoice: {
                    print("My Voice tapped")
                }
            )
        }
        .padding(.horizontal, 16)
    }
}
