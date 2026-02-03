//
//  SongCoverView.swift
//  PorizoApp
//
//  Displays song cover art with remote image loading and graceful fallback.
//  Uses occasion-based gradient as placeholder while loading or when URL is nil.
//

import SwiftUI

/// Reusable song cover view that loads remote cover images with caching
struct SongCoverView: View {
    let occasion: String?
    let smallUrl: String?
    let largeUrl: String?
    let size: CGFloat

    /// Use small URL for sizes <= 128pt, large URL otherwise
    private var imageUrl: URL? {
        let urlString = size <= 128 ? (smallUrl ?? largeUrl) : (largeUrl ?? smallUrl)
        guard let urlString = urlString else { return nil }
        return URL(string: urlString)
    }

    var body: some View {
        Group {
            if let url = imageUrl {
                AsyncImage(url: url, transaction: Transaction(animation: .easeIn(duration: 0.2))) { phase in
                    switch phase {
                    case .empty:
                        placeholderView
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                    case .failure:
                        placeholderView
                    @unknown default:
                        placeholderView
                    }
                }
            } else {
                placeholderView
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
    }

    /// Corner radius scales with size
    private var cornerRadius: CGFloat {
        if size <= 56 { return 8 }
        if size <= 128 { return 12 }
        return 20
    }

    /// Fallback gradient placeholder with occasion icon
    private var placeholderView: some View {
        ZStack {
            RoundedRectangle(cornerRadius: cornerRadius)
                .fill(occasionGradient(for: occasion))

            Image(systemName: occasionIcon(for: occasion))
                .font(.system(size: iconSize))
                .foregroundColor(.white.opacity(0.8))
        }
        .frame(width: size, height: size)
    }

    /// Icon size scales with view size
    private var iconSize: CGFloat {
        if size <= 56 { return 24 }
        if size <= 128 { return 48 }
        return 80
    }
}

// MARK: - Convenience Initializers

extension SongCoverView {
    /// Initialize from a Track
    init(track: Track, size: CGFloat) {
        self.occasion = track.occasion
        self.smallUrl = track.coverImageSmallUrl
        self.largeUrl = track.coverImageLargeUrl ?? track.coverImageUrl
        self.size = size
    }

    /// Initialize from a TrackVersion with occasion
    init(version: TrackVersion, occasion: String?, size: CGFloat) {
        self.occasion = occasion
        self.smallUrl = version.coverImageSmallUrl
        self.largeUrl = version.coverImageLargeUrl ?? version.coverImageUrl
        self.size = size
    }
}

// MARK: - Preview

#Preview("Small (56pt)") {
    SongCoverView(
        occasion: "birthday",
        smallUrl: nil,
        largeUrl: nil,
        size: 56
    )
}

#Preview("Large (280pt)") {
    SongCoverView(
        occasion: "anniversary",
        smallUrl: nil,
        largeUrl: nil,
        size: 280
    )
}
