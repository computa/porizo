#!/usr/bin/env swift

//
//  generate-logo-warmcanvas.swift
//  Generates all Porizo logo sizes using the Warm Canvas design.
//
//  Design: Flat coral (#E07850) circle + centered white mic.fill
//  Matches SplashView.swift / DesignTokens.gold exactly.
//
//  Usage: swift generate-logo-warmcanvas.swift
//  Output: AppIcon.png, logo.png, logo@2x.png, apple-touch-icon.png, favicons
//

import Cocoa

// Warm Canvas coral — DesignTokens.gold
let coralColor = NSColor(red: 224/255, green: 120/255, blue: 80/255, alpha: 1.0)  // #E07850

struct LogoSize {
    let size: Int
    let filename: String
}

let sizes: [LogoSize] = [
    LogoSize(size: 1024, filename: "AppIcon.png"),
    LogoSize(size: 1024, filename: "logo@2x.png"),
    LogoSize(size: 512, filename: "logo.png"),
    LogoSize(size: 180, filename: "apple-touch-icon.png"),
    LogoSize(size: 32, filename: "favicon-32.png"),
    LogoSize(size: 16, filename: "favicon-16.png"),
]

func generateLogo(size: Int) -> NSImage? {
    let s = CGFloat(size)
    let image = NSImage(size: NSSize(width: s, height: s))

    image.lockFocus()

    // Flat coral fill — full square (iOS applies its own squircle mask)
    coralColor.setFill()
    NSRect(x: 0, y: 0, width: s, height: s).fill()

    // White mic.fill centered — 40% of circle diameter
    let iconScale: CGFloat = 0.4
    let symbolConfig = NSImage.SymbolConfiguration(pointSize: s * iconScale, weight: .regular)

    if let micImage = NSImage(systemSymbolName: "mic.fill", accessibilityDescription: nil)?
        .withSymbolConfiguration(symbolConfig) {

        let symbolSize = micImage.size
        let x = (s - symbolSize.width) / 2
        let y = (s - symbolSize.height) / 2
        let drawRect = NSRect(x: x, y: y, width: symbolSize.width, height: symbolSize.height)

        let tinted = NSImage(size: micImage.size)
        tinted.lockFocus()
        micImage.draw(at: .zero, from: NSRect(origin: .zero, size: micImage.size), operation: .sourceOver, fraction: 1.0)
        NSColor.white.set()
        NSRect(origin: .zero, size: micImage.size).fill(using: .sourceAtop)
        tinted.unlockFocus()

        tinted.draw(in: drawRect, from: .zero, operation: .sourceOver, fraction: 1.0)
    }

    image.unlockFocus()
    return image
}

func savePNG(_ image: NSImage, to path: String) -> Bool {
    guard let tiffData = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiffData),
          let pngData = bitmap.representation(using: .png, properties: [:]) else {
        print("  Error: Failed to create PNG data for \(path)")
        return false
    }
    do {
        try pngData.write(to: URL(fileURLWithPath: path))
        return true
    } catch {
        print("  Error: \(error)")
        return false
    }
}

// MARK: - Main

print("Generating Porizo Warm Canvas logos...")
print("Color: #E07850 (DesignTokens.gold)")
print("")

var success = 0
var fail = 0

for logoSize in sizes {
    if let image = generateLogo(size: logoSize.size) {
        if savePNG(image, to: logoSize.filename) {
            print("  \(logoSize.filename) (\(logoSize.size)x\(logoSize.size))")
            success += 1
        } else { fail += 1 }
    } else {
        print("  Failed: \(logoSize.filename)")
        fail += 1
    }
}

print("")
print("Done: \(success) generated, \(fail) failed")
