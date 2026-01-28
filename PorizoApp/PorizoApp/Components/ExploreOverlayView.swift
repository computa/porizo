//
//  ExploreOverlayView.swift
//  PorizoApp
//
//  First-run welcome modal matching v1.pen "06 - Explore" Modal Overlay.
//  Shows "Create your first song!" to onboard new users.
//  Velvet & Gold design system.
//

import SwiftUI

// MARK: - Explore Overlay View

struct ExploreOverlayView: View {
    let onCreateNow: () -> Void
    let onDismiss: () -> Void

    /// Current page for pagination dots (future use for multi-page onboarding)
    @State private var currentPage: Int = 0
    private let totalPages: Int = 2

    var body: some View {
        ZStack {
            // Dimmed background (v1.pen: #00000099)
            Color.black.opacity(0.6)
                .ignoresSafeArea()
                .onTapGesture {
                    onDismiss()
                }

            // Modal Card (v1.pen: gold gradient, cornerRadius 24)
            modalCard
                .padding(32)
        }
    }

    // MARK: - Modal Card

    private var modalCard: some View {
        VStack(spacing: 16) {
            // Close button row (v1.pen: aligned right)
            HStack {
                Spacer()

                Button {
                    onDismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 16))
                        .foregroundColor(.white)
                        .frame(width: 32, height: 32)
                        .background(Color.black.opacity(0.2))
                        .clipShape(Circle())
                }
            }

            // Illustration (v1.pen: 180x180 circle image)
            illustrationView

            // Title (v1.pen: Playfair Display 28pt)
            Text("Create your first song!")
                .font(DesignTokens.displayFont(size: 28))
                .foregroundColor(.white)
                .multilineTextAlignment(.center)

            // Description (v1.pen: Inter 15pt, white 80%)
            Text("Every song starts somewhere — write, record, or upload a sound to begin.")
                .font(DesignTokens.bodyFont(size: 15))
                .foregroundColor(.white.opacity(0.8))
                .multilineTextAlignment(.center)
                .lineSpacing(4)

            // Create Button (v1.pen: gold background, dark text)
            Button {
                onCreateNow()
            } label: {
                Text("Create now")
                    .font(DesignTokens.bodyFont(size: 16, weight: .semibold))
                    .foregroundColor(DesignTokens.background)
                    .padding(.horizontal, 32)
                    .frame(height: 48)
                    .background(DesignTokens.gold)
                    .cornerRadius(24)
            }

            // Pagination Dots (v1.pen: 2 dots, first gold, second faded)
            paginationDots
                .padding(.top, 8)
        }
        .padding(.horizontal, 24)
        .padding(.top, 24)
        .padding(.bottom, 32)
        .background(goldGradient)
        .cornerRadius(24)
    }

    // MARK: - Illustration

    private var illustrationView: some View {
        ZStack {
            Circle()
                .fill(Color.white.opacity(0.1))

            // Musical note icon as placeholder for illustration
            Image(systemName: "music.note")
                .font(.system(size: 60))
                .foregroundColor(.white.opacity(0.8))
        }
        .frame(width: 180, height: 180)
    }

    // MARK: - Pagination Dots

    private var paginationDots: some View {
        HStack(spacing: 8) {
            ForEach(0..<totalPages, id: \.self) { page in
                Circle()
                    .fill(page == currentPage ? DesignTokens.gold : DesignTokens.gold.opacity(0.4))
                    .frame(width: 8, height: 8)
            }
        }
    }

    // MARK: - Gold Gradient (v1.pen: linear gradient from #D4A574 to #8B7355)

    private var goldGradient: some ShapeStyle {
        LinearGradient(
            colors: [
                Color(hex: "#D4A574"),
                Color(hex: "#B8956A"),
                Color(hex: "#8B7355")
            ],
            startPoint: .top,
            endPoint: .bottom
        )
    }
}

// MARK: - Preview

#Preview {
    ZStack {
        Color(hex: "#0A0A0A")
            .ignoresSafeArea()

        ExploreOverlayView(
            onCreateNow: { },
            onDismiss: { }
        )
    }
}
