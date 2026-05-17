//
//  NowPlayingManager.swift
//  PorizoApp
//
//  Handles lock-screen Now Playing metadata and remote transport controls.
//

import AVFoundation
import CryptoKit
import Foundation
import MediaPlayer
import UIKit

struct NowPlayingMetadata {
    let title: String
    let artist: String?
    let artwork: UIImage?
    let artworkURL: URL?

    init(title: String, artist: String? = nil, artwork: UIImage? = nil, artworkURL: URL? = nil) {
        self.title = title
        self.artist = artist
        self.artwork = artwork
        self.artworkURL = artworkURL
    }

    init(title: String, artist: String? = nil, artworkURLString: String?) {
        self.title = title
        self.artist = artist
        self.artwork = nil
        self.artworkURL = artworkURLString.flatMap(URL.init(string:))
    }
}

@MainActor
final class NowPlayingManager {
    static let shared = NowPlayingManager()

    private var isConfigured = false
    private var onPlay: (() -> Void)?
    private var onPause: (() -> Void)?
    private var onToggle: (() -> Void)?
    private var onSeek: ((Double) -> Void)?
    private var artworkTask: Task<Void, Never>?
    private var activeArtworkURL: URL?
    private var artworkCache: [URL: UIImage] = [:]
    private weak var activeSession: MPNowPlayingSession?

    private init() {}

