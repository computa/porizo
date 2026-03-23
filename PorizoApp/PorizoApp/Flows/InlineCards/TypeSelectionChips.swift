//
//  TypeSelectionChips.swift
//  PorizoApp
//
//  Inline type selection chips for the pre-session chat shell.
//  Appears as a system message bubble with two option chips: Song and Poem.
//

import SwiftUI

struct TypeSelectionChips: View {
    let onSelectSong: () -> Void
    let onSelectPoem: () -> Void
    @State private var selected: String?

    var body: some View {
        HStack(spacing: 8) {
            chipButton(id: "song", label: "A Song", icon: "music.note", action: onSelectSong)
            chipButton(id: "poem", label: "A Poem", icon: "text.quote", action: onSelectPoem)
        }
    }

    private func chipButton(id: String, label: String, icon: String, action: @escaping () -> Void) -> some View {
        Button {
            withAnimation(.easeInOut(duration: 0.15)) { selected = id }
            action()
        } label: {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 12))
                Text(label)
                    .font(DesignTokens.bodyFont(size: 13, weight: .medium))
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .boldChipStyle(isSelected: selected == id)
        }
        .buttonStyle(.plain)
        .disabled(selected != nil)
    }
}

#Preview {
    ZStack {
        DesignTokens.background.ignoresSafeArea()

        VStack(spacing: 16) {
            TypeSelectionChips(
                onSelectSong: { print("Song selected") },
                onSelectPoem: { print("Poem selected") }
            )
        }
        .padding(.horizontal, 16)
    }
}
