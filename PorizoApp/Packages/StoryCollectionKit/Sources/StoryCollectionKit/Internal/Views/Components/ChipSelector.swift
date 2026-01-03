//
//  ChipSelector.swift
//  StoryCollectionKit
//
//  A horizontal scrolling chip/pill selector.
//

import SwiftUI

/// Horizontal scrollable chip selector for style/occasion pills
struct ChipSelector: View {
    let items: [StyleOption]
    @Binding var selection: String
    var showRefreshButton: Bool = false
    var onRefresh: (() -> Void)? = nil
    let theme: WizardTheme

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                // Optional refresh button
                if showRefreshButton, let refresh = onRefresh {
                    Button(action: refresh) {
                        Image(systemName: "arrow.clockwise")
                            .font(.subheadline)
                            .foregroundColor(theme.textSecondary)
                            .frame(width: 36, height: 36)
                            .background(theme.backgroundColor)
                            .cornerRadius(18)
                            .overlay(
                                RoundedRectangle(cornerRadius: 18)
                                    .stroke(theme.borderColor, lineWidth: 1)
                            )
                    }
                }

                ForEach(items) { item in
                    Button {
                        withAnimation(.easeInOut(duration: 0.15)) {
                            selection = item.id
                        }
                    } label: {
                        Text(item.displayName)
                            .font(.subheadline)
                            .fontWeight(selection == item.id ? .semibold : .regular)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                            .background(
                                RoundedRectangle(cornerRadius: 18)
                                    .fill(selection == item.id ? theme.primaryColor : theme.backgroundColor)
                            )
                            .foregroundColor(selection == item.id ? .white : theme.textPrimary)
                            .overlay(
                                RoundedRectangle(cornerRadius: 18)
                                    .stroke(selection == item.id ? Color.clear : theme.borderColor, lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

/// Chip selector specifically for occasions (with emoji support)
struct OccasionChipSelector: View {
    let items: [OccasionOption]
    @Binding var selection: String
    let theme: WizardTheme

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(items) { item in
                    Button {
                        withAnimation(.easeInOut(duration: 0.15)) {
                            selection = item.id
                        }
                    } label: {
                        Text(item.displayName)
                            .font(.subheadline)
                            .fontWeight(selection == item.id ? .semibold : .regular)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                            .background(
                                RoundedRectangle(cornerRadius: 18)
                                    .fill(selection == item.id ? theme.primaryColor : theme.backgroundColor)
                            )
                            .foregroundColor(selection == item.id ? .white : theme.textPrimary)
                            .overlay(
                                RoundedRectangle(cornerRadius: 18)
                                    .stroke(selection == item.id ? Color.clear : theme.borderColor, lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}
