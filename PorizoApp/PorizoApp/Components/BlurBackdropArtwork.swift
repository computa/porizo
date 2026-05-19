import SwiftUI

/// Square artwork composed in front of a blurred-and-dimmed copy of itself.
/// Fills any container aspect (portrait, landscape, square) without cropping
/// the foreground subject; the backdrop fills the remaining space with mood.
///
/// Matches the spec for the song-Reveal surface (§9.1) and is reusable wherever
/// a square artwork needs to fill a non-square container without losing detail.
struct BlurBackdropArtwork: View {
    /// URL of the canonical 2048² square artwork JPEG.
    let artworkURL: URL?
    /// Padding around the foreground artwork inside its container.
    var foregroundHorizontalPadding: CGFloat = 24
    /// Bottom inset for the foreground (leaves room for title text overlay).
    var foregroundBottomPadding: CGFloat = 200
    /// Blur radius applied to the backdrop layer.
    var backdropBlurRadius: CGFloat = 50
    /// Opacity of the black dim layer over the blurred backdrop.
    var backdropDimOpacity: Double = 0.30

    var body: some View {
        ZStack {
            // Layer 1 — Backdrop: blurred, dimmed copy filling the container.
            AsyncImage(url: artworkURL) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFill()
                        .blur(radius: backdropBlurRadius)
                        .overlay(Color.black.opacity(backdropDimOpacity))
                        .ignoresSafeArea()
                default:
                    Color.black.ignoresSafeArea()
                }
            }

            // Layer 2 — Foreground: unmodified square artwork.
            AsyncImage(url: artworkURL) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFit()
                        .padding(.horizontal, foregroundHorizontalPadding)
                        .padding(.bottom, foregroundBottomPadding)
                case .empty:
                    ProgressView()
                case .failure:
                    EmptyView()
                @unknown default:
                    EmptyView()
                }
            }
        }
    }
}

#Preview {
    BlurBackdropArtwork(
        artworkURL: URL(string: "https://example.com/sample-bouquet.jpg")
    )
}