    func configureRemoteCommands(
        onPlay: @escaping () -> Void,
        onPause: @escaping () -> Void,
        onToggle: @escaping () -> Void,
        onSeek: @escaping (Double) -> Void
    ) {
        self.onPlay = onPlay
        self.onPause = onPause
        self.onToggle = onToggle
        self.onSeek = onSeek

        guard !isConfigured else { return }
        isConfigured = true

        let commandCenter = MPRemoteCommandCenter.shared()
        commandCenter.playCommand.isEnabled = true
        commandCenter.pauseCommand.isEnabled = true
        commandCenter.togglePlayPauseCommand.isEnabled = true
        commandCenter.changePlaybackPositionCommand.isEnabled = true
        UIApplication.shared.beginReceivingRemoteControlEvents()

        commandCenter.playCommand.addTarget { [weak self] _ in
            self?.onPlay?()
            return .success
        }
        commandCenter.pauseCommand.addTarget { [weak self] _ in
            self?.onPause?()
            return .success
        }
        commandCenter.togglePlayPauseCommand.addTarget { [weak self] _ in
            self?.onToggle?()
            return .success
        }
        commandCenter.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else {
                return .commandFailed
            }
            self?.onSeek?(event.positionTime)
            return .success
        }
    }

    func activateSession(_ session: MPNowPlayingSession) {
        activeSession = session
        session.automaticallyPublishesNowPlayingInfo = false
        syncActiveSession()
        session.becomeActiveIfPossible { didBecomeActive in
            #if DEBUG
            print("[NowPlayingManager] MPNowPlayingSession active=\(didBecomeActive)")
            #endif
        }
    }

    func deactivateSession(_ session: MPNowPlayingSession) {
        guard activeSession === session else { return }
        activeSession = nil
    }

    func updateMetadata(_ metadata: NowPlayingMetadata, duration: Double? = nil) {
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPMediaItemPropertyTitle] = metadata.title
        if let artist = metadata.artist {
            info[MPMediaItemPropertyArtist] = artist
            // Some iOS lockscreen presentations key off albumTitle. Reusing the
            // artist string ("For Chioma") keeps the metadata bundle complete
            // without inventing a fake album name.
            info[MPMediaItemPropertyAlbumTitle] = artist
        }
        info[MPMediaItemPropertyAlbumArtist] = "Porizo"
        // Tell the system this is on-demand music, not a live stream — this is
        // what iOS uses to decide whether to offer the rich lockscreen treatment
        // (ambient album-art background on iOS 18+, expanded NowPlaying card).
        info[MPNowPlayingInfoPropertyMediaType] = MPNowPlayingInfoMediaType.audio.rawValue
        info[MPNowPlayingInfoPropertyIsLiveStream] = false
        if let duration {
            info[MPMediaItemPropertyPlaybackDuration] = duration
        }
        applyArtwork(from: metadata, to: &info)
        publish(info)
    }

    func updatePlaybackState(isPlaying: Bool, elapsed: Double, duration: Double? = nil) {
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = elapsed
        if let duration {
            info[MPMediaItemPropertyPlaybackDuration] = duration
        }
        info[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? 1.0 : 0.0
        publish(info)
        publishPlaybackState(isPlaying ? .playing : .paused)
    }

    func clear() {
        artworkTask?.cancel()
        artworkTask = nil
        activeArtworkURL = nil
        publishPlaybackState(.stopped)
        publish(nil)
    }

    private func publish(_ info: [String: Any]?) {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        activeSession?.nowPlayingInfoCenter.nowPlayingInfo = info
    }

    private func publishPlaybackState(_ state: MPNowPlayingPlaybackState) {
        MPNowPlayingInfoCenter.default().playbackState = state
        activeSession?.nowPlayingInfoCenter.playbackState = state
    }

    private func syncActiveSession() {
        activeSession?.nowPlayingInfoCenter.nowPlayingInfo = MPNowPlayingInfoCenter.default().nowPlayingInfo
        activeSession?.nowPlayingInfoCenter.playbackState = MPNowPlayingInfoCenter.default().playbackState
    }

    private func applyArtwork(from metadata: NowPlayingMetadata, to info: inout [String: Any]) {
        if let image = metadata.artwork {
            artworkTask?.cancel()
            artworkTask = nil
            activeArtworkURL = metadata.artworkURL
            setArtworkImage(image, sourceURL: metadata.artworkURL, in: &info)
            return
        }

        guard let url = metadata.artworkURL else {
            artworkTask?.cancel()
            artworkTask = nil
            activeArtworkURL = nil
            clearArtwork(in: &info)
            return
        }

        if let cached = artworkCache[url] {
            activeArtworkURL = url
            setArtworkImage(cached, sourceURL: url, in: &info)
            return
        }

        if activeArtworkURL != url {
            artworkTask?.cancel()
            activeArtworkURL = url
            clearArtwork(in: &info)
            fetchArtwork(from: url)
        }
    }

    private func setArtworkImage(_ artworkImage: UIImage, sourceURL: URL?, in info: inout [String: Any]) {
        // Honor the requested boundsSize by re-rendering: iOS asks for different
        // sizes for the compact tile and the expanded lock-screen presentation.
        let artwork = MPMediaItemArtwork(boundsSize: artworkImage.size) { requested in
            guard requested.width > 0, requested.height > 0 else { return artworkImage }
            return NowPlayingArtworkRenderer.previewImage(
                from: artworkImage,
                size: requested,
                aspect: .custom(requested.width / requested.height)
            )
        }
        info[MPMediaItemPropertyArtwork] = artwork
        setAnimatedArtworkImage(artworkImage, sourceURL: sourceURL, in: &info)
    }

    private func clearArtwork(in info: inout [String: Any]) {
        info.removeValue(forKey: MPMediaItemPropertyArtwork)
        if #available(iOS 19.0, *) {
            info.removeValue(forKey: MPNowPlayingInfoProperty1x1AnimatedArtwork)
            info.removeValue(forKey: MPNowPlayingInfoProperty3x4AnimatedArtwork)
        }
    }

    private func setAnimatedArtworkImage(_ artworkImage: UIImage, sourceURL: URL?, in info: inout [String: Any]) {
        guard #available(iOS 19.0, *) else { return }

        let supportedKeys = Set(MPNowPlayingInfoCenter.supportedAnimatedArtworkKeys)
        if supportedKeys.contains(MPNowPlayingInfoProperty3x4AnimatedArtwork) {
            info[MPNowPlayingInfoProperty3x4AnimatedArtwork] = makeAnimatedArtwork(
                image: artworkImage,
                sourceURL: sourceURL,
                aspect: .portrait3x4
            )
        }
        if supportedKeys.contains(MPNowPlayingInfoProperty1x1AnimatedArtwork) {
            info[MPNowPlayingInfoProperty1x1AnimatedArtwork] = makeAnimatedArtwork(
                image: artworkImage,
                sourceURL: sourceURL,
                aspect: .square
            )
        }
    }

    @available(iOS 19.0, *)
    private func makeAnimatedArtwork(
        image: UIImage,
        sourceURL: URL?,
        aspect: NowPlayingArtworkAspect
    ) -> MPMediaItemAnimatedArtwork {
        let artworkID = NowPlayingAnimatedArtworkCache.artworkID(
            sourceURL: sourceURL,
            image: image,
            aspect: aspect
        )

        return MPMediaItemAnimatedArtwork(
            artworkID: artworkID,
            previewImageRequestHandler: { size, completion in
                let targetSize = NowPlayingAnimatedArtworkCache.targetSize(for: size, aspect: aspect)
                let preview = NowPlayingArtworkRenderer.previewImage(
                    from: image,
                    size: targetSize,
                    aspect: aspect
                )
                completion(preview)
            },
            videoAssetFileURLRequestHandler: { size, completion in
                NowPlayingAnimatedArtworkCache.shared.videoURL(
                    for: image,
                    sourceURL: sourceURL,
                    aspect: aspect,
                    requestedSize: size,
                    completion: completion
                )
            }
        )
    }

    private func fetchArtwork(from url: URL) {
        artworkTask = Task {
            do {
                var request = URLRequest(url: url)
                request.cachePolicy = .returnCacheDataElseLoad
                request.timeoutInterval = 10
                let (data, _) = try await URLSession.shared.data(for: request)
                if Task.isCancelled { return }
                guard let image = UIImage(data: data) else { return }
                await MainActor.run {
                    guard self.activeArtworkURL == url else { return }
                    self.artworkCache[url] = image
                    var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
                    self.setArtworkImage(image, sourceURL: url, in: &info)
                    self.publish(info)
                }
            } catch {
                // Keep title/artist controls alive if artwork cannot be fetched.
            }
        }
    }
}

