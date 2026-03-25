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
    var showMyVoice: Bool = true
    @State private var selected: VoiceChipKind?

    private enum VoiceChipKind: Equatable, Identifiable {
        case ai(VoiceGender)
        case myVoice

        var id: String {
            switch self {
            case .ai(let g): "ai_\(g.rawValue)"
            case .myVoice: "my_voice"
            }
        }

        var label: String {
            switch self {
            case .ai(let g): "AI \(g.displayName)"
            case .myVoice: "My Voice"
            }
        }

        var icon: String {
            switch self {
            case .ai: "person.fill"
            case .myVoice: "mic.fill"
            }
        }
    }

    private static let allOptions: [VoiceChipKind] = [
        .ai(.female), .ai(.male), .myVoice
    ]
    private static let aiOnlyOptions: [VoiceChipKind] = [
        .ai(.female), .ai(.male)
    ]

    private var options: [VoiceChipKind] {
        showMyVoice ? Self.allOptions : Self.aiOnlyOptions
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            PromptBubble(text: "How should your song sound?")

            // Voice option chips
            HStack(spacing: 8) {
                ForEach(options) { option in
                    chipButton(option: option)
                }
            }
        }
    }

    private func chipButton(option: VoiceChipKind) -> some View {
        let isSelected = selected == option

        return Button {
            withAnimation(.easeInOut(duration: 0.15)) {
                selected = option
            }
            switch option {
            case .ai(let gender):
                onSelect(.aiVoice, gender)
            case .myVoice:
                onMyVoice()
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
