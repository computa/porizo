//
//  LocalNotificationService.swift
//  PorizoApp
//
//  Handles local notifications for render completion alerts.
//  Singleton pattern since UNUserNotificationCenter is itself a singleton.
//

import Foundation
import OneSignalFramework
import UserNotifications
import UIKit

/// Service for managing local notifications, particularly for render completion alerts.
@MainActor
final class LocalNotificationService {

    // MARK: - Singleton

    static let shared = LocalNotificationService()

    // MARK: - Private Properties

    private let notificationCenter: UNUserNotificationCenter

    // MARK: - Initialization

    private init() {
        self.notificationCenter = UNUserNotificationCenter.current()
    }

    // MARK: - Authorization

    /// Requests notification authorization from the user.
    /// - Throws: An error if the authorization request fails.
    func requestAuthorization() async throws {
        try await notificationCenter.requestAuthorization(options: [.alert, .sound, .badge])
    }

    /// Ensures push/local notification authorization is requested only after the user
    /// has a validated authenticated session. If authorization already exists, re-register
    /// for remote notifications so APNs token delivery can occur for the signed-in user.
    func ensureAuthorizedForAuthenticatedUser() async {
        let settings = await notificationCenter.notificationSettings()

        switch settings.authorizationStatus {
        case .notDetermined:
            OneSignal.Notifications.requestPermission({ accepted in
                if accepted {
                    OneSignal.User.pushSubscription.optIn()
                    UIApplication.shared.registerForRemoteNotifications()
                }
                print("[OneSignal] Notification permission accepted: \(accepted)")
            }, fallbackToSettings: false)
        case .authorized, .provisional, .ephemeral:
            if !OneSignal.User.pushSubscription.optedIn {
                OneSignal.User.pushSubscription.optIn()
            }
            UIApplication.shared.registerForRemoteNotifications()
        case .denied:
            break
        @unknown default:
            break
        }
    }

    // MARK: - Render Notifications

    /// Shows a notification when a song render is complete.
    /// - Parameters:
    ///   - trackId: The unique identifier of the completed track.
    ///   - trackTitle: The display title of the track for the notification.
    func showRenderComplete(trackId: String, trackTitle: String) async {
        let content = UNMutableNotificationContent()
        content.title = "Song Ready!"
        content.body = "\"\(trackTitle)\" is ready to play."
        content.sound = .default

        // Use track ID as identifier for consistent removal
        let identifier = notificationIdentifier(for: trackId)

        // Create a trigger for immediate delivery
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)

        let request = UNNotificationRequest(
            identifier: identifier,
            content: content,
            trigger: trigger
        )

        do {
            try await notificationCenter.add(request)
        } catch {
            // Log but don't throw - notification failure shouldn't break app flow
            print("Failed to schedule notification for track \(trackId): \(error)")
        }
    }

    /// Removes a pending notification for a specific track.
    /// Useful for cleanup when the user views the track before the notification fires.
    /// - Parameter trackId: The unique identifier of the track.
    func removeNotification(for trackId: String) {
        let identifier = notificationIdentifier(for: trackId)
        notificationCenter.removePendingNotificationRequests(withIdentifiers: [identifier])
        notificationCenter.removeDeliveredNotifications(withIdentifiers: [identifier])
    }

    // MARK: - Private Helpers

    /// Generates a consistent notification identifier for a track.
    /// - Parameter trackId: The track's unique identifier.
    /// - Returns: A notification identifier string.
    private func notificationIdentifier(for trackId: String) -> String {
        return "render-complete-\(trackId)"
    }
}