private enum NowPlayingArtworkAspect: Hashable {
    case square
    case portrait3x4
    case custom(CGFloat)

    var id: String {
        switch self {
        case .square:
            return "1x1"
        case .portrait3x4:
            return "3x4"
        case .custom(let ratio):
            return "custom-\(Int((ratio * 1000).rounded()))"
        }
    }

    var widthToHeight: CGFloat {
        switch self {
        case .square:
            return 1
        case .portrait3x4:
            return 3.0 / 4.0
        case .custom(let ratio):
            return max(ratio, 0.1)
        }
    }
}

private enum NowPlayingArtworkRenderer {
    static func previewImage(from image: UIImage, size: CGSize, aspect: NowPlayingArtworkAspect) -> UIImage {
        let targetSize = NowPlayingAnimatedArtworkCache.targetSize(for: size, aspect: aspect)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(size: targetSize, format: format)
        return renderer.image { context in
            UIColor.black.setFill()
            context.fill(CGRect(origin: .zero, size: targetSize))
            image.draw(in: aspectFillRect(sourceSize: image.size, targetSize: targetSize))
        }
    }

    static func normalizedCGImage(from image: UIImage) -> CGImage? {
        if image.imageOrientation == .up, let cgImage = image.cgImage {
            return cgImage
        }
        return previewImage(from: image, size: image.size, aspect: .custom(image.size.width / max(image.size.height, 1))).cgImage
    }

