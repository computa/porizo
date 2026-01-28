//
//  SongActionMenu.swift
//  PorizoApp
//
//  Bottom sheet action menu for songs with play, share, and delete options.
//  Matches v1.pen "16 - Song Action Menu" design.
//

import SwiftUI

// MARK: - Song Action Menu

struct SongActionMenu: View {
    let track: Track
    let onPlay: () -> Void
    let onShare: () -> Void
    let onDelete: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        ZStack(alignment: .bottom) {
            // Dimmed overlay
            Color.black.opacity(0.7)
                .ignoresSafeArea()
                .onTapGesture {
                    onDismiss()
                }

            // Bottom sheet
            VStack(spacing: 16) {
                // Handle bar
                handleBar

                // Song preview
                songPreview

                // Divider
                Rectangle()
                    .fill(DesignTokens.border)
                    .frame(height: 1)

                // Action list
                VStack(spacing: 0) {
                    actionRow(
                        icon: "play.circle",
                        label: "Play",
                        color: DesignTokens.textPrimary,
                        action: onPlay
                    )

                    actionRow(
                        icon: "square.and.arrow.up",
                        label: "Share",
                        color: DesignTokens.textPrimary,
                        action: onShare
                    )

                    actionRow(
                        icon: "trash",
                        label: "Delete",
                        color: DesignTokens.error,
                        action: onDelete
                    )
                }

                // Cancel button
                cancelButton
            }
            .padding(.horizontal, 24)
            .padding(.top, 16)
            .padding(.bottom, 58)
            .background(DesignTokens.surface)
            .clipShape(RoundedCorners(radius: 24, corners: [.topLeft, .topRight]))
        }
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    // MARK: - Handle Bar

    private var handleBar: some View {
        RoundedRectangle(cornerRadius: 2)
            .fill(DesignTokens.gold)
            .frame(width: 36, height: 4)
    }

    // MARK: - Song Preview

    private var songPreview: some View {
        HStack(spacing: 12) {
            // Artwork placeholder
            RoundedRectangle(cornerRadius: 8)
                .fill(DesignTokens.border)
                .frame(width: 56, height: 56)
                .overlay(
                    Image(systemName: "music.note")
                        .font(.title2)
                        .foregroundColor(DesignTokens.textTertiary)
                )

            // Song info
            VStack(alignment: .leading, spacing: 4) {
                Text(track.title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(DesignTokens.textPrimary)
                    .lineLimit(1)

                Text(songSubtitle)
                    .font(.system(size: 13))
                    .foregroundColor(DesignTokens.textTertiary)
                    .lineLimit(1)
            }

            Spacer()

            // Status badge
            statusBadge
        }
    }

    private var songSubtitle: String {
        var parts: [String] = []
        if let style = track.style {
            parts.append(style.capitalized)
        }
        if let recipientName = track.recipientName {
            parts.append(recipientName)
        }
        if let occasion = track.occasion {
            parts.append(occasion.capitalized)
        }
        return parts.joined(separator: " • ")
    }

    private var statusBadge: some View {
        let (text, color) = statusInfo
        return Text(text)
            .font(.system(size: 12, weight: .medium))
            .foregroundColor(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(color.opacity(0.2))
            .cornerRadius(4)
    }

    private var statusInfo: (String, Color) {
        switch track.status {
        case "ready", "completed":
            return ("Ready", DesignTokens.success)
        case "rendering", "processing":
            return ("Rendering", DesignTokens.warning)
        case "failed":
            return ("Failed", DesignTokens.error)
        default:
            return ("Draft", DesignTokens.textSecondary)
        }
    }

    // MARK: - Action Row

    private func actionRow(
        icon: String,
        label: String,
        color: Color,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 20))
                    .foregroundColor(color)
                    .frame(width: 24)

                Text(label)
                    .font(.system(size: 16))
                    .foregroundColor(color)

                Spacer()
            }
            .frame(height: 52)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Cancel Button

    private var cancelButton: some View {
        Button(action: onDismiss) {
            Text("Cancel")
                .font(.system(size: 16, weight: .medium))
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
    }
}

// MARK: - Rounded Corners Shape

struct RoundedCorners: Shape {
    var radius: CGFloat
    var corners: UIRectCorner

    func path(in rect: CGRect) -> Path {
        let path = UIBezierPath(
            roundedRect: rect,
            byRoundingCorners: corners,
            cornerRadii: CGSize(width: radius, height: radius)
        )
        return Path(path.cgPath)
    }
}

// MARK: - View Modifier for Presenting

struct SongActionMenuModifier: ViewModifier {
    @Binding var isPresented: Bool
    let track: Track?
    let onPlay: () -> Void
    let onShare: () -> Void
    let onDelete: () -> Void

    func body(content: Content) -> some View {
        content
            .overlay {
                if isPresented, let track = track {
                    SongActionMenu(
                        track: track,
                        onPlay: {
                            withAnimation(.easeOut(duration: 0.2)) {
                                isPresented = false
                            }
                            onPlay()
                        },
                        onShare: {
                            withAnimation(.easeOut(duration: 0.2)) {
                                isPresented = false
                            }
                            onShare()
                        },
                        onDelete: {
                            withAnimation(.easeOut(duration: 0.2)) {
                                isPresented = false
                            }
                            onDelete()
                        },
                        onDismiss: {
                            withAnimation(.easeOut(duration: 0.2)) {
                                isPresented = false
                            }
                        }
                    )
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
                }
            }
            .animation(.spring(response: 0.3, dampingFraction: 0.8), value: isPresented)
    }
}

extension View {
    func songActionMenu(
        isPresented: Binding<Bool>,
        track: Track?,
        onPlay: @escaping () -> Void,
        onShare: @escaping () -> Void,
        onDelete: @escaping () -> Void
    ) -> some View {
        modifier(SongActionMenuModifier(
            isPresented: isPresented,
            track: track,
            onPlay: onPlay,
            onShare: onShare,
            onDelete: onDelete
        ))
    }
}

// MARK: - Preview

#Preview {
    ZStack {
        DesignTokens.background.ignoresSafeArea()

        SongActionMenu(
            track: Track(
                id: "1",
                userId: "user1",
                title: "Happy Birthday Sarah",
                occasion: "birthday",
                recipientName: "Sarah",
                style: "pop",
                durationTarget: nil,
                voiceMode: "ai",
                message: nil,
                status: "ready",
                latestVersion: 1,
                shareTokenId: nil,
                createdAt: "2026-01-27T00:00:00Z",
                updatedAt: "2026-01-27T00:00:00Z"
            ),
            onPlay: { print("Play") },
            onShare: { print("Share") },
            onDelete: { print("Delete") },
            onDismiss: { print("Dismiss") }
        )
    }
}
