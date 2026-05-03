#!/usr/bin/env swift

//
//  generate-social-warmcanvas.swift
//  Renders Warm Canvas social profile assets (FB / IG / TikTok).
//
//  Usage: swift scripts/generate-social-warmcanvas.swift
//  Output: marketing/social/warmcanvas/{avatar,fb-cover,ig-pinned,tiktok-cover}.png
//

import SwiftUI
import AppKit

// ──────────── Warm Canvas palette ────────────
extension Color {
    static let canvasBg     = Color(red: 255/255, green: 248/255, blue: 240/255)  // #FFF8F0
    static let canvasDark   = Color(red:  26/255, green:   8/255, blue:   0/255)  // #1A0800
    static let canvasAccent = Color(red: 192/255, green:  88/255, blue:  42/255)  // #C0582A
    static let canvasGold   = Color(red: 224/255, green: 122/255, blue:  75/255)  // #E07A4B
}

// ──────────── Paths ────────────
let scriptDir = URL(fileURLWithPath: CommandLine.arguments[0])
    .resolvingSymlinksInPath()
    .deletingLastPathComponent()
let brandMarkURL = scriptDir
    .appendingPathComponent("../PorizoApp/PorizoApp/Assets.xcassets/AppIcon.appiconset/AppIcon.png")
    .standardizedFileURL
let outDir = scriptDir
    .appendingPathComponent("../marketing/social/warmcanvas")
    .standardizedFileURL

try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

guard let brandMark = NSImage(contentsOf: brandMarkURL) else {
    fputs("Failed to load brand mark at \(brandMarkURL.path)\n", stderr)
    exit(1)
}

// ──────────── Reusable mark view ────────────
struct MarkView: View {
    let image: NSImage
    let side: CGFloat
    var body: some View {
        Image(nsImage: image)
            .resizable()
            .interpolation(.high)
            .scaledToFit()
            .frame(width: side, height: side)
            .clipShape(RoundedRectangle(cornerRadius: side * 0.2237, style: .continuous))
            .shadow(color: Color.canvasGold.opacity(0.30), radius: side * 0.08, x: 0, y: side * 0.02)
    }
}

// ──────────── Avatar (1080×1080) ────────────
struct AvatarView: View {
    let mark: NSImage
    let side: CGFloat = 1080
    var body: some View {
        ZStack {
            Color.canvasBg
            RadialGradient(
                gradient: Gradient(colors: [Color.canvasGold.opacity(0.22), Color.canvasBg.opacity(0)]),
                center: .center,
                startRadius: 0,
                endRadius: side * 0.44
            )
            MarkView(image: mark, side: side * 0.62)
        }
        .frame(width: side, height: side)
    }
}

// ──────────── Facebook cover (1640×859) ────────────
struct FBCoverView: View {
    let mark: NSImage
    let w: CGFloat = 1640
    let h: CGFloat = 859
    var body: some View {
        ZStack {
            Color.canvasBg
            RadialGradient(
                gradient: Gradient(colors: [Color.canvasGold.opacity(0.14), Color.canvasBg.opacity(0)]),
                center: UnitPoint(x: 0.88, y: 0.30),
                startRadius: 0,
                endRadius: w * 0.65
            )
            RadialGradient(
                gradient: Gradient(colors: [Color.canvasAccent.opacity(0.06), Color.canvasBg.opacity(0)]),
                center: UnitPoint(x: 0.12, y: 0.80),
                startRadius: 0,
                endRadius: w * 0.45
            )
            HStack(spacing: 90) {
                MarkView(image: mark, side: h * 0.58)
                VStack(alignment: .leading, spacing: 22) {
                    Text("Porizo")
                        .font(.custom("Didot-Bold", size: 180))
                        .foregroundStyle(Color.canvasDark)
                        .tracking(-2)
                    Text("Your moment, in a song.")
                        .font(.system(size: 58, weight: .regular, design: .default))
                        .foregroundStyle(Color.canvasAccent)
                        .tracking(0.5)
                }
                Spacer(minLength: 0)
            }
            .padding(.leading, 150)
            .padding(.trailing, 80)
        }
        .frame(width: w, height: h)
    }
}