    static func draw(
        cgImage: CGImage,
        into pixelBuffer: CVPixelBuffer,
        targetSize: CGSize,
        frameIndex: Int,
        frameCount: Int
    ) {
        CVPixelBufferLockBaseAddress(pixelBuffer, [])
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, []) }

        guard let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer) else { return }
        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)
        let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let bitmapInfo = CGImageAlphaInfo.premultipliedFirst.rawValue
            | CGBitmapInfo.byteOrder32Little.rawValue

        guard let context = CGContext(
            data: baseAddress,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: bytesPerRow,
            space: colorSpace,
            bitmapInfo: bitmapInfo
        ) else {
            return
        }

        let targetRect = CGRect(origin: .zero, size: targetSize)
        context.setFillColor(UIColor.black.cgColor)
        context.fill(targetRect)
        context.interpolationQuality = .high

        context.translateBy(x: 0, y: targetSize.height)
        context.scaleBy(x: 1, y: -1)

        let imageSize = CGSize(width: cgImage.width, height: cgImage.height)
        let progress = frameCount > 1 ? CGFloat(frameIndex) / CGFloat(frameCount - 1) : 0
        let zoom = 1.04 + 0.045 * sin(progress * .pi)
        let pan = sin(progress * .pi * 2) * min(targetSize.width, targetSize.height) * 0.018
        var drawRect = aspectFillRect(sourceSize: imageSize, targetSize: targetSize)
        drawRect = drawRect.insetBy(
            dx: -drawRect.width * (zoom - 1) / 2,
            dy: -drawRect.height * (zoom - 1) / 2
        )
        drawRect = drawRect.offsetBy(dx: pan, dy: 0)
        context.draw(cgImage, in: drawRect)
    }

    private static func aspectFillRect(sourceSize: CGSize, targetSize: CGSize) -> CGRect {
        guard sourceSize.width > 0, sourceSize.height > 0 else {
            return CGRect(origin: .zero, size: targetSize)
        }
        let scale = max(targetSize.width / sourceSize.width, targetSize.height / sourceSize.height)
        let scaledSize = CGSize(width: sourceSize.width * scale, height: sourceSize.height * scale)
        return CGRect(
            x: (targetSize.width - scaledSize.width) / 2,
            y: (targetSize.height - scaledSize.height) / 2,
            width: scaledSize.width,
            height: scaledSize.height
        )
    }
}

private final class NowPlayingAnimatedArtworkCache {
    static let shared = NowPlayingAnimatedArtworkCache()

    private let queue = DispatchQueue(label: "app.porizo.now-playing-animated-artwork")
    private let fileManager = FileManager.default
    private var inMemoryURLs: [String: URL] = [:]

    private lazy var cacheDirectory: URL = {
        let root = fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
        return root.appendingPathComponent("NowPlayingAnimatedArtwork", isDirectory: true)
    }()

    static func artworkID(sourceURL: URL?, image: UIImage, aspect: NowPlayingArtworkAspect) -> String {
        let source = sourceURL?.absoluteString
            ?? "embedded-\(Int(image.size.width.rounded()))x\(Int(image.size.height.rounded()))-\(image.scale)"
        let hash = SHA256.hash(data: Data("\(source)-\(aspect.id)".utf8))
            .map { String(format: "%02x", $0) }
            .joined()
        return "porizo-\(aspect.id)-\(hash)"
    }

    static func targetSize(for requestedSize: CGSize, aspect: NowPlayingArtworkAspect) -> CGSize {
        if case .custom = aspect {
            let width = requestedSize.width.isFinite && requestedSize.width > 0 ? requestedSize.width : 512
            let height = requestedSize.height.isFinite && requestedSize.height > 0 ? requestedSize.height : 512
            return CGSize(
                width: CGFloat(Self.evenDimension(width)),
                height: CGFloat(Self.evenDimension(height))
            )
        }

        let maxLongSide: CGFloat = aspect == .portrait3x4 ? 1200 : 1000
        let minLongSide: CGFloat = aspect == .portrait3x4 ? 800 : 800
        let ratio = aspect.widthToHeight
        let requestedLongSide = max(requestedSize.width, requestedSize.height)
        let longSide = min(max(requestedLongSide.isFinite && requestedLongSide > 0 ? requestedLongSide : maxLongSide, minLongSide), maxLongSide)

        let rawSize: CGSize
        if ratio < 1 {
            rawSize = CGSize(width: longSide * ratio, height: longSide)
        } else {
            rawSize = CGSize(width: longSide, height: longSide / ratio)
        }

        return CGSize(
            width: CGFloat(Self.evenDimension(rawSize.width)),
            height: CGFloat(Self.evenDimension(rawSize.height))
        )
    }

