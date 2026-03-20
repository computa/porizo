//
//  SkeletonView.swift
//  PorizoApp
//
//  Skeleton loading placeholders for a polished loading experience.
//  Replaces spinners with content-shaped placeholders that pulse.
//

import SwiftUI

// MARK: - Skeleton Modifier

struct SkeletonModifier: ViewModifier {
    @State private var isAnimating = false

    func body(content: Content) -> some View {
        content
            .opacity(isAnimating ? 0.5 : 1.0)
            .animation(
                .easeInOut(duration: 0.8)
                .repeatForever(autoreverses: true),
                value: isAnimating
            )
            .onAppear {
                isAnimating = true
            }
    }
}

extension View {
    func skeleton() -> some View {
        modifier(SkeletonModifier())
    }
}

// MARK: - Skeleton Shapes

struct SkeletonRectangle: View {
    var width: CGFloat? = nil
    var height: CGFloat = 16
    var cornerRadius: CGFloat = 4

    var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius)
            .fill(DesignTokens.surface)
            .frame(width: width, height: height)
            .skeleton()
    }
}

struct SkeletonCircle: View {
    var size: CGFloat = 40

    var body: some View {
        Circle()
            .fill(DesignTokens.surface)
            .frame(width: size, height: size)
            .skeleton()
    }
}

// MARK: - Song Card Skeleton

struct SongCardSkeleton: View {
    var body: some View {
        HStack(spacing: 12) {
            // Artwork placeholder
            SkeletonRectangle(width: 100, height: 100, cornerRadius: 12)

            // Text placeholders
            VStack(alignment: .leading, spacing: 10) {
                SkeletonRectangle(width: 140, height: 18, cornerRadius: 4)
                SkeletonRectangle(width: 100, height: 14, cornerRadius: 4)
                SkeletonRectangle(width: 80, height: 12, cornerRadius: 4)
            }

            Spacer()
        }
        .padding(12)
        .background(DesignTokens.surface)
        .clipShape(.rect(cornerRadius: 16))
        .cardShadow()
        .accessibilityHidden(true)
    }
}

// MARK: - Featured Song Skeleton

struct FeaturedSongSkeleton: View {
    var body: some View {
        HStack(spacing: 12) {
            // Artwork placeholder
            SkeletonRectangle(width: 100, height: 100, cornerRadius: 12)

            // Text placeholders
            VStack(alignment: .leading, spacing: 10) {
                SkeletonRectangle(width: 120, height: 18, cornerRadius: 4)
                SkeletonRectangle(width: 160, height: 14, cornerRadius: 4)
                SkeletonRectangle(width: 70, height: 12, cornerRadius: 4)
            }

            Spacer()

            // Menu placeholder
            SkeletonCircle(size: 24)
        }
        .padding(12)
        .background(DesignTokens.surface)
        .clipShape(.rect(cornerRadius: 16))
        .cardShadow()
        .accessibilityHidden(true)
    }
}

// MARK: - Occasion Card Skeleton

struct OccasionCardSkeleton: View {
    var body: some View {
        VStack(spacing: 12) {
            SkeletonCircle(size: 44)
            SkeletonRectangle(width: 80, height: 14, cornerRadius: 4)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
        .background(DesignTokens.surface)
        .clipShape(.rect(cornerRadius: 16))
        .subtleShadow()
        .accessibilityHidden(true)
    }
}

// MARK: - Template Card Skeleton

struct TemplateCardSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SkeletonRectangle(width: nil, height: 80, cornerRadius: 10)
            SkeletonRectangle(width: 100, height: 14, cornerRadius: 4)
            SkeletonRectangle(width: 50, height: 18, cornerRadius: 4)
            Spacer()
            SkeletonRectangle(width: 90, height: 14, cornerRadius: 4)
        }
        .frame(width: 150, height: 200)
        .padding()
        .background(DesignTokens.surface)
        .clipShape(.rect(cornerRadius: 16))
        .subtleShadow()
        .accessibilityHidden(true)
    }
}

// MARK: - List Skeleton Views

struct MySongsSkeletonView: View {
    var body: some View {
        ScrollView {
            LazyVStack(spacing: 16) {
                ForEach(0..<4, id: \.self) { _ in
                    SongCardSkeleton()
                }
            }
            .padding()
        }
        .accessibilityLabel("Loading songs")
    }
}

struct ExploreSkeletonView: View {
    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                // Fresh Hits Section
                sectionHeaderSkeleton
                VStack(spacing: 16) {
                    ForEach(0..<3, id: \.self) { _ in
                        FeaturedSongSkeleton()
                    }
                }
                .padding(.horizontal)

                // Occasions Section
                sectionHeaderSkeleton
                LazyVGrid(columns: [
                    GridItem(.flexible()),
                    GridItem(.flexible())
                ], spacing: 16) {
                    ForEach(0..<4, id: \.self) { _ in
                        OccasionCardSkeleton()
                    }
                }
                .padding(.horizontal)
            }
            .padding(.top, 20)
        }
        .accessibilityLabel("Loading explore content")
    }

    private var sectionHeaderSkeleton: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                SkeletonRectangle(width: 100, height: 16, cornerRadius: 4)
                SkeletonRectangle(width: 140, height: 12, cornerRadius: 4)
            }
            Spacer()
            SkeletonRectangle(width: 50, height: 14, cornerRadius: 4)
        }
        .padding(.horizontal)
    }
}

#Preview("Song Card Skeleton") {
    VStack(spacing: 16) {
        SongCardSkeleton()
        SongCardSkeleton()
    }
    .padding()
    .background(DesignTokens.surface)
}

#Preview("My Songs Skeleton") {
    MySongsSkeletonView()
        .background(DesignTokens.surface)
}

#Preview("Explore Skeleton") {
    ExploreSkeletonView()
        .background(DesignTokens.surface)
}
