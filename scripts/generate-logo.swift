#!/usr/bin/env swift

//
//  generate-logo.swift
//  Regenerates derivative logo assets from the shipped B4 app icon.
//
//  Usage: swift generate-logo.swift
//  Output: AppIcon.png, logo.png, logo@2x.png, apple-touch-icon.png, favicons
//

import Cocoa

struct LogoSize {
    let size: Int
    let filename: String
}

let outputSizes: [LogoSize] = [
    LogoSize(size: 1024, filename: "AppIcon.png"),
    LogoSize(size: 1024, filename: "logo@2x.png"),
    LogoSize(size: 512, filename: "logo.png"),
    LogoSize(size: 180, filename: "apple-touch-icon.png"),
    LogoSize(size: 32, filename: "favicon-32.png"),
    LogoSize(size: 16, filename: "favicon-16.png"),
]

let scriptURL = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath()
let scriptDirectory = scriptURL.deletingLastPathComponent()
let sourceIconURL = scriptDirectory
    .appendingPathComponent("../PorizoApp/PorizoApp/Assets.xcassets/AppIcon.appiconset/AppIcon.png")
    .standardizedFileURL

func resizedImage(from image: NSImage, size: Int) -> NSImage {
    let targetSize = NSSize(width: size, height: size)
    let result = NSImage(size: targetSize)
    result.lockFocus()
    NSGraphicsContext.current?.imageInterpolation = .high
    image.draw(in: NSRect(origin: .zero, size: targetSize))
    result.unlockFocus()
    return result
}

func savePNG(_ image: NSImage, to url: URL) throws {
    guard let tiffData = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiffData),
          let pngData = bitmap.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "generate-logo", code: 1, userInfo: [NSLocalizedDescriptionKey: "Failed to create PNG data"])
    }
    try pngData.write(to: url)
}

guard let sourceImage = NSImage(contentsOf: sourceIconURL) else {
    fputs("Failed to load canonical app icon at \(sourceIconURL.path)\n", stderr)
    exit(1)
}

print("Generating derivative logo assets from canonical B4 icon...")
print("Source: \(sourceIconURL.path)")
print("")

var successCount = 0
var failCount = 0

for output in outputSizes {
    let destinationURL = scriptDirectory.appendingPathComponent(output.filename)
    do {
        try savePNG(resizedImage(from: sourceImage, size: output.size), to: destinationURL)
        print("✓ Generated \(output.filename) (\(output.size)x\(output.size))")
        successCount += 1
    } catch {
        print("✗ Failed \(output.filename): \(error.localizedDescription)")
        failCount += 1
    }
}

print("")
print("Done: \(successCount) generated, \(failCount) failed")