    func videoURL(
        for image: UIImage,
        sourceURL: URL?,
        aspect: NowPlayingArtworkAspect,
        requestedSize: CGSize,
        completion: @escaping (URL?) -> Void
    ) {
        let artworkID = Self.artworkID(sourceURL: sourceURL, image: image, aspect: aspect)
        let targetSize = Self.targetSize(for: requestedSize, aspect: aspect)
        let cacheKey = "\(artworkID)-\(Int(targetSize.width))x\(Int(targetSize.height))"

        queue.async { [weak self] in
            guard let self else {
                completion(nil)
                return
            }

            if let existing = self.inMemoryURLs[cacheKey],
               self.fileManager.fileExists(atPath: existing.path) {
                completion(existing)
                return
            }

            do {
                try self.fileManager.createDirectory(
                    at: self.cacheDirectory,
                    withIntermediateDirectories: true
                )

                let outputURL = self.cacheDirectory.appendingPathComponent("\(cacheKey).mp4")
                if self.fileManager.fileExists(atPath: outputURL.path) {
                    self.inMemoryURLs[cacheKey] = outputURL
                    completion(outputURL)
                    return
                }

                guard let cgImage = NowPlayingArtworkRenderer.normalizedCGImage(from: image) else {
                    completion(nil)
                    return
                }

                try self.writeLoopVideo(
                    image: cgImage,
                    targetSize: targetSize,
                    outputURL: outputURL
                )
                self.inMemoryURLs[cacheKey] = outputURL
                completion(outputURL)
            } catch {
                try? self.fileManager.removeItem(
                    at: self.cacheDirectory.appendingPathComponent("\(cacheKey).mp4")
                )
                completion(nil)
            }
        }
    }

    private func writeLoopVideo(image: CGImage, targetSize: CGSize, outputURL: URL) throws {
        let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
        let outputSettings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: Int(targetSize.width),
            AVVideoHeightKey: Int(targetSize.height),
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: 1_400_000,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel
            ]
        ]
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: outputSettings)
        input.expectsMediaDataInRealTime = false
        let attributes: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: Int(targetSize.width),
            kCVPixelBufferHeightKey as String: Int(targetSize.height),
            kCVPixelBufferIOSurfacePropertiesKey as String: [:]
        ]
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: input,
            sourcePixelBufferAttributes: attributes
        )

        guard writer.canAdd(input) else {
            throw NowPlayingAnimatedArtworkError.cannotAddWriterInput
        }
        writer.add(input)

        guard writer.startWriting() else {
            throw writer.error ?? NowPlayingAnimatedArtworkError.writerFailed
        }
        writer.startSession(atSourceTime: .zero)

        let framesPerSecond: Int32 = 30
        let frameCount = 90
        for frameIndex in 0..<frameCount {
            while !input.isReadyForMoreMediaData {
                Thread.sleep(forTimeInterval: 0.005)
            }

            guard let pool = adaptor.pixelBufferPool else {
                throw NowPlayingAnimatedArtworkError.missingPixelBufferPool
            }
            var maybeBuffer: CVPixelBuffer?
            let status = CVPixelBufferPoolCreatePixelBuffer(nil, pool, &maybeBuffer)
            guard status == kCVReturnSuccess, let pixelBuffer = maybeBuffer else {
                throw NowPlayingAnimatedArtworkError.pixelBufferCreationFailed
            }

            NowPlayingArtworkRenderer.draw(
                cgImage: image,
                into: pixelBuffer,
                targetSize: targetSize,
                frameIndex: frameIndex,
                frameCount: frameCount
            )

            let presentationTime = CMTime(
                value: CMTimeValue(frameIndex),
                timescale: framesPerSecond
            )
            guard adaptor.append(pixelBuffer, withPresentationTime: presentationTime) else {
                throw writer.error ?? NowPlayingAnimatedArtworkError.writerFailed
            }
        }

        input.markAsFinished()
        let semaphore = DispatchSemaphore(value: 0)
        writer.finishWriting {
            semaphore.signal()
        }
        semaphore.wait()

        guard writer.status == .completed else {
            throw writer.error ?? NowPlayingAnimatedArtworkError.writerFailed
        }
    }

    private static func evenDimension(_ value: CGFloat) -> Int {
        let rounded = max(2, Int(value.rounded()))
        return rounded.isMultiple(of: 2) ? rounded : rounded + 1
    }
}

private enum NowPlayingAnimatedArtworkError: Error {
    case cannotAddWriterInput
    case missingPixelBufferPool
    case pixelBufferCreationFailed
    case writerFailed
}
