#!/usr/bin/env swift

//
//  generate-logo.swift
//  Generates Porizo logo (mic on rose circle) at multiple sizes.
//
//  Usage: swift generate-logo.swift
//  Output: Creates PNG files in current directory
//
//  Design: White mic.fill SF Symbol centered on rose (#f43f5e) circle
//  The mic scales to 40% of the circle diameter for visual balance.
//

import Cocoa

// MARK: - Configuration

let roseColor = NSColor(red: 244/255, green: 63/255, blue: 94/255, alpha: 1.0) // #f43f5e

struct LogoSize {
    let size: Int
    let filename: String
    let iconScale: CGFloat // How much of the circle the icon should fill (0.4 = 40%)

    init(size: Int, filename: String, iconScale: CGFloat = 0.4) {
        self.size = size
        self.filename = filename
        self.iconScale = iconScale
    }
}

let sizes: [LogoSize] = [
    LogoSize(size: 1024, filename: "AppIcon.png"),
    LogoSize(size: 1024, filename: "logo@2x.png"),
    LogoSize(size: 512, filename: "logo.png"),
    LogoSize(size: 180, filename: "apple-touch-icon.png"),  // iOS home screen
    LogoSize(size: 32, filename: "favicon-32.png"),
    LogoSize(size: 16, filename: "favicon-16.png"),
]

// MARK: - Logo Generation

func generateLogo(size: Int, iconScale: CGFloat) -> NSImage? {
    let imageSize = NSSize(width: size, height: size)
    let image = NSImage(size: imageSize)

    image.lockFocus()

    // Draw rose circle (full canvas, no margin - perfect circle)
    let circleRect = NSRect(x: 0, y: 0, width: size, height: size)
    let circlePath = NSBezierPath(ovalIn: circleRect)
    roseColor.setFill()
    circlePath.fill()

    // Draw mic SF Symbol centered
    // Use SF Symbols with a configuration for the right weight
    let symbolConfig = NSImage.SymbolConfiguration(pointSize: CGFloat(size) * iconScale, weight: .regular)

    if let micImage = NSImage(systemSymbolName: "mic.fill", accessibilityDescription: nil)?
        .withSymbolConfiguration(symbolConfig) {

        // Get the symbol's actual size
        let symbolSize = micImage.size

        // Center the symbol in the circle
        let x = (CGFloat(size) - symbolSize.width) / 2
        let y = (CGFloat(size) - symbolSize.height) / 2
        let drawRect = NSRect(x: x, y: y, width: symbolSize.width, height: symbolSize.height)

        // Draw the symbol in white
        NSColor.white.set()
        micImage.draw(in: drawRect, from: .zero, operation: .sourceOver, fraction: 1.0)

        // The symbol draws in its template color, so we need to tint it
        // Draw a white-filled version
        if let tintedImage = tintImage(micImage, with: .white) {
            tintedImage.draw(in: drawRect, from: .zero, operation: .sourceOver, fraction: 1.0)
        }
    }

    image.unlockFocus()
    return image
}

func tintImage(_ image: NSImage, with color: NSColor) -> NSImage? {
    let tinted = NSImage(size: image.size)
    tinted.lockFocus()

    // Draw the image
    image.draw(at: .zero, from: NSRect(origin: .zero, size: image.size), operation: .sourceOver, fraction: 1.0)

    // Apply tint
    color.set()
    NSRect(origin: .zero, size: image.size).fill(using: .sourceAtop)

    tinted.unlockFocus()
    return tinted
}

func savePNG(_ image: NSImage, to path: String) -> Bool {
    guard let tiffData = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiffData),
          let pngData = bitmap.representation(using: .png, properties: [:]) else {
        print("Error: Failed to create PNG data for \(path)")
        return false
    }

    do {
        try pngData.write(to: URL(fileURLWithPath: path))
        return true
    } catch {
        print("Error: Failed to write \(path): \(error)")
        return false
    }
}

// MARK: - Main

print("Generating Porizo logos...")
print("Rose color: #f43f5e")
print("")

var successCount = 0
var failCount = 0

for logoSize in sizes {
    if let image = generateLogo(size: logoSize.size, iconScale: logoSize.iconScale) {
        if savePNG(image, to: logoSize.filename) {
            print("✓ Generated \(logoSize.filename) (\(logoSize.size)x\(logoSize.size))")
            successCount += 1
        } else {
            failCount += 1
        }
    } else {
        print("✗ Failed to generate \(logoSize.filename)")
        failCount += 1
    }
}

print("")
print("Done: \(successCount) generated, \(failCount) failed")

if successCount > 0 {
    print("")
    print("Next steps:")
    print("  1. Copy AppIcon.png to PorizoApp/PorizoApp/Assets.xcassets/AppIcon.appiconset/")
    print("  2. Use favicon-*.png for web favicon")
    print("  3. Use logo.png / logo@2x.png for marketing")
}
