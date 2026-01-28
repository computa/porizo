//
//  DeleteConfirmationView.swift
//  PorizoApp
//
//  Modal confirmation dialog for destructive delete actions.
//  Matches v1.pen "18 - Delete Confirmation" design.
//

import SwiftUI

// MARK: - Delete Confirmation View

struct DeleteConfirmationView: View {
    let title: String
    let itemName: String
    let onConfirm: () -> Void
    let onCancel: () -> Void

    init(
        title: String = "Delete Song?",
        itemName: String,
        onConfirm: @escaping () -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.title = title
        self.itemName = itemName
        self.onConfirm = onConfirm
        self.onCancel = onCancel
    }

    var body: some View {
        ZStack {
            // Dimmed overlay
            Color.black.opacity(0.6)
                .ignoresSafeArea()
                .onTapGesture {
                    onCancel()
                }

            // Modal
            VStack(spacing: 16) {
                // Warning icon
                warningIcon

                // Title
                Text(title)
                    .font(.custom("PlayfairDisplay-SemiBold", size: 20))
                    .foregroundColor(DesignTokens.textPrimary)

                // Message
                Text("This will permanently delete \"\(itemName)\". This action cannot be undone.")
                    .font(.system(size: 14))
                    .foregroundColor(DesignTokens.textTertiary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 272)

                // Button row
                HStack(spacing: 12) {
                    // Cancel button
                    Button(action: onCancel) {
                        Text("Cancel")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundColor(DesignTokens.textPrimary)
                            .frame(maxWidth: .infinity)
                            .frame(height: 48)
                            .background(Color.clear)
                            .overlay(
                                RoundedRectangle(cornerRadius: 24)
                                    .stroke(DesignTokens.border, lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)

                    // Delete button
                    Button(action: onConfirm) {
                        Text("Delete")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .frame(height: 48)
                            .background(DesignTokens.error)
                            .cornerRadius(24)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(24)
            .background(DesignTokens.surface)
            .cornerRadius(24)
            .frame(width: 320)
        }
        .transition(.opacity.combined(with: .scale(scale: 0.95)))
    }

    // MARK: - Warning Icon

    private var warningIcon: some View {
        ZStack {
            Circle()
                .fill(DesignTokens.error.opacity(0.2))
                .frame(width: 48, height: 48)

            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 20))
                .foregroundColor(DesignTokens.error)
        }
    }
}

// MARK: - View Modifier for Presenting

struct DeleteConfirmationModifier: ViewModifier {
    @Binding var isPresented: Bool
    let title: String
    let itemName: String
    let onConfirm: () -> Void

    func body(content: Content) -> some View {
        content
            .overlay {
                if isPresented {
                    DeleteConfirmationView(
                        title: title,
                        itemName: itemName,
                        onConfirm: {
                            withAnimation(.easeOut(duration: 0.2)) {
                                isPresented = false
                            }
                            onConfirm()
                        },
                        onCancel: {
                            withAnimation(.easeOut(duration: 0.2)) {
                                isPresented = false
                            }
                        }
                    )
                }
            }
            .animation(.spring(response: 0.25, dampingFraction: 0.8), value: isPresented)
    }
}

extension View {
    func deleteConfirmation(
        isPresented: Binding<Bool>,
        title: String = "Delete Song?",
        itemName: String,
        onConfirm: @escaping () -> Void
    ) -> some View {
        modifier(DeleteConfirmationModifier(
            isPresented: isPresented,
            title: title,
            itemName: itemName,
            onConfirm: onConfirm
        ))
    }
}

// MARK: - Preview

#Preview {
    ZStack {
        DesignTokens.background.ignoresSafeArea()

        VStack {
            Text("Background Content")
                .foregroundColor(DesignTokens.textPrimary)
        }

        DeleteConfirmationView(
            title: "Delete Song?",
            itemName: "Happy Birthday Sarah",
            onConfirm: { print("Deleted") },
            onCancel: { print("Cancelled") }
        )
    }
}
