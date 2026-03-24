//
//  ThemePickerSheet.swift
//  PorizoApp
//
//  Theme picker bottom sheet matching v1.pen "13 - Settings Sheet" design.
//  Allows selection of Light, Dark, or System appearance.
//  Velvet & Gold design system.
//

import SwiftUI

// MARK: - Theme Option

enum AppTheme: String, CaseIterable, Identifiable {
    case light = "light"
    case dark = "dark"
    case system = "system"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .light: return "Light"
        case .dark: return "Dark"
        case .system: return "System"
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .light: return .light
        case .dark: return .dark
        case .system: return nil
        }
    }
}

// MARK: - Theme Picker Sheet

struct ThemePickerSheet: View {
    @Binding var selectedTheme: AppTheme
    let onDismiss: () -> Void

    @State private var hapticTrigger = false

    var body: some View {
        VStack(spacing: 0) {
            // Sheet handle (v1.pen: gold bar, 36w x 4h)
            sheetHandle

            // Title (v1.pen: Playfair Display 20pt)
            Text("Theme")
                .font(DesignTokens.displayFont(size: 20))
                .foregroundStyle(DesignTokens.textPrimary)
                .padding(.top, 16)
                .padding(.bottom, 24)

            // Options list
            VStack(spacing: 0) {
                ForEach(AppTheme.allCases) { theme in
                    themeRow(theme: theme)

                    if theme != AppTheme.allCases.last {
                        Divider()
                            .background(DesignTokens.borderSubtle)
                    }
                }
            }
            .background(DesignTokens.surface)
            .clipShape(.rect(cornerRadius: 12))
            .padding(.horizontal, 20)

            // Cancel button (v1.pen: 48h, rounded corners)
            Button {
                onDismiss()
            } label: {
                Text("Cancel")
                    .font(DesignTokens.bodyFont(size: 16, weight: .medium))
                    .foregroundStyle(DesignTokens.textPrimary)
                    .frame(maxWidth: .infinity)
                    .frame(height: 48)
                    .background(DesignTokens.surface)
                    .clipShape(.rect(cornerRadius: 12))
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)
            .padding(.bottom, 32)

            Spacer()
        }
        .background(DesignTokens.background.ignoresSafeArea())
        .sensoryFeedback(.impact(weight: .light), trigger: hapticTrigger)
        .presentationDetents([.height(340)])
        .presentationDragIndicator(.hidden)
    }

    // MARK: - Sheet Handle

    private var sheetHandle: some View {
        RoundedRectangle(cornerRadius: 2)
            .fill(DesignTokens.gold)
            .frame(width: 36, height: 4)
            .padding(.top, 12)
    }

    // MARK: - Theme Row

    private func themeRow(theme: AppTheme) -> some View {
        Button {
            hapticTrigger.toggle()
            withAnimation(.easeInOut(duration: 0.2)) {
                selectedTheme = theme
            }
        } label: {
            HStack {
                Text(theme.displayName)
                    .font(DesignTokens.bodyFont(size: 16))
                    .foregroundStyle(DesignTokens.textPrimary)

                Spacer()

                // Checkmark for selected (v1.pen: gold checkmark)
                if selectedTheme == theme {
                    Image(systemName: "checkmark")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(DesignTokens.gold)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 16)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Preview

#Preview {
    ZStack {
        DesignTokens.background
            .ignoresSafeArea()

        ThemePickerSheet(
            selectedTheme: .constant(.system),
            onDismiss: { }
        )
    }
}
