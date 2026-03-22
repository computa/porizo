//
//  CollapsibleStylePicker.swift
//  PorizoApp
//
//  Collapsible style picker for creation flow redesign.
//  Collapsed: horizontal scrolling pills + Create button (compact)
//  Expanded: 3-column visual grid with icons (browsable)
//

import SwiftUI

#if DEBUG

struct CollapsibleStylePicker: View {
    @Binding var selectedStyle: String?
    @State private var isExpanded = false

    private let styles: [(name: String, icon: String)] = [
        ("Acoustic", "guitars.fill"),
        ("Soul", "heart.fill"),
        ("Pop", "star.fill"),
        ("R&B", "waveform"),
        ("Folk", "leaf.fill"),
        ("Ballad", "moon.fill"),
    ]

    var body: some View {
        VStack(spacing: 10) {
            if isExpanded {
                expandedGrid
            }
            collapsedBar
        }
    }

    // MARK: - Collapsed: horizontal pills + Create

    private var collapsedBar: some View {
        HStack(spacing: 8) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    // Expand/collapse toggle
                    Button {
                        withAnimation(.easeInOut(duration: 0.25)) {
                            isExpanded.toggle()
                        }
                    } label: {
                        Image(systemName: isExpanded ? "chevron.down" : "chevron.up")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(DesignTokens.textTertiary)
                            .frame(width: 28, height: 28)
                            .background(DesignTokens.surface)
                            .clipShape(Circle())
                            .overlay(Circle().stroke(DesignTokens.border, lineWidth: 0.5))
                    }

                    ForEach(styles, id: \.name) { style in
                        let isSelected = selectedStyle == style.name
                        Button {
                            withAnimation(.easeInOut(duration: 0.15)) {
                                selectedStyle = style.name
                            }
                        } label: {
                            Text(style.name)
                                .font(DesignTokens.bodyFont(size: 13, weight: .medium))
                                .padding(.horizontal, 14)
                                .padding(.vertical, 8)
                                .background(isSelected ? DesignTokens.gold : DesignTokens.surface)
                                .foregroundStyle(isSelected ? .black : DesignTokens.textSecondary)
                                .clipShape(Capsule())
                                .overlay(
                                    Capsule().stroke(isSelected ? .clear : DesignTokens.border, lineWidth: 0.5)
                                )
                        }
                    }
                }
            }

            // Create button
            Button {} label: {
                HStack(spacing: 4) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 12))
                    Text("Create")
                        .font(DesignTokens.bodyFont(size: 14, weight: .semibold))
                }
                .foregroundStyle(.black)
                .padding(.horizontal, 18)
                .padding(.vertical, 10)
                .background(DesignTokens.gold)
                .clipShape(Capsule())
            }
        }
    }

    // MARK: - Expanded: visual icon grid

    private var expandedGrid: some View {
        LazyVGrid(columns: [
            GridItem(.flexible()),
            GridItem(.flexible()),
            GridItem(.flexible()),
        ], spacing: 8) {
            ForEach(styles, id: \.name) { style in
                let isSelected = selectedStyle == style.name
                Button {
                    withAnimation(.easeInOut(duration: 0.15)) {
                        selectedStyle = style.name
                    }
                } label: {
                    VStack(spacing: 6) {
                        Image(systemName: style.icon)
                            .font(.system(size: 20))
                            .foregroundStyle(isSelected ? .black : DesignTokens.gold)
                        Text(style.name)
                            .font(DesignTokens.bodyFont(size: 12, weight: .medium))
                            .foregroundStyle(isSelected ? .black : DesignTokens.textPrimary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(isSelected ? DesignTokens.gold : DesignTokens.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(isSelected ? .clear : DesignTokens.border, lineWidth: 0.5)
                    )
                }
            }
        }
    }
}

#endif
