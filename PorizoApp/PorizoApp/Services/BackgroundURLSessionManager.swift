//
//  BackgroundURLSessionManager.swift
//  PorizoApp
//
//  Manages background URLSession for uploads that survive app suspension.
//  iOS relaunches the app to handle completion events even if the app was terminated.
//

import Foundation

extension Notification.Name {
    static let backgroundUploadCompleted = Notification.Name("backgroundUploadCompleted")
    static let trackRenderCompleted = Notification.Name("trackRenderCompleted")
    static let appReturnedToForeground = Notification.Name("appReturnedToForeground")
    static let pushTokenUpdated = Notification.Name("pushTokenUpdated")
}

/// Manages persistent uploads using iOS background URLSession.
///
/// Use this for uploads that should complete even if the user switches apps.
/// iOS will relaunch the app to deliver completion events if needed.
///
/// Usage:
/// ```swift
/// var request = URLRequest(url: uploadURL)
/// request.httpMethod = "PUT"
/// let task = BackgroundURLSessionManager.shared.upload(data: audioData, to: request) { result in
///     switch result {
///     case .success(let data):
///         print("Upload complete")
///     case .failure(let error):
///         print("Upload failed: \(error)")
///     }
/// }
/// ```
final class BackgroundURLSessionManager: NSObject {

    // MARK: - Singleton

    static let shared = BackgroundURLSessionManager()

    // MARK: - Constants

    /// Unique identifier for the background session.
    /// Must remain constant across app launches for iOS to reconnect to pending tasks.
    static let sessionIdentifier = "com.porizo.background-upload"

    // MARK: - Properties

    /// The background URLSession configured for persistent uploads.
    private(set) lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: Self.sessionIdentifier)

        // Execute immediately, don't wait for optimal conditions
        config.isDiscretionary = false

        // Relaunch app to handle completion events
        config.sessionSendsLaunchEvents = true

        // Keep connection alive longer when app goes to background
        config.shouldUseExtendedBackgroundIdleMode = true

        // Network resilience configuration
        config.waitsForConnectivity = true  // Wait for network instead of immediate failure
        config.timeoutIntervalForRequest = 900  // 15 min for background uploads
        config.allowsCellularAccess = true
        config.allowsExpensiveNetworkAccess = true
        config.allowsConstrainedNetworkAccess = false  // Respect Data Saver mode

        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    /// Completion handlers stored by task identifier.
    /// Must survive across delegate callbacks.
    private var completionHandlers: [Int: (Result<Data, Error>) -> Void] = [:]

    /// Data buffers for accumulating response data.
    private var dataBuffers: [Int: Data] = [:]

    /// Thread-safe access to mutable state.
    private let lock = NSLock()

    /// System completion handler for background session events.
    private var backgroundCompletionHandler: (() -> Void)?

    // MARK: - Initialization

    private override init() {
        super.init()
    }

    // MARK: - Public API

    /// Upload data to URL with completion handler that works even after app relaunch.
    ///
    /// - Parameters:
    ///   - data: The data to upload.
    ///   - request: The URLRequest configured with URL and HTTP method.
    ///   - completion: Called when upload completes or fails.
    /// - Returns: The URLSessionUploadTask for tracking or cancellation.
    @discardableResult
    func upload(
        data: Data,
        to request: URLRequest,
        completion: @escaping (Result<Data, Error>) -> Void
    ) -> URLSessionUploadTask {
        let task = session.uploadTask(with: request, from: data)
        let taskId = task.taskIdentifier

        lock.withLock {
            completionHandlers[taskId] = completion
            dataBuffers[taskId] = Data()
        }

        task.resume()
        print("[BackgroundURLSession] Started upload task \(taskId)")
        return task
    }

    /// Called by AppDelegate when system launches app to handle background session events.
    func handleEventsForBackgroundURLSession(completionHandler: @escaping () -> Void) {
        print("[BackgroundURLSession] Handling events for background session")
        lock.withLock { backgroundCompletionHandler = completionHandler }
    }
}

// MARK: - URLSessionDataDelegate

extension BackgroundURLSessionManager: URLSessionDataDelegate {

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.withLock { dataBuffers[dataTask.taskIdentifier]?.append(data) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let taskId = task.taskIdentifier

        let (handler, data) = lock.withLock {
            (completionHandlers.removeValue(forKey: taskId),
             dataBuffers.removeValue(forKey: taskId) ?? Data())
        }

        if let error = error {
            print("[BackgroundURLSession] Task \(taskId) failed: \(error)")
            handler?(.failure(error))
        } else {
            print("[BackgroundURLSession] Task \(taskId) completed with \(data.count) bytes")
            if let handler = handler {
                handler(.success(data))
            } else {
                // Reconnected task (app relaunched) - notify observers
                NotificationCenter.default.post(
                    name: .backgroundUploadCompleted,
                    object: nil,
                    userInfo: ["taskId": taskId, "data": data]
                )
            }
        }
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        print("[BackgroundURLSession] All background events processed")

        let handler = lock.withLock {
            let h = backgroundCompletionHandler
            backgroundCompletionHandler = nil
            return h
        }

        DispatchQueue.main.async { handler?() }
    }
}
