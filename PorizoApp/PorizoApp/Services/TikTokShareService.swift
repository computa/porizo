//
//  TikTokShareService.swift
//  PorizoApp
//
//  Handles TikTok Share Kit handoff and fallback behavior for share cards.
//

import Foundation
import Photos
import UIKit
import TikTokOpenSDKCore
import TikTokOpenShareSDK

@MainActor
enum TikTokShareLaunchResult {
    case launched
    case fallback(reason: String)
}

@MainActor
final class TikTokShareService {
    static let shared = TikTokShareService()

    private enum ShareError: LocalizedError {
        case missingClientKey
        case appUnavailable
        case photoPermissionDenied
        case imageEncodingFailed
        case assetSaveFailed
        case requestRejected

        var errorDescription: String? {
            switch self {
            case .missingClientKey:
                return "TikTok client key is not configured."
            case .appUnavailable:
                return "TikTok app is not available on this device."
            case .photoPermissionDenied:
                return "Photo access is required for TikTok sharing."
            case .imageEncodingFailed:
                return "Unable to prepare share image for TikTok."
            case .assetSaveFailed:
                return "Unable to save the share image to Photos for TikTok."
            case .requestRejected:
                return "TikTok rejected the share request."
            }
        }
    }

    private var inFlightRequests: [String: TikTokShareRequest] = [:]

    private init() {}

    func handleIncomingURL(_ url: URL?) -> Bool {
        TikTokURLHandler.handleOpenURL(url)
    }

    func shareCardImage(_ image: UIImage, shareURL: URL, message: String? = nil) async -> TikTokShareLaunchResult {
        do {
            guard let clientKey = AppConfig.tikTokClientKey, !clientKey.isEmpty else {
                throw ShareError.missingClientKey
            }
            guard canOpenTikTokShareSDK() else {
                throw ShareError.appUnavailable
            }
            guard await ensurePhotoAccess() else {
                throw ShareError.photoPermissionDenied
            }

            let localIdentifier = try await saveImageToPhotoLibrary(image)
            let request = TikTokShareRequest(
                localIdentifiers: [localIdentifier],
                mediaType: .image,
                redirectURI: AppConfig.tikTokRedirectUri
            )
            request.state = shareURL.absoluteString
            if let callbackScheme = AppConfig.tikTokCallbackScheme {
                request.customConfig = .init(
                    clientKey: clientKey,
                    callerUrlScheme: callbackScheme
                )
            }

            // TikTok Share Kit cannot prefill captions or clickable link
            // metadata. Copy the full share message, not only the URL, so the
            // recipient still gets the access PIN when the sender pastes.
            UIPasteboard.general.string = message ?? shareURL.absoluteString

            let requestID = request.requestID
            inFlightRequests[requestID] = request

            let sent = request.send { [weak self] response in
                Task { @MainActor in
                    guard let self else { return }
                    self.inFlightRequests.removeValue(forKey: requestID)
                    self.handleShareResponse(response)
                }
            }

            guard sent else {
                inFlightRequests.removeValue(forKey: requestID)
                throw ShareError.requestRejected
            }

            ToastService.shared.info("TikTok opened. Share message copied.")
            return .launched
        } catch {
            return .fallback(reason: error.localizedDescription)
        }
    }

    private func handleShareResponse(_ response: TikTokBaseResponse) {
        guard let shareResponse = response as? TikTokShareResponse else {
            ToastService.shared.warning("TikTok share did not complete.")
            return
        }

        switch shareResponse.errorCode {
        case .noError:
            break
        case .cancelled:
            ToastService.shared.info("TikTok share cancelled.")
        default:
            let description = shareResponse.errorDescription ?? "TikTok share failed."
            ToastService.shared.warning(description)
        }
    }

    private func canOpenTikTokShareSDK() -> Bool {
        guard let url = URL(string: "tiktoksharesdk://") else { return false }
        return UIApplication.shared.canOpenURL(url)
    }

    private func ensurePhotoAccess() async -> Bool {
        let status = photoAuthorizationStatus()
        switch status {
        case .authorized, .limited:
            return true
        case .notDetermined:
            let nextStatus = await requestPhotoAuthorization()
            return nextStatus == .authorized || nextStatus == .limited
        default:
            return false
        }
    }

    private func photoAuthorizationStatus() -> PHAuthorizationStatus {
        if #available(iOS 14, *) {
            return PHPhotoLibrary.authorizationStatus(for: .addOnly)
        }
        return PHPhotoLibrary.authorizationStatus()
    }

    private func requestPhotoAuthorization() async -> PHAuthorizationStatus {
        await withCheckedContinuation { continuation in
            if #available(iOS 14, *) {
                PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
                    continuation.resume(returning: status)
                }
            } else {
                PHPhotoLibrary.requestAuthorization { status in
                    continuation.resume(returning: status)
                }
            }
        }
    }

    private func saveImageToPhotoLibrary(_ image: UIImage) async throws -> String {
        guard let imageData = image.jpegData(compressionQuality: 0.95) else {
            throw ShareError.imageEncodingFailed
        }

        return try await withCheckedThrowingContinuation { continuation in
            var localIdentifier: String?
            PHPhotoLibrary.shared().performChanges {
                let request = PHAssetCreationRequest.forAsset()
                let options = PHAssetResourceCreationOptions()
                options.originalFilename = "porizo-share-\(UUID().uuidString).jpg"
                request.addResource(with: .photo, data: imageData, options: options)
                localIdentifier = request.placeholderForCreatedAsset?.localIdentifier
            } completionHandler: { success, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                guard success, let localIdentifier, !localIdentifier.isEmpty else {
                    continuation.resume(throwing: ShareError.assetSaveFailed)
                    return
                }
                continuation.resume(returning: localIdentifier)
            }
        }
    }
}