// ──────────── Instagram pinned square (1080×1080) ────────────
struct IGPinnedView: View {
    let mark: NSImage
    let side: CGFloat = 1080
    var body: some View {
        ZStack {
            Color.canvasBg
            RadialGradient(
                gradient: Gradient(colors: [Color.canvasGold.opacity(0.18), Color.canvasBg.opacity(0)]),
                center: UnitPoint(x: 0.5, y: 0.62),
                startRadius: 0,
                endRadius: side * 0.70
            )
            VStack(spacing: 56) {
                Spacer(minLength: 0)
                MarkView(image: mark, side: side * 0.42)
                VStack(spacing: 22) {
                    Text("Porizo")
                        .font(.custom("Didot-Bold", size: 150))
                        .foregroundStyle(Color.canvasDark)
                        .tracking(-1.5)
                    Text("Your moment, in a song.")
                        .font(.system(size: 48, weight: .regular, design: .default))
                        .foregroundStyle(Color.canvasAccent)
                        .tracking(0.4)
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 120)
        }
        .frame(width: side, height: side)
    }
}

// ──────────── TikTok vertical (1080×1920) ────────────
// Composition biased to upper half — TikTok UI overlays bottom ~35% with caption, buttons, username.
struct TikTokView: View {
    let mark: NSImage
    let w: CGFloat = 1080
    let h: CGFloat = 1920
    var body: some View {
        ZStack {
            Color.canvasBg
            RadialGradient(
                gradient: Gradient(colors: [Color.canvasGold.opacity(0.20), Color.canvasBg.opacity(0)]),
                center: UnitPoint(x: 0.5, y: 0.38),
                startRadius: 0,
                endRadius: w * 0.95
            )
            VStack(spacing: 64) {
                Spacer().frame(height: h * 0.12)
                MarkView(image: mark, side: w * 0.52)
                VStack(spacing: 30) {
                    Text("Porizo")
                        .font(.custom("Didot-Bold", size: 200))
                        .foregroundStyle(Color.canvasDark)
                        .tracking(-2)
                    Text("Your moment, in a song.")
                        .font(.system(size: 62, weight: .regular, design: .default))
                        .foregroundStyle(Color.canvasAccent)
                        .tracking(0.5)
                }
                Spacer()
            }
        }
        .frame(width: w, height: h)
    }
}

// ──────────── Render helper ────────────
@MainActor
func render<V: View>(_ view: V, width: CGFloat, height: CGFloat, filename: String) {
    let renderer = ImageRenderer(content: view)
    renderer.scale = 1.0
    renderer.proposedSize = ProposedViewSize(width: width, height: height)

    guard let cgImage = renderer.cgImage else {
        fputs("  \(filename): render failed\n", stderr)
        return
    }

    let rep = NSBitmapImageRep(cgImage: cgImage)
    guard let pngData = rep.representation(using: .png, properties: [:]) else {
        fputs("  \(filename): PNG encoding failed\n", stderr)
        return
    }

    let url = outDir.appendingPathComponent(filename)
    do {
        try pngData.write(to: url)
        print("  \(filename)  (\(Int(width))×\(Int(height)),  \(pngData.count / 1024) KB)")
    } catch {
        fputs("  \(filename): write failed — \(error)\n", stderr)
    }
}

// ──────────── Main ────────────
print("Generating Porizo Warm Canvas social profile assets...")
print("Source: \(brandMarkURL.path)")
print("Output: \(outDir.path)")
print("")

Task { @MainActor in
    render(AvatarView(mark: brandMark),   width: 1080, height: 1080, filename: "avatar.png")
    render(FBCoverView(mark: brandMark),  width: 1640, height:  859, filename: "fb-cover.png")
    render(IGPinnedView(mark: brandMark), width: 1080, height: 1080, filename: "ig-pinned.png")
    render(TikTokView(mark: brandMark),   width: 1080, height: 1920, filename: "tiktok-cover.png")
    print("\nDone.")
    exit(0)
}

RunLoop.main.run()
