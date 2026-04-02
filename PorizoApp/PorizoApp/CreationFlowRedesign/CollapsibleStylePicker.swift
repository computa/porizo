//
//  CollapsibleStylePicker.swift
//  PorizoApp
//
//  Warm Canvas style picker — collapsed bar showing "🎵 Style: {name}"
//  that expands to a full genre picker on tap.
//  Uses StyleStore for the full genre list (fetched from server, cached locally).
//

import SwiftUI

struct CollapsibleStylePicker: View {
    @Binding var selectedStyle: String?
    var styleStore: StyleStore
    var onCreate: (() -> Void)?
    var createEnabled: Bool = false
    var autoExpand: Bool = false

    @State private var isExpanded = false
    @State private var selectedCategory: String = "popular"

    private var categoryKeys: [String] {
        styleStore.grouped.map(\.0)
    }

    private var filteredStyles: [StyleOption] {
        styleStore.grouped.first(where: { $0.0 == selectedCategory })?.1 ?? []
    }

    private var selectedDisplayName: String {
        if let key = selectedStyle,
           let match = styleStore.styles.first(where: { $0.key == key }) {
            return match.displayName
        }
        return "Choose"
    }

    var body: some View {
        VStack(spacing: 0) {
            // Collapsed bar — toggle expand + Create button as SEPARATE tap targets
            HStack {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) { isExpanded.toggle() }
                } label: {
                    HStack {
                        Text("🎵 Style: \(selectedDisplayName)")
                            .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                            .foregroundStyle(DesignTokens.textPrimary)
                        Spacer()
                        Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(DesignTokens.textSecondary)
                    }
                }
                .buttonStyle(.plain)

                if let onCreate, isExpanded {
                    Button {
                        onCreate()
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "sparkles")
                                .font(.system(size: 14))
                            Text("Create")
                                .font(DesignTokens.bodyFont(size: 14, weight: .semibold))
                        }
                        .foregroundStyle(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 9)
                        .background(DesignTokens.gold)
                        .clipShape(Capsule())
                    }
                    .disabled(!createEnabled)
                    .opacity(createEnabled ? 1.0 : 0.5)
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 14)

            // Expanded picker
            if isExpanded {
                VStack(spacing: 6) {
                    // Category tabs
                    if categoryKeys.count > 1 {
                        HStack(spacing: 0) {
                            ForEach(categoryKeys, id: \.self) { cat in
                                Button {
                                    withAnimation(.easeInOut(duration: 0.15)) {
                                        selectedCategory = cat
                                    }
                                } label: {
                                    Text(cat.capitalized)
                                        .font(DesignTokens.bodyFont(size: 11, weight: .semibold))
                                        .foregroundStyle(selectedCategory == cat ? DesignTokens.gold : DesignTokens.textTertiary)
                                        .padding(.vertical, 4)
                                        .frame(maxWidth: .infinity)
                                }
                            }
                        }
                        .padding(.horizontal, 20)
                    }

                    // Genre pills
                    ScrollView(.horizontal) {
                        HStack(spacing: 6) {
                            ForEach(filteredStyles) { style in
                                let isSelected = selectedStyle == style.key
                                Button {
                                    withAnimation(.easeInOut(duration: 0.15)) {
                                        selectedStyle = style.key
                                    }
                                } label: {
                                    Text(style.displayName)
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
                        .padding(.horizontal, 20)
                    }
                    .scrollIndicators(.hidden)
                }
                .padding(.bottom, 8)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .background(DesignTokens.surface)
        .overlay(alignment: .top) {
            Rectangle().fill(DesignTokens.border).frame(height: 1)
        }
        .onAppear {
            if let match = styleStore.styles.first(where: { $0.key == selectedStyle }) {
                selectedCategory = match.category
            }
        }
        .onChange(of: autoExpand) { _, shouldExpand in
            if shouldExpand && selectedStyle == nil && !isExpanded {
                withAnimation(.easeInOut(duration: 0.3)) { isExpanded = true }
            }
        }
    }
}
