//
//  CollapsibleStylePicker.swift
//  PorizoApp
//
//  Horizontal scrolling genre pills grouped by category + optional Create button.
//  Sits above the input bar during song creation.
//  Uses StyleStore for the full genre list (fetched from server, cached locally).
//

import SwiftUI

struct CollapsibleStylePicker: View {
    @Binding var selectedStyle: String?
    var styleStore: StyleStore
    var onCreate: (() -> Void)?
    var createEnabled: Bool = false

    @State private var selectedCategory: String = "popular"

    private var categoryKeys: [String] {
        styleStore.grouped.map(\.0)
    }

    private var filteredStyles: [StyleOption] {
        styleStore.grouped.first(where: { $0.0 == selectedCategory })?.1 ?? []
    }

    var body: some View {
        VStack(spacing: 6) {
            // Category tabs (only show if more than one category)
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
            }

            // Genre pills + Create button
            HStack(spacing: 8) {
                ScrollView(.horizontal, showsIndicators: false) {
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
                }

                if let onCreate {
                    Button { onCreate() } label: {
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
                    .disabled(!createEnabled)
                    .opacity(createEnabled ? 1.0 : 0.5)
                }
            }
        }
        .padding(.vertical, 8)
        .onAppear {
            // Auto-select category matching current style
            if let match = styleStore.styles.first(where: { $0.key == selectedStyle }) {
                selectedCategory = match.category
            }
        }
    }
}
