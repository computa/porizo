// swift-tools-version: 5.9
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "StoryCollectionKit",
    platforms: [
        .iOS(.v17),
        .macOS(.v14)
    ],
    products: [
        .library(
            name: "StoryCollectionKit",
            targets: ["StoryCollectionKit"]
        ),
    ],
    dependencies: [],
    targets: [
        .target(
            name: "StoryCollectionKit",
            dependencies: [],
            path: "Sources/StoryCollectionKit"
        ),
        .testTarget(
            name: "StoryCollectionKitTests",
            dependencies: ["StoryCollectionKit"],
            path: "Tests/StoryCollectionKitTests"
        ),
    ]
)
