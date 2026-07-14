//
//  AuthManager.swift
//  PorizoApp
//
//  Manages user authentication state, token storage, and session lifecycle.
//  Handles signup, login, logout, and automatic token refresh.
//

import Foundation
import AuthenticationServices
import OneSignalFramework
import Observation
import UIKit    // For UIApplication.isProtectedDataAvailable

struct MagicLoginLink: Equatable, Sendable {
    let transactionId: String
    let linkSecret: String

    static func parse(_ url: URL) -> MagicLoginLink? {
        guard url.scheme?.lowercased() == "https",
              url.host?.lowercased() == "auth.porizo.co",
              url.path == "/auth/magic/ios",
              url.port == nil,
              url.user == nil,
              url.password == nil,
              let fragment = url.fragment,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }

        let queryItems = components.queryItems ?? []
        let fragmentItems = URLComponents(string: "?\(fragment)")?.queryItems ?? []
        let transactionValues = queryItems.filter { $0.name == "transaction_id" }.compactMap(\.value)
        let secretValues = fragmentItems.filter { $0.name == "secret" }.compactMap(\.value)
        guard transactionValues.count == 1,
              secretValues.count == 1,
              queryItems.count == 1,
              fragmentItems.count == 1,
              !transactionValues[0].isEmpty,
              transactionValues[0].count <= 128,
              !secretValues[0].isEmpty,
              secretValues[0].count <= 512 else { return nil }
        return MagicLoginLink(transactionId: transactionValues[0], linkSecret: secretValues[0])
    }
}

struct MagicLoginResumeLink: Equatable, Sendable {
    let transactionId: String

    static func parse(_ url: URL) -> MagicLoginResumeLink? {
        guard url.scheme?.lowercased() == "porizo",
              url.host?.lowercased() == "auth",
              url.path == "/magic/resume",
              url.port == nil,
              url.user == nil,
              url.password == nil,
              url.fragment == nil,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }

        let queryItems = components.queryItems ?? []
        let transactionValues = queryItems
            .filter { $0.name == "transaction_id" }
            .compactMap(\.value)
        guard queryItems.count == 1,
              transactionValues.count == 1,
              !transactionValues[0].isEmpty,
              transactionValues[0].count <= 128 else { return nil }
        return MagicLoginResumeLink(transactionId: transactionValues[0])
    }
}

struct PendingMagicLogin: Codable, Equatable, Sendable {
    let transactionId: String
    let requestSecret: String
    let requesterKey: String
    let email: String
    let purpose: MagicLoginPurpose
    let expiresAt: Date
    let createdAt: Date
}

enum MagicLoginCompletionPolicy {
    static func allowsCompletion(purpose: MagicLoginPurpose, isAuthenticated: Bool) -> Bool {
        purpose == .addEmail || !isAuthenticated
    }
}

struct MagicLoginPresentation: Codable, Equatable, Identifiable, Sendable {
    static let recoveryGraceInterval: TimeInterval = 5 * 60
    let transactionId: String
    let email: String
    let purpose: MagicLoginPurpose
    let expiresAt: Date
    let createdAt: Date

    var id: String { transactionId }
    var resendAvailableAt: Date { createdAt.addingTimeInterval(60) }
}

enum MagicLoginPresentationStore {
    static let storageKey = "porizo_magic_login_presentation"

    static func save(
        _ presentation: MagicLoginPresentation,
        defaults: UserDefaults = .standard
    ) -> Bool {
        guard let data = try? JSONEncoder().encode(presentation) else { return false }
        defaults.set(data, forKey: storageKey)
        return true
    }

    static func load(
        now: Date = .now,
        defaults: UserDefaults = .standard
    ) -> MagicLoginPresentation? {
        guard let data = defaults.data(forKey: storageKey),
              let presentation = try? JSONDecoder().decode(MagicLoginPresentation.self, from: data) else {
            return nil
        }
        guard presentation.expiresAt.addingTimeInterval(
            MagicLoginPresentation.recoveryGraceInterval
        ) > now else {
            remove(defaults: defaults)
            return nil
        }
        return presentation
    }

    static func remove(defaults: UserDefaults = .standard) {
        defaults.removeObject(forKey: storageKey)
    }
}

enum PendingMagicLoginStore {
    static let maximumEntries = 5
    static let keyPrefix = "porizo_magic_request_"
    static let indexKey = "porizo_magic_request_index"

    static func save(_ pending: PendingMagicLogin, now: Date = .now) -> Bool {
        prune(now: now)
        guard let data = try? JSONEncoder().encode(pending),
              let value = String(data: data, encoding: .utf8),
              KeychainHelper.saveDeviceOnlyString(key: keyPrefix + pending.transactionId, value: value) else {
            return false
        }
        var ids = loadIndex().filter { $0 != pending.transactionId }
        ids.append(pending.transactionId)
        var evictedIds: [String] = []
        while ids.count > maximumEntries {
            evictedIds.append(ids.removeFirst())
        }
        guard saveIndex(ids) else {
            KeychainHelper.delete(key: keyPrefix + pending.transactionId)
            return false
        }
        evictedIds.forEach { KeychainHelper.delete(key: keyPrefix + $0) }
        return true
    }

    static func load(transactionId: String, now: Date = .now) -> PendingMagicLogin? {
        guard let value = KeychainHelper.loadString(key: keyPrefix + transactionId),
              let data = value.data(using: .utf8),
              let pending = try? JSONDecoder().decode(PendingMagicLogin.self, from: data) else { return nil }
        guard pending.expiresAt.addingTimeInterval(
            MagicLoginPresentation.recoveryGraceInterval
        ) > now else {
            remove(transactionId: transactionId)
            return nil
        }
        return pending
    }

    static func remove(transactionId: String) {
        KeychainHelper.delete(key: keyPrefix + transactionId)
        _ = saveIndex(loadIndex().filter { $0 != transactionId })
    }

    static func removeAll() {
        loadIndex().forEach { KeychainHelper.delete(key: keyPrefix + $0) }
        KeychainHelper.delete(key: indexKey)
    }

    static func prune(now: Date = .now) {
        let retained = loadIndex().filter { load(transactionId: $0, now: now) != nil }
        _ = saveIndex(Array(retained.suffix(maximumEntries)))
    }

    private static func loadIndex() -> [String] {
        guard let value = KeychainHelper.loadString(key: indexKey),
              let data = value.data(using: .utf8) else { return [] }
        return (try? JSONDecoder().decode([String].self, from: data)) ?? []
    }

    private static func saveIndex(_ ids: [String]) -> Bool {
        guard let data = try? JSONEncoder().encode(ids),
              let value = String(data: data, encoding: .utf8) else { return false }
        return KeychainHelper.saveDeviceOnlyString(key: indexKey, value: value)
    }
}

enum MagicLoginState: Equatable, Sendable {
    case idle
    case submitting
    case sent(email: String)
    case cooldown(email: String)
    case opening
    case exchanging
    case success
    case expired
    case locked
    case conflict
    case legacyRecovery(maskedEmail: String, authMethods: [String])
    case wrongDeviceOrPlatform
    case offline
    case serverError
    case cancelled
    case superseded
}

// MARK: - AuthManager

/// Manages authentication state and token lifecycle
/// Provides auth tokens to APIClient via closure for Bearer token auth
@MainActor
@Observable
class AuthManager {
    struct AuthenticationOperation {
        let generation: UInt64
        let sessionGeneration: UInt64
    }

    struct PendingSocialLinkRequest {
        let provider: String
        let body: [String: Any]
        let appleUserIdentifier: String?
    }

    // MARK: - Observable State

    private(set) var isAuthenticated: Bool = false
    private(set) var currentUser: AuthUser?
    private(set) var isLoading: Bool = false
    private(set) var hasValidatedSession: Bool = false
    private(set) var needsProfileCompletion: Bool = false
    private(set) var magicLoginState: MagicLoginState = .idle
    private(set) var pendingMagicLoginPresentation: MagicLoginPresentation?
    private(set) var isCommittingAuthenticationSession = false

    /// Phone authentication flow state
    private(set) var phoneAuthState: PhoneAuthState = .idle

    /// Phone number being authenticated (E.164 format)
    private(set) var phoneNumber: String = ""

    /// Registration token for new users after phone verification
    private(set) var registrationToken: String?

    /// Phone number pending auto-link after cross-identifier sign-in.
    /// Persisted to Keychain so it survives app kills during sign-in flow.
    private(set) var pendingPhoneLink: String? {
        didSet {
            guard !isRestoringFromKeychain else { return }
            if let phone = pendingPhoneLink {
                _ = KeychainHelper.saveString(key: Self.pendingPhoneLinkKey, value: phone)
                // Store expiry: 15 minutes from now (matches server-side verification window)
                let expiry = String(Date().addingTimeInterval(15 * 60).timeIntervalSince1970)
                _ = KeychainHelper.saveString(key: Self.pendingPhoneLinkExpiryKey, value: expiry)
            } else {
                KeychainHelper.delete(key: Self.pendingPhoneLinkKey)
                KeychainHelper.delete(key: Self.pendingPhoneLinkExpiryKey)
            }
        }
    }

    private(set) var pendingSocialLinkRequest: PendingSocialLinkRequest?

    /// Suppresses didSet Keychain writes during restoration to avoid resetting TTL
    @ObservationIgnored private var isRestoringFromKeychain = false

    /// User ID from authentication (for AuthTokenProvider conformance)
    var authenticatedUserId: String? {
        currentUser?.id ?? tokenLock.withLock {
            if let cachedUserId, !cachedUserId.isEmpty {
                return cachedUserId
            }
            let storedUserId = KeychainHelper.loadString(key: Self.userIdKey)
            cachedUserId = storedUserId
            return storedUserId
        }
    }

    /// Auth provider string for analytics (e.g. "apple", "phone", "google").
    /// Returns nil if the provider key has never been written.
    var authProvider: String? {
        KeychainHelper.loadString(key: Self.authProviderKey)
    }

    // MARK: - Configuration

    @ObservationIgnored private let baseURL: String
    @ObservationIgnored private let session: URLSession
    @ObservationIgnored private let magicAPIClient: any MagicLoginAPI

    // Keychain keys
    private static let accessTokenKey = "porizo_access_token"
    private static let refreshTokenKey = "porizo_refresh_token"
    private static let tokenExpiryKey = "porizo_token_expiry"
    private static let userIdKey = "porizo_auth_user_id"
    private static let deviceTokenKey = "porizo_device_token"
    private static let deviceTokenExpiryKey = "porizo_device_token_expiry"
    private static let appleUserIdKey = "porizo_apple_user_id"
    private static let authProviderKey = "porizo_auth_provider"
    private static let authBundleMutationMarkerKey = "porizo_auth_bundle_mutating"
    private static let pendingPhoneLinkKey = "porizo_pending_phone_link"
    private static let pendingPhoneLinkExpiryKey = "porizo_pending_phone_link_expiry"

    // Token refresh threshold (refresh if less than 2 minutes remaining)
    @ObservationIgnored private let refreshThreshold: TimeInterval = 120

    // Foreground refresh threshold (refresh if less than 10 minutes remaining)
    // More aggressive when returning from background to ensure smooth UX
    @ObservationIgnored private let foregroundRefreshThreshold: TimeInterval = 600

    // MARK: - Refresh Deduplication
    // Ensures only one refresh is in flight at a time; concurrent callers await the same task
    @ObservationIgnored private var refreshTask: Task<String, Error>?

    // Lock for atomic refreshTask check-and-set to prevent race conditions
    // where two threads both see refreshTask == nil and create duplicate tasks
    @ObservationIgnored private let refreshLock = NSLock()

    // MARK: - Token Synchronization
    // NSLock ensures atomic read/write of token + expiry to prevent race conditions
    // where one thread reads stale expiry while another is mid-write
    @ObservationIgnored private let tokenLock = NSLock()
    @ObservationIgnored private var cachedAccessToken: String?
    @ObservationIgnored private var cachedRefreshToken: String?
    @ObservationIgnored private var cachedTokenExpiryEpoch: Double?
    @ObservationIgnored private var cachedUserId: String?

    // MARK: - Notification Observers
    @ObservationIgnored private var credentialRevokedObserver: NSObjectProtocol?
    @ObservationIgnored private var protectedDataObserver: NSObjectProtocol?
    @ObservationIgnored private var magicStatusTask: Task<Bool, Never>?
    @ObservationIgnored private var magicStatusTaskId: UUID?
    @ObservationIgnored private var directMagicExchangeTask: Task<Bool, Never>?
    @ObservationIgnored private var directMagicExchangeTaskId: UUID?
    @ObservationIgnored private var directMagicExchangeLink: MagicLoginLink?
    @ObservationIgnored private var deferredMagicLoginURL: URL?
    @ObservationIgnored private var magicOperationGeneration: UInt64 = 0
    @ObservationIgnored private var authSessionGeneration: UInt64 = 0
    @ObservationIgnored private var authenticationOperationGeneration: UInt64 = 0
    @ObservationIgnored private var activeAuthenticationCommitID: UUID?
    @ObservationIgnored private var activeAuthenticationOperationGeneration: UInt64?
    @ObservationIgnored private var phoneAuthenticationOperation: AuthenticationOperation?

    var phoneVerificationOperation: AuthenticationOperation? {
        phoneAuthenticationOperation
    }
    @ObservationIgnored private var refreshTaskID: UUID?
    @ObservationIgnored private var isMagicRequestInFlight = false
    @ObservationIgnored private var initialAuthRestorationCompleted = false

    // MARK: - Protected Data Handling (iOS 15+ Fix)

    /// Waits for protected data to become available before reading Keychain.
    /// On iOS 15+, Keychain reads can fail if device hasn't been unlocked since restart.
    /// Returns true if data is available, false if timeout (5 seconds).
    func waitForProtectedData() async -> Bool {
        // If already available, return immediately
        if UIApplication.shared.isProtectedDataAvailable {
            return true
        }

        print("[Auth] Waiting for protected data to become available...")

        let becameAvailable = await withTaskGroup(of: Bool.self) { group in
            group.addTask {
                for await _ in NotificationCenter.default.notifications(
                    named: UIApplication.protectedDataDidBecomeAvailableNotification
                ) {
                    return true
                }
                return false
            }

            group.addTask {
                try? await Task.sleep(for: .seconds(5))
                return false
            }

            let result = await group.next() ?? false
            group.cancelAll()
            return result
        }

        if becameAvailable {
            print("[Auth] Protected data now available")
        } else {
            print("[Auth] Protected data timeout - proceeding without auth")
        }
        return becameAvailable
    }

    // MARK: - Initialization

    init(
        baseURL: String? = nil,
        magicAPIClient: (any MagicLoginAPI)? = nil,
        session: URLSession? = nil
    ) {
        self.baseURL = baseURL ?? AppConfig.apiBaseURL
        self.magicAPIClient = magicAPIClient ?? APIClient(baseURL: self.baseURL)

        if let session {
            self.session = session
        } else {
            let config = URLSessionConfiguration.default
            config.timeoutIntervalForRequest = 30
            self.session = URLSession(configuration: config)
        }
        self.pendingMagicLoginPresentation = MagicLoginPresentationStore.load()
        if let pendingMagicLoginPresentation {
            self.magicLoginState = .sent(email: pendingMagicLoginPresentation.email)
        }

        // Listen for Apple credential revocation (Apple's WWDC20 requirement)
        // This fires when user revokes access via Settings → Apple ID → Apps Using Apple ID
        credentialRevokedObserver = NotificationCenter.default.addObserver(
            forName: ASAuthorizationAppleIDProvider.credentialRevokedNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            guard let self else { return }
            print("[Auth] Apple credential revoked notification received")
            MainActor.assumeIsolated {
                self.logout()
            }
        }

        // Check for existing tokens
        loadAuthState()
    }

    deinit {
        if let observer = credentialRevokedObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        if let observer = protectedDataObserver {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    // MARK: - Platform-bound Magic Login

    func requestMagicLogin(email: String, purpose: MagicLoginPurpose) async throws {
        guard !isMagicRequestInFlight else {
            throw AuthError.serverError("A sign-in link is already being sent.")
        }
        isMagicRequestInFlight = true
        defer { isMagicRequestInFlight = false }
        cancelMagicOperations()
        let generation = magicOperationGeneration
        let sessionGeneration = authSessionGeneration
        let normalizedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard normalizedEmail.contains("@") else {
            magicLoginState = .serverError
            throw AuthError.serverError("Enter a valid email address.")
        }
        magicLoginState = .submitting
        let requesterKey = UUID().uuidString.lowercased()

        do {
            let bearer = purpose == .addEmail ? try await getAccessToken() : nil
            guard isCurrentMagicOperation(generation, sessionGeneration: sessionGeneration) else { return }
            let response = try await magicAPIClient.requestMagicLogin(
                email: normalizedEmail,
                purpose: purpose,
                requesterKey: requesterKey,
                bearerToken: bearer
            )
            guard isCurrentMagicOperation(generation, sessionGeneration: sessionGeneration) else { return }
            guard let expiresAt = Self.parseServerDate(response.expiresAt) else {
                throw AuthError.serverError("The sign-in link had an invalid expiry.")
            }
            let pending = PendingMagicLogin(
                transactionId: response.transactionId,
                requestSecret: response.requestSecret,
                requesterKey: requesterKey,
                email: normalizedEmail,
                purpose: purpose,
                expiresAt: expiresAt,
                createdAt: .now
            )
            guard PendingMagicLoginStore.save(pending) else {
                throw AuthError.keychainSaveFailed
            }
            let presentation = MagicLoginPresentation(
                transactionId: response.transactionId,
                email: normalizedEmail,
                purpose: purpose,
                expiresAt: expiresAt,
                createdAt: .now
            )
            guard MagicLoginPresentationStore.save(presentation) else {
                PendingMagicLoginStore.remove(transactionId: response.transactionId)
                throw AuthError.keychainSaveFailed
            }
            if let previous = pendingMagicLoginPresentation,
               previous.transactionId != response.transactionId {
                PendingMagicLoginStore.remove(transactionId: previous.transactionId)
            }
            pendingMagicLoginPresentation = presentation
            magicLoginState = .sent(email: normalizedEmail)
            if let deferredURL = deferredMagicLoginURL {
                deferredMagicLoginURL = nil
                isMagicRequestInFlight = false
                _ = await handleMagicLoginURL(deferredURL)
            }
        } catch {
            guard isCurrentMagicOperation(generation, sessionGeneration: sessionGeneration) else { return }
            magicLoginState = Self.magicFailureState(for: error)
            throw error
        }
    }

    @discardableResult
    func handleMagicLoginURL(_ url: URL) async -> Bool {
        guard let link = MagicLoginLink.parse(url) else { return false }

        // The requester secret is persisted only when /request returns. An
        // unusually fast email tap can beat that response, so retain the URL
        // and consume it immediately after the request transaction is durable.
        if isMagicRequestInFlight {
            deferredMagicLoginURL = url
            return true
        }

        if let activeTask = directMagicExchangeTask {
            if directMagicExchangeLink == link {
                return await activeTask.value
            }

            // Exchanges are side-effecting server transactions. Serialize a
            // different link behind the current one instead of cancelling a
            // request that the server may already have consumed.
            let activeTaskId = directMagicExchangeTaskId
            _ = await activeTask.value
            if directMagicExchangeTaskId == activeTaskId {
                directMagicExchangeTask = nil
                directMagicExchangeTaskId = nil
                directMagicExchangeLink = nil
            }
            if isAuthenticated { return true }
        }

        cancelMagicOperations()
        let generation = magicOperationGeneration
        let sessionGeneration = authSessionGeneration
        let taskId = UUID()
        let task = Task { @MainActor [weak self] in
            guard let self else { return false }
            return await self.performDirectMagicLoginExchange(
                link,
                generation: generation,
                sessionGeneration: sessionGeneration
            )
        }
        directMagicExchangeTask = task
        directMagicExchangeTaskId = taskId
        directMagicExchangeLink = link

        let result = await task.value
        if directMagicExchangeTaskId == taskId {
            directMagicExchangeTask = nil
            directMagicExchangeTaskId = nil
            directMagicExchangeLink = nil
        }
        return result
    }

    private func performDirectMagicLoginExchange(
        _ link: MagicLoginLink,
        generation: UInt64,
        sessionGeneration: UInt64
    ) async -> Bool {
        guard isCurrentMagicOperation(generation, sessionGeneration: sessionGeneration) else { return true }
        magicLoginState = .opening
        guard let pending = PendingMagicLoginStore.load(transactionId: link.transactionId) else {
            if let presentation = pendingMagicLoginPresentation,
               presentation.transactionId == link.transactionId,
               presentation.expiresAt <= .now {
                clearMagicLoginPresentation(transactionId: link.transactionId)
                magicLoginState = .expired
            } else if pendingMagicLoginPresentation == nil {
                magicLoginState = .wrongDeviceOrPlatform
            } else if let presentation = pendingMagicLoginPresentation {
                magicLoginState = .sent(email: presentation.email)
            }
            return true
        }
        guard isCurrentMagicOperation(generation, sessionGeneration: sessionGeneration) else { return true }
        if pending.purpose == .login, shouldAwaitInitialAuthRestoration() {
            guard await awaitInitialAuthRestoration() else {
                if isCurrentMagicOperation(generation, sessionGeneration: sessionGeneration) {
                    magicLoginState = .serverError
                }
                return true
            }
            guard isCurrentMagicOperation(
                generation,
                sessionGeneration: sessionGeneration
            ) else { return true }
        }
        guard canCompleteMagicLogin(pending) else { return true }
        guard let ownedSessionGeneration = claimMagicLoginSessionOwnership(
            pending,
            expectedSessionGeneration: sessionGeneration
        ) else { return true }

        magicLoginState = .exchanging
        do {
            let response = try await magicAPIClient.exchangeMagicLogin(
                transactionId: link.transactionId,
                linkSecret: link.linkSecret,
                requestSecret: pending.requestSecret
            )
            guard isCurrentMagicOperation(
                generation,
                sessionGeneration: ownedSessionGeneration
            ) else { return true }
            try await finishMagicLogin(
                response,
                pending: pending,
                generation: generation,
                sessionGeneration: ownedSessionGeneration
            )
        } catch {
            guard isCurrentMagicOperation(generation), !isAuthenticated else { return true }
            magicLoginState = Self.magicFailureState(for: error)
        }
        return true
    }

    @discardableResult
    func refreshMagicLoginStatus(transactionId: String? = nil) async -> Bool {
        guard directMagicExchangeTask == nil, !isMagicRequestInFlight else { return false }
        if let magicStatusTask {
            return await magicStatusTask.value
        }
        magicOperationGeneration &+= 1
        let generation = magicOperationGeneration
        let sessionGeneration = authSessionGeneration
        let taskId = UUID()
        let task = Task { @MainActor [weak self] in
            guard let self else { return false }
            return await self.performMagicLoginStatusRefresh(
                transactionId: transactionId,
                generation: generation,
                sessionGeneration: sessionGeneration
            )
        }
        magicStatusTask = task
        magicStatusTaskId = taskId
        let result = await task.value
        if magicStatusTaskId == taskId {
            magicStatusTask = nil
            magicStatusTaskId = nil
        }
        return result
    }

    private func performMagicLoginStatusRefresh(
        transactionId: String?,
        generation: UInt64,
        sessionGeneration: UInt64
    ) async -> Bool {
        guard isCurrentMagicOperation(generation, sessionGeneration: sessionGeneration) else { return false }
        // Once a terminal recovery/error state has been reached (e.g. the direct
        // exchange returned LEGACY_ACCOUNT_RECOVERY_REQUIRED), a racing refresh —
        // typically the scene-phase `.active` trigger — must not re-enter or
        // downgrade it. Without this guard the pending record is already consumed,
        // so the `PendingMagicLoginStore.load` miss below would clear the
        // presentation and flip the state to `.wrongDeviceOrPlatform`, collapsing
        // the recovery screen back to email entry.
        if Self.isTerminalMagicState(magicLoginState) { return true }
        guard let presentation = pendingMagicLoginPresentation else {
            if transactionId != nil { magicLoginState = .wrongDeviceOrPlatform }
            return false
        }
        guard transactionId == nil || transactionId == presentation.transactionId else {
            return false
        }
        guard let pending = PendingMagicLoginStore.load(transactionId: presentation.transactionId) else {
            clearMagicLoginPresentation(transactionId: presentation.transactionId)
            magicLoginState = .wrongDeviceOrPlatform
            return true
        }
        guard isCurrentMagicOperation(generation, sessionGeneration: sessionGeneration) else { return false }
        if pending.purpose == .login, shouldAwaitInitialAuthRestoration() {
            guard await awaitInitialAuthRestoration() else {
                if isCurrentMagicOperation(generation, sessionGeneration: sessionGeneration) {
                    magicLoginState = .serverError
                }
                return false
            }
            guard isCurrentMagicOperation(
                generation,
                sessionGeneration: sessionGeneration
            ) else { return false }
        }
        guard canCompleteMagicLogin(pending) else { return true }

        do {
            let response = try await magicAPIClient.magicLoginNativeStatus(
                transactionId: pending.transactionId,
                requestSecret: pending.requestSecret
            )
            guard isCurrentMagicOperation(generation, sessionGeneration: sessionGeneration) else { return false }
            switch response.status {
            case .pending:
                if magicLoginState != .cooldown(email: pending.email) {
                    magicLoginState = .sent(email: pending.email)
                }
                return false
            case .approved, .consumed:
                guard let ownedSessionGeneration = claimMagicLoginSessionOwnership(
                    pending,
                    expectedSessionGeneration: sessionGeneration
                ) else { return true }
                magicLoginState = .exchanging
                let completion = try await magicAPIClient.completeApprovedMagicLogin(
                    transactionId: pending.transactionId,
                    requestSecret: pending.requestSecret
                )
                guard isCurrentMagicOperation(
                    generation,
                    sessionGeneration: ownedSessionGeneration
                ) else { return false }
                try await finishMagicLogin(
                    completion,
                    pending: pending,
                    generation: generation,
                    sessionGeneration: ownedSessionGeneration
                )
                return true
            case .expired:
                clearMagicLoginPresentation(transactionId: pending.transactionId)
                magicLoginState = .expired
                return true
            case .locked:
                magicLoginState = .locked
                return true
            case .conflict:
                magicLoginState = .conflict
                return true
            }
        } catch {
            guard isCurrentMagicOperation(generation), !isAuthenticated else { return false }
            magicLoginState = Self.magicFailureState(for: error)
            switch magicLoginState {
            case .expired, .locked, .conflict, .legacyRecovery,
                 .wrongDeviceOrPlatform, .cancelled, .superseded:
                return true
            default:
                break
            }
        }
        return false
    }

    func cancelMagicLogin() {
        cancelMagicOperations()
        if let transactionId = pendingMagicLoginPresentation?.transactionId {
            PendingMagicLoginStore.remove(transactionId: transactionId)
        }
        MagicLoginPresentationStore.remove()
        pendingMagicLoginPresentation = nil
        magicLoginState = .cancelled
    }

    func resetMagicLoginState() {
        magicLoginState = .idle
    }

    private func finishMagicLogin(
        _ response: MagicLoginExchangeResponse,
        pending: PendingMagicLogin,
        generation: UInt64,
        sessionGeneration: UInt64
    ) async throws {
        if pending.purpose == .addEmail {
            guard response.contactVerified == true else {
                throw AuthError.serverError("The email could not be verified.")
            }
            try await fetchCurrentUser(sessionGeneration: sessionGeneration)
            guard isCurrentMagicOperation(
                generation,
                sessionGeneration: sessionGeneration
            ) else { throw CancellationError() }
            clearMagicLoginPresentation(transactionId: pending.transactionId)
            magicLoginState = .success
            return
        }

        guard let accessToken = response.accessToken,
              let refreshToken = response.refreshToken else {
            throw AuthError.serverError("The sign-in response was incomplete.")
        }
        let authResponse = AuthResponse(
            userId: response.userId,
            accessToken: accessToken,
            refreshToken: refreshToken,
            expiresIn: response.expiresIn ?? 15 * 60,
            isNewUser: response.isNewUser ?? false
        )
        guard isCurrentMagicOperation(
            generation,
            sessionGeneration: sessionGeneration
        ) else { throw CancellationError() }
        try await commitAuthenticatedSession(
            authResponse,
            provider: "email_magic",
            expectedSessionGeneration: sessionGeneration,
            isOperationCurrent: { [weak self] in
                self?.isCurrentMagicOperation(
                    generation,
                    sessionGeneration: sessionGeneration
                ) == true
            },
            onCommitted: { [weak self] in
                self?.clearMagicLoginPresentation(transactionId: pending.transactionId)
                self?.magicLoginState = .success
            }
        )
    }

    private func clearMagicLoginPresentation(transactionId: String) {
        PendingMagicLoginStore.remove(transactionId: transactionId)
        if pendingMagicLoginPresentation?.transactionId == transactionId {
            MagicLoginPresentationStore.remove()
            pendingMagicLoginPresentation = nil
        }
    }

    private func canCompleteMagicLogin(_ pending: PendingMagicLogin) -> Bool {
        guard MagicLoginCompletionPolicy.allowsCompletion(
            purpose: pending.purpose,
            isAuthenticated: isAuthenticated
        ) else {
            clearMagicLoginPresentation(transactionId: pending.transactionId)
            magicLoginState = .superseded
            return false
        }
        return true
    }

    private func claimMagicLoginSessionOwnership(
        _ pending: PendingMagicLogin,
        expectedSessionGeneration: UInt64
    ) -> UInt64? {
        guard expectedSessionGeneration == authSessionGeneration else { return nil }
        guard pending.purpose == .login else { return authSessionGeneration }
        guard !isAuthenticated else {
            magicLoginState = .superseded
            return nil
        }

        // A requested magic login is now the sole candidate session. Invalidate
        // stale launch-time provider validation before it can restore or clear
        // the previous session underneath this transaction.
        authSessionGeneration &+= 1
        return authSessionGeneration
    }

    private func shouldAwaitInitialAuthRestoration() -> Bool {
        guard !initialAuthRestorationCompleted else { return false }
        guard UIApplication.shared.isProtectedDataAvailable else { return true }

        // Any durable credential material means restoration still has work to do.
        // A complete set may restore a valid account; a partial set must be
        // cleared before a magic-login exchange consumes its one-time link.
        return KeychainHelper.loadString(key: Self.accessTokenKey) != nil
            || KeychainHelper.loadString(key: Self.refreshTokenKey) != nil
            || KeychainHelper.loadString(key: Self.userIdKey) != nil
    }

    private func awaitInitialAuthRestoration() async -> Bool {
        let deadline = ContinuousClock.now.advanced(by: .seconds(8))
        while !initialAuthRestorationCompleted {
            guard !Task.isCancelled, ContinuousClock.now < deadline else { return false }
            try? await Task.sleep(for: .milliseconds(25))
        }
        return true
    }

    private func finishInitialAuthRestoration() {
        initialAuthRestorationCompleted = true
    }

    private func cancelMagicOperations() {
        magicOperationGeneration &+= 1
        magicStatusTask?.cancel()
        magicStatusTask = nil
        magicStatusTaskId = nil
        directMagicExchangeTask?.cancel()
        directMagicExchangeTask = nil
        directMagicExchangeTaskId = nil
        directMagicExchangeLink = nil
        deferredMagicLoginURL = nil
    }

    private func isCurrentMagicOperation(_ generation: UInt64) -> Bool {
        !Task.isCancelled && generation == magicOperationGeneration
    }

    private func isCurrentMagicOperation(
        _ generation: UInt64,
        sessionGeneration: UInt64
    ) -> Bool {
        isCurrentMagicOperation(generation)
            && sessionGeneration == authSessionGeneration
    }

    private static func parseServerDate(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }

    /// Terminal magic-login states: the flow has resolved (success or a
    /// resolution the user must act on) and background refresh/exchange must not
    /// re-enter or overwrite them.
    nonisolated static func isTerminalMagicState(_ state: MagicLoginState) -> Bool {
        switch state {
        case .success, .expired, .locked, .conflict, .legacyRecovery,
             .wrongDeviceOrPlatform, .cancelled, .superseded:
            true
        default:
            false
        }
    }

    private static func magicFailureState(for error: Error) -> MagicLoginState {
        if let urlError = error as? URLError,
           [.notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotConnectToHost].contains(urlError.code) {
            return .offline
        }
        if case APIClientError.httpError(let status, let body) = error {
            let normalized = body.lowercased()
            if status == 409 || normalized.contains("conflict") { return .conflict }
            if status == 410 || normalized.contains("expired") { return .expired }
            if status == 423 || normalized.contains("locked") { return .locked }
            if normalized.contains("platform") || normalized.contains("requester") { return .wrongDeviceOrPlatform }
        }
        if case APIClientError.serverError(_, let code, let details) = error {
            if code == "LEGACY_ACCOUNT_RECOVERY_REQUIRED" {
                let maskedEmail = details?["masked_email"] ?? "this email"
                let methods = details?["auth_methods"]?
                    .split(separator: ",")
                    .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) } ?? []
                return .legacyRecovery(maskedEmail: maskedEmail, authMethods: methods)
            }
            if code?.contains("EXPIRED") == true { return .expired }
            if code?.contains("LOCKED") == true { return .locked }
            if code?.contains("CONFLICT") == true { return .conflict }
            if code?.contains("PLATFORM") == true || code?.contains("REQUESTER") == true {
                return .wrongDeviceOrPlatform
            }
        }
        return .serverError
    }

    // MARK: - Auth State

    /// Loads existing auth state from Keychain
    /// Implements Apple's WWDC20 recommendation: validate credential state on every launch
    /// iOS 15+ fix: Waits for protected data before reading Keychain
    private func loadAuthState() {
        Task {
            // iOS 15+ fix: Wait for protected data before reading Keychain
            // This prevents false logouts when app launches with device locked
            let protectedDataAvailable = await waitForProtectedData()
            if !protectedDataAvailable {
                print("[Auth] Protected data not available after timeout - skipping auth load")
                // Defer auth load instead of forcing a perceived logout on cold boot.
                scheduleDeferredAuthLoadWhenProtectedDataAvailable()
                return
            }

            // Already on MainActor (class-level annotation), no wrapper needed
            self.performKeychainAuthLoad()
        }
    }

    /// If protected data is unavailable at launch, retry loading auth state once iOS unlocks keychain access.
    @MainActor
    private func scheduleDeferredAuthLoadWhenProtectedDataAvailable() {
        guard protectedDataObserver == nil else { return }

        protectedDataObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.protectedDataDidBecomeAvailableNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self = self else { return }
                print("[Auth] Protected data became available - retrying auth load")
                if let observer = self.protectedDataObserver {
                    NotificationCenter.default.removeObserver(observer)
                    self.protectedDataObserver = nil
                }
                self.performKeychainAuthLoad()
            }
        }

        // Close the check/register race: protected data may become available
        // after waitForProtectedData timed out but before the observer existed.
        if UIApplication.shared.isProtectedDataAvailable {
            if let observer = protectedDataObserver {
                NotificationCenter.default.removeObserver(observer)
                protectedDataObserver = nil
            }
            performKeychainAuthLoad()
        }
    }

    /// Performs the actual Keychain read after protected data is available
    /// Must be called on MainActor
    @MainActor
    private func performKeychainAuthLoad() {
        if KeychainHelper.loadString(key: Self.authBundleMutationMarkerKey) != nil {
            print("[Auth] Interrupted authentication bundle mutation detected - clearing credentials")
            clearIncompleteRestoredAuthState()
            finishInitialAuthRestoration()
            return
        }
        let accessToken = KeychainHelper.loadString(key: Self.accessTokenKey)
        let refreshToken = KeychainHelper.loadString(key: Self.refreshTokenKey)
        let tokenExpiry = KeychainHelper.loadString(key: Self.tokenExpiryKey).flatMap(Double.init)
        let userId = KeychainHelper.loadString(key: Self.userIdKey)
        let appleUserId = KeychainHelper.loadString(key: Self.appleUserIdKey)
        let authProvider = KeychainHelper.loadString(key: Self.authProviderKey)

        tokenLock.withLock {
            cachedAccessToken = accessToken
            cachedRefreshToken = refreshToken
            cachedTokenExpiryEpoch = tokenExpiry
            cachedUserId = userId
        }

        // Restore pendingPhoneLink from Keychain (survives app kills during sign-in flow)
        // Use isRestoringFromKeychain flag to suppress didSet (avoids resetting TTL on restore)
        if let savedPhone = KeychainHelper.loadString(key: Self.pendingPhoneLinkKey),
           let expiryStr = KeychainHelper.loadString(key: Self.pendingPhoneLinkExpiryKey),
           let expiryEpoch = Double(expiryStr),
           Date().timeIntervalSince1970 < expiryEpoch {
            isRestoringFromKeychain = true
            pendingPhoneLink = savedPhone
            isRestoringFromKeychain = false
            print("[Auth] Restored pendingPhoneLink from Keychain")
        } else {
            // Expired or missing — clean up
            KeychainHelper.delete(key: Self.pendingPhoneLinkKey)
            KeychainHelper.delete(key: Self.pendingPhoneLinkExpiryKey)
        }

        print("[Auth] loadAuthState: access=\(accessToken != nil), refresh=\(refreshToken != nil), userId=\(userId != nil), appleUserId=\(appleUserId != nil), provider=\(authProvider ?? "none"))")

        // If this session is Apple-authenticated, validate credential FIRST (WWDC20 requirement)
        // getCredentialState is a LOCAL call (no network) - very fast
        if authProvider == "apple", let appleUserId = appleUserId {
            let restorationSessionGeneration = authSessionGeneration
            Task {
                let credentialValid = await validateAppleCredential(appleUserId: appleUserId)
                await MainActor.run {
                    guard restorationSessionGeneration == self.authSessionGeneration else {
                        print("[Auth] Ignoring stale Apple credential restoration")
                        self.finishInitialAuthRestoration()
                        return
                    }
                    if credentialValid {
                        print("[Auth] Apple credential valid - proceeding with token check")
                        self.completeAuthStateLoad(accessToken: accessToken, refreshToken: refreshToken, userId: userId)
                    } else {
                        print("[Auth] Apple credential invalid - forcing re-login")
                        self.logout()
                    }
                    self.finishInitialAuthRestoration()
                }
            }
        } else {
            // Non-Apple session (or legacy session without provider)
            print("[Auth] Apple credential check skipped (provider=\(authProvider ?? "none"))")
            completeAuthStateLoad(accessToken: accessToken, refreshToken: refreshToken, userId: userId)
            finishInitialAuthRestoration()
        }
    }

    /// Complete auth state loading after credential validation
    private func completeAuthStateLoad(accessToken: String?, refreshToken: String?, userId: String?) {
        if accessToken != nil, refreshToken != nil, userId != nil {
            print("[Auth] All tokens found, restoring session optimistically...")
            isAuthenticated = true
            hasValidatedSession = false
            isLoading = false
            // Validate session in the background; only definitive failures should log out
            let validationSessionGeneration = authSessionGeneration
            Task {
                do {
                    try await fetchCurrentUser(sessionGeneration: validationSessionGeneration)
                    print("[Auth] Session validated on launch")
                } catch {
                    guard validationSessionGeneration == authSessionGeneration else { return }
                    handleLaunchValidationError(error)
                }
            }
        } else if accessToken != nil || refreshToken != nil || userId != nil {
            // Partial auth state is invalid; clear stored credentials
            print("[Auth] PARTIAL STATE DETECTED - clearing incomplete restored session")
            clearIncompleteRestoredAuthState()
        } else {
            print("[Auth] No tokens found")
        }
    }

    /// Clears an invalid cold-start credential fragment without cancelling a
    /// pending magic-login transaction. There is no complete session to revoke,
    /// and the transaction may be waiting for this cleanup to finish.
    private func clearIncompleteRestoredAuthState() {
        let credentialKeys = [
            Self.accessTokenKey,
            Self.refreshTokenKey,
            Self.tokenExpiryKey,
            Self.userIdKey,
            Self.deviceTokenKey,
            Self.deviceTokenExpiryKey,
            Self.appleUserIdKey,
            Self.authProviderKey,
        ]
        let cleared = credentialKeys.reduce(true) { result, key in
            KeychainHelper.delete(key: key) && result
        }
        if cleared {
            KeychainHelper.delete(key: Self.authBundleMutationMarkerKey)
        }
        tokenLock.withLock {
            cachedAccessToken = nil
            cachedRefreshToken = nil
            cachedTokenExpiryEpoch = nil
            cachedUserId = nil
        }
        isAuthenticated = false
        hasValidatedSession = false
        needsProfileCompletion = false
        currentUser = nil
    }

    /// Handle launch-time session validation failures without forcing logout on transient errors
    private func handleLaunchValidationError(_ error: Error) {
        if let authError = error as? AuthError {
            switch authError {
            case .tokenExpired, .notAuthenticated:
                print("[Auth] Launch validation failed definitively - logging out")
                logout()
            default:
                print("[Auth] Launch validation failed (non-fatal): \(authError.localizedDescription)")
            }
        } else {
            print("[Auth] Launch validation failed (unknown error): \(error.localizedDescription)")
        }
    }

    /// Get the current access token, refreshing if needed
    /// Uses tokenLock for atomic read to prevent reading stale token during concurrent refresh
    func getAccessToken() async throws -> String? {
        guard isAuthenticated else { return nil }

        // Track whether we awaited an existing refresh task
        var didAwaitRefresh = false

        // Check for in-flight refresh atomically
        let existingTask = refreshLock.withLock { refreshTask }

        // If a refresh is already in flight, await it so we don't return a stale token.
        if let existingTask = existingTask {
            print("[Auth] getAccessToken: awaiting in-flight refresh")
            _ = try await existingTask.value
            didAwaitRefresh = true
        }

        // Skip refresh check if we just awaited - token is guaranteed fresh
        // This prevents the secondary race condition where we read stale expiry
        // between the time the refresh completed and wrote the new expiry
        if !didAwaitRefresh && shouldRefreshToken() {
            print("[Auth] getAccessToken: token needs refresh")
            try await refreshTokens()
        }

        // Atomic read of token to prevent reading during concurrent write
        let token: String? = tokenLock.withLock { () -> String? in
            if let cachedAccessToken, !cachedAccessToken.isEmpty {
                return cachedAccessToken
            }
            let storedToken = KeychainHelper.loadString(key: Self.accessTokenKey)
            cachedAccessToken = storedToken
            return storedToken
        }
        if token == nil {
            print("[Auth] getAccessToken: Keychain returned nil!")
        }
        return token
    }

    // MARK: - Proactive Token Refresh

    /// Proactive refresh threshold: refresh if token expires within 5 minutes
    /// This is more aggressive than the reactive `refreshThreshold` (2 min) to avoid 401s
    @ObservationIgnored private let proactiveRefreshThreshold: TimeInterval = 300

    /// Ensures access token is valid before making API calls.
    /// Proactively refreshes if token expires within 5 minutes.
    /// Uses tokenLock for atomic reads to prevent race conditions.
    /// - Returns: Valid access token
    /// - Throws: AuthError.notAuthenticated if unable to get valid token
    func ensureValidAccessToken() async throws -> String {
        // Early exit if not authenticated (matches getAccessToken behavior)
        guard isAuthenticated else {
            throw AuthError.notAuthenticated
        }

        // Atomic read of current token and expiry
        let (currentToken, timeRemaining): (String?, TimeInterval) = tokenLock.withLock {
            let token: String? = {
                if let cachedAccessToken, !cachedAccessToken.isEmpty {
                    return cachedAccessToken
                }
                let storedToken = KeychainHelper.loadString(key: Self.accessTokenKey)
                cachedAccessToken = storedToken
                return storedToken
            }()

            let expiryEpoch: Double? = {
                if let cachedTokenExpiryEpoch {
                    return cachedTokenExpiryEpoch
                }
                guard let expiryString = KeychainHelper.loadString(key: Self.tokenExpiryKey),
                      let expiry = Double(expiryString) else {
                    return nil
                }
                cachedTokenExpiryEpoch = expiry
                return expiry
            }()

            guard let expiryEpoch else {
                return (token, 0)
            }
            return (token, Date(timeIntervalSince1970: expiryEpoch).timeIntervalSinceNow)
        }

        // Check if we have a token at all
        guard currentToken != nil else {
            throw AuthError.notAuthenticated
        }

        // Log expiry check details
        print("[Auth] Token expiry check: \(Int(timeRemaining))s remaining, buffer=\(Int(proactiveRefreshThreshold))s")

        // Check expiry with 5-minute buffer (proactive refresh)
        if timeRemaining < proactiveRefreshThreshold {
            // Token expires within 5 minutes - refresh proactively
            print("[Auth] Token expires in <5 min (\(Int(timeRemaining))s), refreshing proactively")
            try await refreshTokens()
            print("[Auth] Proactive refresh completed")
        }

        // Atomic read of the (possibly refreshed) token
        let validToken: String? = tokenLock.withLock { () -> String? in
            if let cachedAccessToken, !cachedAccessToken.isEmpty {
                return cachedAccessToken
            }
            let storedToken = KeychainHelper.loadString(key: Self.accessTokenKey)
            cachedAccessToken = storedToken
            return storedToken
        }

        guard let validToken = validToken else {
            print("[Auth] ensureValidAccessToken: Keychain returned nil!")
            throw AuthError.notAuthenticated
        }

        return validToken
    }

    /// Get the token expiry date from in-memory cache with keychain fallback.
    /// Uses tokenLock for atomic read to prevent race with saveRefreshedTokens.
    private func tokenExpiryDate() -> Date? {
        tokenLock.withLock {
            if let cachedTokenExpiryEpoch {
                return Date(timeIntervalSince1970: cachedTokenExpiryEpoch)
            }

            guard let expiryString = KeychainHelper.loadString(key: Self.tokenExpiryKey),
                  let expiry = Double(expiryString) else {
                return nil
            }
            cachedTokenExpiryEpoch = expiry
            return Date(timeIntervalSince1970: expiry)
        }
    }

    /// Check if token should be refreshed
    private func shouldRefreshToken(threshold: TimeInterval? = nil) -> Bool {
        guard let expiryDate = tokenExpiryDate() else {
            return true
        }
        return expiryDate.timeIntervalSinceNow < (threshold ?? refreshThreshold)
    }

    /// Check if token is actually expired (not just needing refresh)
    private func isTokenExpired() -> Bool {
        guard let expiryDate = tokenExpiryDate() else {
            return true
        }
        return expiryDate.timeIntervalSinceNow <= 0
    }

    // MARK: - Foreground Refresh

    /// Called when app returns to foreground to proactively refresh tokens
    /// This enables Spotify-style persistent login where users never see re-login prompts
    /// Also validates Apple credential per WWDC20 guidance (check on every foreground)
    func refreshTokensIfNeeded() async {
        guard isAuthenticated else { return }
        let expectedSessionGeneration = authSessionGeneration

        // Apple's WWDC20 requirement: validate credential on every foreground transition
        // getCredentialState is LOCAL (no network) so this is fast
        if KeychainHelper.loadString(key: Self.authProviderKey) == "apple",
           let appleUserId = KeychainHelper.loadString(key: Self.appleUserIdKey) {
            let credentialValid = await validateAppleCredential(appleUserId: appleUserId)
            guard expectedSessionGeneration == authSessionGeneration,
                  appleUserId == KeychainHelper.loadString(key: Self.appleUserIdKey) else {
                return
            }
            if !credentialValid {
                print("[Auth] Apple credential invalid on foreground - logging out")
                logout()
                return
            }
        }

        // Refresh if token expires within 10 minutes (more aggressive than API call threshold)
        guard shouldRefreshToken(threshold: foregroundRefreshThreshold) else {
            return
        }

        do {
            try await refreshTokens()
            guard expectedSessionGeneration == authSessionGeneration else { return }
            print("[Auth] Foreground token refresh successful")
        } catch {
            guard expectedSessionGeneration == authSessionGeneration else { return }
            // Only force logout on definitive auth failures.
            if let authError = error as? AuthError {
                switch authError {
                case .tokenExpired, .notAuthenticated, .keychainSaveFailed:
                    print("[Auth] Foreground refresh failed definitively - logging out")
                    logout()
                    return
                default:
                    break
                }
            }

            // Transient failures should not end the session.
            print("[Auth] Foreground refresh failed (transient): \(error.localizedDescription)")
        }
    }

    /// Validate Apple credential state (LOCAL call, no network required)
    /// Returns true if credential is authorized, false if revoked/not found
    private func validateAppleCredential(appleUserId: String) async -> Bool {
        let provider = ASAuthorizationAppleIDProvider()
        do {
            let state = try await provider.credentialState(forUserID: appleUserId)
            switch state {
            case .authorized:
                return true
            case .revoked, .notFound, .transferred:
                print("[Auth] Apple credential state: \(state)")
                return false
            @unknown default:
                return true // Don't logout on unknown states
            }
        } catch {
            // getCredentialState is local, shouldn't fail - don't logout on error
            print("[Auth] validateAppleCredential error: \(error)")
            return true
        }
    }

    // MARK: - Social Auth (Apple)

    private static var currentLocaleIdentifier: String {
        Locale.autoupdatingCurrent.identifier
    }

    private static var currentRegionCode: String? {
        if #available(iOS 16, *) {
            return Locale.autoupdatingCurrent.region?.identifier ?? Locale.current.region?.identifier
        }
        return (Locale.autoupdatingCurrent as NSLocale).object(forKey: .countryCode) as? String
            ?? (Locale.current as NSLocale).object(forKey: .countryCode) as? String
    }

    private static func addRegistrationLocale(to body: inout [String: Any], countryOverride: String? = nil) {
        body["locale"] = currentLocaleIdentifier
        if let country = countryOverride ?? currentRegionCode, !country.isEmpty {
            body["country"] = country.uppercased()
        }
    }

    /// Handle Sign in with Apple
    func handleAppleSignIn(authorization: ASAuthorization, nonce: String) async throws {
        let operation = beginAuthenticationOperation()
        pendingSocialLinkRequest = nil
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let identityToken = credential.identityToken,
              let tokenString = String(data: identityToken, encoding: .utf8) else {
            throw AuthError.serverError("Invalid Apple credential")
        }

        isLoading = true
        defer { isLoading = false }

        let url = URL(string: "\(baseURL)/auth/social")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        var body: [String: Any] = [
            "provider": "apple",
            "id_token": tokenString,
            // Best practice: send the raw nonce so the backend can verify
            // it matches the hashed nonce embedded in the Apple ID token.
            "nonce": nonce
        ]
        Self.addRegistrationLocale(to: &body)

        if let authorizationCode = credential.authorizationCode,
           let authCodeString = String(data: authorizationCode, encoding: .utf8),
           !authCodeString.isEmpty {
            body["authorization_code"] = authCodeString
        }

        // Auto-link pending phone from cross-identifier flow
        if let phone = pendingPhoneLink {
            body["pending_phone_link"] = phone
        }

        // Apple only provides name on first sign-in
        if let fullName = credential.fullName {
            let name = [fullName.givenName, fullName.familyName]
                .compactMap { $0 }
                .joined(separator: " ")
            if !name.isEmpty {
                body["name"] = name
            }
        }

        // Apple provides a stable user identifier; include it for future hardening.
        if !credential.user.isEmpty {
            body["provider_user_id"] = credential.user
        }

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard isAuthenticationOperationCurrent(operation) else { throw CancellationError() }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw AuthError.networkError("Invalid response")
        }

        try await processSocialAuthenticationResponse(
            data: data,
            statusCode: httpResponse.statusCode,
            provider: "apple",
            requestBody: body,
            appleUserIdentifier: credential.user,
            operation: operation
        )
    }

    func processSocialAuthenticationResponse(
        data: Data,
        statusCode: Int,
        provider: String,
        requestBody: [String: Any],
        appleUserIdentifier: String?,
        operation: AuthenticationOperation
    ) async throws {
        guard isAuthenticationOperationCurrent(operation) else { throw CancellationError() }
        switch statusCode {
        case 200, 201:
            if let existing = try? JSONDecoder().decode(SocialAccountExistsResponse.self, from: data),
               existing.accountExists,
               existing.requiresExistingAccountAuthentication {
                pendingSocialLinkRequest = nil
                throw AuthError.existingAccountRequiresAuthentication(
                    maskedEmail: existing.maskedEmail ?? "this email",
                    authMethods: existing.authMethods
                )
            }
            // Check if this is a link confirmation prompt (not a login response)
            if let linkResponse = try? JSONDecoder().decode(LinkConfirmationResponse.self, from: data),
               linkResponse.requiresLinkConfirmation == true {
                pendingSocialLinkRequest = PendingSocialLinkRequest(
                    provider: provider,
                    body: requestBody,
                    appleUserIdentifier: appleUserIdentifier?.isEmpty == false ? appleUserIdentifier : nil
                )
                throw AuthError.requiresLinkConfirmation(
                    provider: linkResponse.provider ?? "apple",
                    maskedEmail: linkResponse.existingAccountEmail ?? "existing account"
                )
            } else {
                let authResponse = try JSONDecoder().decode(AuthResponse.self, from: data)
                try await commitAuthenticatedSession(
                    authResponse,
                    provider: provider,
                    appleUserIdentifier: appleUserIdentifier,
                    operationGeneration: operation.generation,
                    expectedSessionGeneration: operation.sessionGeneration,
                    isOperationCurrent: { [weak self] in
                        self?.isAuthenticationOperationCurrent(operation) == true
                    },
                    onCommitted: { [weak self] in
                        self?.clearPendingMagicLoginAfterRecovery()
                    }
                )
            }

        case 400:
            throw AuthError.serverError("Invalid Apple token")

        default:
            throw AuthError.serverError("\(provider.capitalized) sign-in failed (HTTP \(statusCode))")
        }
    }

    private func clearPendingMagicLoginAfterRecovery() {
        guard let transactionId = pendingMagicLoginPresentation?.transactionId else { return }
        clearMagicLoginPresentation(transactionId: transactionId)
        magicLoginState = .success
    }

    func confirmPendingSocialLink() async throws {
        guard let pending = pendingSocialLinkRequest else {
            throw AuthError.serverError("No pending link confirmation request found.")
        }
        let operation = beginAuthenticationOperation()

        isLoading = true
        defer { isLoading = false }

        let url = URL(string: "\(baseURL)/auth/social")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        var body = pending.body
        body["confirm_link"] = true
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard isAuthenticationOperationCurrent(operation) else { throw CancellationError() }
        guard let httpResponse = response as? HTTPURLResponse else {
            throw AuthError.networkError("Invalid response")
        }
        guard (200...201).contains(httpResponse.statusCode) else {
            throw AuthError.serverError("\(pending.provider.capitalized) sign-in link confirmation failed")
        }

        let authResponse = try JSONDecoder().decode(AuthResponse.self, from: data)
        try await commitAuthenticatedSession(
            authResponse,
            provider: pending.provider,
            appleUserIdentifier: pending.appleUserIdentifier,
            operationGeneration: operation.generation,
            expectedSessionGeneration: operation.sessionGeneration,
            isOperationCurrent: { [weak self] in
                self?.isAuthenticationOperationCurrent(operation) == true
            },
            onCommitted: { [weak self] in
                self?.pendingSocialLinkRequest = nil
                self?.clearPendingMagicLoginAfterRecovery()
            }
        )
    }

    func cancelPendingSocialLink() {
        invalidateAuthenticationOperations()
        pendingSocialLinkRequest = nil
    }

    // MARK: - Phone Auth

    /// Start the phone authentication flow
    /// Sets phoneAuthState to .phoneEntry
    func startPhoneAuth() {
        cancelPhoneAuthenticationCommit()
        invalidateAuthenticationOperations()
        phoneAuthenticationOperation = nil
        phoneNumber = ""
        registrationToken = nil
        phoneAuthState = .phoneEntry
        print("[Auth] Started phone auth flow")
    }

    /// Cancel the phone authentication flow and return to idle
    func cancelPhoneAuth() {
        cancelPhoneAuthenticationCommit()
        invalidateAuthenticationOperations()
        phoneAuthenticationOperation = nil
        phoneNumber = ""
        registrationToken = nil
        phoneAuthState = .idle
        print("[Auth] Cancelled phone auth flow")
    }

    /// Called after verification code is successfully sent
    /// Transitions from phoneEntry to phoneVerification state
    /// - Parameter phoneNumber: Phone number in E.164 format (e.g., +15551234567)
    func onPhoneCodeSent(phoneNumber: String) {
        phoneAuthenticationOperation = beginAuthenticationOperation()
        self.phoneNumber = phoneNumber
        phoneAuthState = .phoneVerification(phoneNumber: phoneNumber)
        print("[Auth] Phone code sent to \(phoneNumber)")
    }

    /// Handle phone verification response
    /// Handle phone verification result.
    /// Existing user → login with tokens.
    /// New user → create account directly (no username step).
    func handlePhoneVerification(
        _ response: VerifyPhoneCodeResponse,
        operation: AuthenticationOperation
    ) async throws {
        guard phoneAuthenticationOperation?.generation == operation.generation,
              isAuthenticationOperationCurrent(operation) else {
            throw CancellationError()
        }
        guard response.verified else {
            throw AuthError.phoneVerificationFailed("Verification failed")
        }

        // Case 1: Existing user - response contains auth tokens
        if let accessToken = response.accessToken,
           let refreshToken = response.refreshToken,
           let userId = response.userId {
            print("[Auth] Phone verification: existing user, logging in")

            let authResponse = AuthResponse(
                userId: userId,
                accessToken: accessToken,
                refreshToken: refreshToken,
                expiresIn: 3600,
                isNewUser: response.isNewUser
            )

            try await commitAuthenticatedSession(
                authResponse,
                provider: "phone",
                operationGeneration: operation.generation,
                expectedSessionGeneration: operation.sessionGeneration,
                isOperationCurrent: { [weak self] in
                    self?.isAuthenticationOperationCurrent(operation) == true
                },
                onCommitted: { [weak self] in
                    self?.phoneAuthState = .idle
                    self?.registrationToken = nil
                    self?.phoneAuthenticationOperation = nil
                }
            )
            print("[Auth] Phone login successful for existing user")
            return
        }

        // Case 2: New user - ask if they have an existing account first
        if let regToken = response.registrationToken {
            print("[Auth] Phone verification: new phone, prompting account check")
            registrationToken = regToken
            phoneAuthenticationOperation = nil
            phoneAuthState = .profileEntry(registrationToken: regToken, phoneNumber: phoneNumber)
            return
        }

        throw AuthError.phoneVerificationFailed("Invalid verification response")
    }

    /// Create phone account with name and optional email
    private func completePhoneRegistrationDirect(registrationToken: String, displayName: String? = nil, email: String? = nil) async throws {
        let operation = beginAuthenticationOperation()
        phoneAuthenticationOperation = operation
        let url = URL(string: "\(baseURL)/auth/phone/register")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0", forHTTPHeaderField: "User-Agent")

        var body: [String: String] = [
            "registration_token": registrationToken,
            "phone_number": phoneNumber,
            "locale": Self.currentLocaleIdentifier,
        ]
        let phoneCountry = normalizedPhoneCountry(phoneNumber)?.id ?? Self.currentRegionCode
        if let phoneCountry, !phoneCountry.isEmpty {
            body["country"] = phoneCountry.uppercased()
        }
        if let name = displayName, !name.isEmpty { body["name"] = name }
        if let email = email, !email.isEmpty { body["email"] = email }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, httpResponse) = try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "phoneRegistration") {
            try await self.session.data(for: request)
        }
        guard isAuthenticationOperationCurrent(operation) else { throw CancellationError() }
        guard let response = httpResponse as? HTTPURLResponse else {
            throw AuthError.networkError("Invalid response")
        }

        // Cross-identifier match: server found existing account linked to this phone
        if response.statusCode == 200 {
            if let accountExists = try? JSONDecoder().decode(AccountExistsResponse.self, from: data),
               accountExists.accountExists {
                phoneAuthState = .accountExists(
                    authMethods: accountExists.authMethods,
                    maskedEmail: accountExists.maskedEmail,
                    maskedPhone: accountExists.maskedPhone,
                    phoneNumber: phoneNumber
                )
                print("[Auth] Cross-identifier match found — prompting user to sign in via existing method")
                return
            }
        }

        if response.statusCode == 409 {
            // Phone already taken (race condition) — parse error
            let errorBody = String(data: data, encoding: .utf8) ?? ""
            if errorBody.contains("E117_PHONE_EXISTS") {
                throw AuthError.registrationFailed("An account with this phone number already exists. Please sign in instead.")
            }
            throw AuthError.registrationFailed("Account conflict. Please try again.")
        }

        guard response.statusCode == 201 else {
            throw AuthError.serverError("Phone registration failed (HTTP \(response.statusCode))")
        }

        let authResponse = try JSONDecoder().decode(AuthResponse.self, from: data)
        try await commitAuthenticatedSession(
            authResponse,
            provider: "phone",
            operationGeneration: operation.generation,
            expectedSessionGeneration: operation.sessionGeneration,
            isOperationCurrent: { [weak self] in
                self?.isAuthenticationOperationCurrent(operation) == true
            },
            onCommitted: { [weak self] in
                self?.phoneAuthState = .idle
                self?.phoneNumber = ""
                self?.registrationToken = nil
                self?.phoneAuthenticationOperation = nil
            }
        )
        print("[Auth] Phone registration completed successfully (no username)")
    }

    /// Complete phone registration with profile info from PhoneProfileEntryView
    func completePhoneRegistration(displayName: String?, email: String?) async throws {
        guard let regToken = registrationToken else {
            throw AuthError.registrationFailed("No registration token available")
        }
        try await completePhoneRegistrationDirect(registrationToken: regToken, displayName: displayName, email: email)
    }

    /// Store a verified phone number for auto-linking after cross-identifier sign-in
    func setPendingPhoneLink(_ phone: String) {
        pendingPhoneLink = phone
        print("[Auth] Pending phone link set: \(phone.prefix(4))****")
    }

    /// Go back one step in phone auth flow
    func phoneAuthGoBack() {
        cancelPhoneAuthenticationCommit()
        invalidateAuthenticationOperations()
        phoneAuthenticationOperation = nil
        switch phoneAuthState {
        case .idle:
            break
        case .phoneEntry:
            phoneAuthState = .idle
        case .phoneVerification:
            phoneAuthState = .phoneEntry
        case .profileEntry:
            phoneAuthState = .phoneEntry
            registrationToken = nil
        case .accountExists(_, _, _, let phone):
            // Preserve phone for auto-link in case user signs in via another method
            setPendingPhoneLink(phone)
            phoneAuthState = .phoneEntry
            registrationToken = nil
        }
        print("[Auth] Phone auth went back to: \(phoneAuthState)")
    }

    // MARK: - Token Refresh

    /// Refresh the access token using refresh token
    /// Implements graceful error handling:
    /// - Only logs out on definitive token rejection (reuse, revoked)
    /// - Network/server errors don't trigger logout (token may still be valid)
    /// - Deduplicates concurrent refresh calls (all callers await the same task)
    /// - Uses refreshLock for atomic check-and-set to prevent race conditions
    /// - Wraps refresh in BackgroundTaskManager for iOS background protection
    @discardableResult
    func refreshTokens() async throws -> String {
        // Atomic check-and-set: prevent race where two threads both see nil
        // and create duplicate refresh tasks
        if let existingTask = refreshLock.withLock({ refreshTask }) {
            print("[Auth] Refresh already in progress, awaiting existing task")
            return try await existingTask.value
        }

        // Create a new refresh task with background execution protection
        // This prevents iOS from suspending the app mid-refresh, which would
        // leave tokens in an inconsistent state
        let taskID = UUID()
        let expectedSessionGeneration = authSessionGeneration
        let task = Task<String, Error> {
            try await BackgroundTaskManager.shared.executeWithBackgroundTime(taskName: "tokenRefresh") {
                try await self.performRefresh(expectedSessionGeneration: expectedSessionGeneration)
            }
        }
        refreshLock.withLock {
            refreshTask = task
            refreshTaskID = taskID
        }

        // Await the refresh and clear the task reference AFTER completion
        // This is critical: defer would clear it BEFORE await completes,
        // allowing duplicate tasks to be created during execution
        do {
            let refreshedToken = try await task.value
            clearRefreshTask(ifOwnedBy: taskID)
            return refreshedToken
        } catch {
            clearRefreshTask(ifOwnedBy: taskID)
            throw error
        }
    }

    /// Internal refresh implementation - called only by the deduplicated wrapper
    private func performRefresh(expectedSessionGeneration: UInt64) async throws -> String {
        // Never rotate server-side tokens if keychain writes may fail (locked device).
        // Rotating without persisting the replacement token can orphan the session.
        if !UIApplication.shared.isProtectedDataAvailable {
            print("[Auth] Protected data unavailable - deferring token refresh")
            throw AuthError.networkError("Protected data unavailable")
        }

        let refreshToken = tokenLock.withLock { () -> String? in
            if let cachedRefreshToken, !cachedRefreshToken.isEmpty {
                return cachedRefreshToken
            }
            let storedRefreshToken = KeychainHelper.loadString(key: Self.refreshTokenKey)
            cachedRefreshToken = storedRefreshToken
            return storedRefreshToken
        }

        guard let refreshToken else {
            // Keychain can be transiently unavailable; don't hard-logout immediately.
            if !UIApplication.shared.isProtectedDataAvailable {
                print("[Auth] Refresh token unavailable while protected data is locked")
                throw AuthError.networkError("Protected data unavailable")
            }

            let hasAccessToken = tokenLock.withLock {
                if let cachedAccessToken, !cachedAccessToken.isEmpty {
                    return true
                }
                let storedAccessToken = KeychainHelper.loadString(key: Self.accessTokenKey)
                cachedAccessToken = storedAccessToken
                return storedAccessToken != nil
            }
            if hasAccessToken {
                print("[Auth] Refresh token unavailable but access token exists - treating as transient")
                throw AuthError.serverError("Refresh token temporarily unavailable")
            }

            print("[Auth] No auth tokens available during refresh - not authenticated")
            throw AuthError.notAuthenticated
        }

        print("[Auth] Starting token refresh...")

        let url = URL(string: "\(baseURL)/auth/refresh")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = ["refresh_token": refreshToken]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let data: Data
        let response: URLResponse

        do {
            (data, response) = try await session.data(for: request)
        } catch {
            // Network error - don't logout, token might still be valid
            throw AuthError.networkError("Refresh request failed: \(error.localizedDescription)")
        }
        try Task.checkCancellation()
        guard expectedSessionGeneration == authSessionGeneration,
              currentRefreshToken() == refreshToken else {
            throw CancellationError()
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw AuthError.networkError("Invalid response")
        }

        switch httpResponse.statusCode {
        case 200:
            let refreshResponse = try JSONDecoder().decode(RefreshResponse.self, from: data)
            do {
                try saveRefreshedTokens(
                    refreshResponse,
                    expectedRefreshToken: refreshToken,
                    expectedSessionGeneration: expectedSessionGeneration
                )
            } catch AuthError.keychainSaveFailed {
                print("[Auth] Failed to persist refreshed tokens - forcing re-auth")
                throw AuthError.notAuthenticated
            }
            print("[Auth] Token refresh successful")
            return refreshResponse.accessToken

        case 401:
            print("[Auth] Refresh returned 401")
            // Check if this is a definitive rejection (token reuse, revoked)
            // vs a temporary issue we should retry
            if let errorBody = try? JSONDecoder().decode(RefreshErrorResponse.self, from: data) {
                print("[Auth] Refresh error: \(errorBody.error ?? "unknown") - \(errorBody.message ?? "no message")")

                // TOKEN_ALREADY_ROTATED is special: it means a concurrent refresh succeeded
                // If there's a refresh task in flight, await it to get the new token
                // This handles edge cases from the server-side race condition fix
                if errorBody.error == "TOKEN_ALREADY_ROTATED" {
                    print("[Auth] TOKEN_ALREADY_ROTATED - concurrent refresh likely succeeded")

                    // Check if we now have a valid token (with lock for atomic read)
                    let hasValidToken = tokenLock.withLock {
                        let currentToken: String? = {
                            if let cachedAccessToken, !cachedAccessToken.isEmpty {
                                return cachedAccessToken
                            }
                            let storedAccessToken = KeychainHelper.loadString(key: Self.accessTokenKey)
                            cachedAccessToken = storedAccessToken
                            return storedAccessToken
                        }()

                        let expiryEpoch: Double? = {
                            if let cachedTokenExpiryEpoch {
                                return cachedTokenExpiryEpoch
                            }
                            guard let expiryString = KeychainHelper.loadString(key: Self.tokenExpiryKey),
                                  let expiry = Double(expiryString) else {
                                return nil
                            }
                            cachedTokenExpiryEpoch = expiry
                            return expiry
                        }()

                        guard let currentToken, !currentToken.isEmpty, let expiryEpoch else {
                            return false
                        }
                        return Date(timeIntervalSince1970: expiryEpoch).timeIntervalSinceNow > 60
                    }

                    if hasValidToken {
                        print("[Auth] Found valid token after TOKEN_ALREADY_ROTATED - continuing without logout")
                        if let token = tokenLock.withLock({
                            if let cachedAccessToken, !cachedAccessToken.isEmpty {
                                return cachedAccessToken
                            }
                            let storedAccessToken = KeychainHelper.loadString(key: Self.accessTokenKey)
                            cachedAccessToken = storedAccessToken
                            return storedAccessToken
                        }) {
                            return token
                        }
                        throw AuthError.notAuthenticated
                    }

                    // Server reports this refresh token is already rotated and we have no valid access token.
                    // Recovery is not possible client-side; require explicit sign-in.
                    print("[Auth] No valid token after TOKEN_ALREADY_ROTATED - requiring re-auth")
                    throw AuthError.tokenExpired
                }

                // These errors mean the token is definitively invalid - must re-login
                let definitiveErrors = [
                    "TOKEN_REUSE_DETECTED",
                    "TOKEN_REVOKED",
                    "TOKEN_EXPIRED",
                    "INVALID_TOKEN",
                    "INVALID_REFRESH_TOKEN",
                    "TOKEN_FAMILY_COMPROMISED",
                    "SESSION_REVOKED",
                    "SESSION_EXPIRED"
                ]

                if definitiveErrors.contains(errorBody.error ?? "") {
                    print("[Auth] Definitive token rejection: \(errorBody.error ?? "unknown")")
                    throw AuthError.tokenExpired
                }
            }
            // For other 401s, don't immediately logout - could be transient
            // The next API call will also fail and can trigger logout then
            throw AuthError.serverError("Token refresh failed (401)")

        case 500...599:
            // Server error - don't logout, this is likely temporary
            throw AuthError.serverError("Server error during refresh")

        default:
            throw AuthError.serverError("Token refresh failed (HTTP \(httpResponse.statusCode))")
        }
    }

    /// Response structure for refresh errors
    private struct RefreshErrorResponse: Codable {
        let error: String?
        let message: String?
    }

    // MARK: - Logout

    /// Logout and clear all stored credentials
    func logout() {
        // Log the logout for debugging unexpected logouts
        // In production, this helps Crashlytics track logout patterns
        let provider = KeychainHelper.loadString(key: Self.authProviderKey) ?? "unknown"
        print("[Auth] logout() called - provider: \(provider)")
        #if DEBUG
        // In debug builds, log the call stack to help trace unexpected logouts
        Thread.callStackSymbols.prefix(8).forEach { print("[Auth] Stack: \($0)") }
        #endif

        authSessionGeneration &+= 1
        invalidateAuthenticationOperations()
        cancelRefreshTask()
        activeAuthenticationCommitID = nil
        activeAuthenticationOperationGeneration = nil
        isCommittingAuthenticationSession = false

        // Call logout endpoint (fire and forget)
        let accessTokenForLogout = tokenLock.withLock { () -> String? in
            if let cachedAccessToken, !cachedAccessToken.isEmpty {
                return cachedAccessToken
            }
            let storedToken = KeychainHelper.loadString(key: Self.accessTokenKey)
            cachedAccessToken = storedToken
            return storedToken
        }
        if let token = accessTokenForLogout {
            Task {
                let url = URL(string: "\(baseURL)/auth/logout")!
                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                _ = try? await session.data(for: request)
            }
        }

        // Clear local state
        KeychainHelper.delete(key: Self.accessTokenKey)
        KeychainHelper.delete(key: Self.refreshTokenKey)
        KeychainHelper.delete(key: Self.tokenExpiryKey)
        KeychainHelper.delete(key: Self.userIdKey)
        KeychainHelper.delete(key: Self.deviceTokenKey)
        KeychainHelper.delete(key: Self.deviceTokenExpiryKey)
        KeychainHelper.delete(key: Self.appleUserIdKey)
        KeychainHelper.delete(key: Self.authProviderKey)
        KeychainHelper.delete(key: Self.authBundleMutationMarkerKey)
        KeychainHelper.delete(key: Self.pendingPhoneLinkKey)
        KeychainHelper.delete(key: Self.pendingPhoneLinkExpiryKey)
        cancelMagicOperations()
        PendingMagicLoginStore.removeAll()
        MagicLoginPresentationStore.remove()
        pendingMagicLoginPresentation = nil
        PendingSuggestionStore.clear()
        tokenLock.withLock {
            cachedAccessToken = nil
            cachedRefreshToken = nil
            cachedTokenExpiryEpoch = nil
            cachedUserId = nil
        }
        pendingPhoneLink = nil
        pendingSocialLinkRequest = nil

        isAuthenticated = false
        hasValidatedSession = false
        needsProfileCompletion = false
        currentUser = nil

        // Disassociate device from OneSignal user so marketing pushes stop
        OneSignal.logout()

    }

    // MARK: - Current User

    /// Fetch current user details
    /// - Parameter retryCount: Internal retry counter to prevent infinite recursion (max 2 attempts)
    func fetchCurrentUser(
        retryCount: Int = 0,
        expectedUserId: String? = nil,
        sessionGeneration: UInt64? = nil,
        accessTokenOverride: String? = nil
    ) async throws {
        let expectedSessionGeneration = sessionGeneration ?? authSessionGeneration
        // Prevent infinite recursion if server returns corrupted tokens
        guard retryCount < 2 else {
            print("[Auth] fetchCurrentUser exceeded retry limit (\(retryCount) attempts)")
            throw AuthError.tokenExpired
        }

        let token: String
        if let accessTokenOverride {
            token = accessTokenOverride
        } else {
            guard let storedToken = try await getAccessToken() else {
                throw AuthError.notAuthenticated
            }
            token = storedToken
        }

        do {
            let user = try await fetchValidatedUser(
                accessToken: token,
                expectedUserId: expectedUserId
            )
            guard expectedSessionGeneration == authSessionGeneration else {
                throw CancellationError()
            }
            publishValidatedUser(user)
            OneSignal.login(user.id)
            await LocalNotificationService.shared.ensureAuthorizedForAuthenticatedUser()
            print("[Auth] fetchCurrentUser success: user=\(user.id)")
        } catch AuthError.notAuthenticated {
            // A just-issued magic-login token must validate as issued. Do not
            // enter the normal refresh path before the new session is public.
            guard accessTokenOverride == nil else {
                throw AuthError.notAuthenticated
            }
            guard expectedSessionGeneration == authSessionGeneration else {
                throw CancellationError()
            }
            // Token expired, try refresh
            print("[Auth] fetchCurrentUser got 401 (attempt \(retryCount + 1)/2), attempting refresh")
            try await refreshTokens()
            guard expectedSessionGeneration == authSessionGeneration else {
                throw CancellationError()
            }
            try await fetchCurrentUser(
                retryCount: retryCount + 1,
                expectedUserId: expectedUserId,
                sessionGeneration: expectedSessionGeneration,
                accessTokenOverride: nil
            )
        }
    }

    // MARK: - Profile Completion

    /// Update current user after a successful profile update
    func updateCurrentUser(_ user: AuthUser) {
        currentUser = user
        needsProfileCompletion = user.needsProfileCompletion
    }

    // MARK: - Account Deletion

    /// Delete user account and all associated data
    /// This is irreversible and required for App Store compliance
    func deleteAccount() async throws {
        let token = tokenLock.withLock { () -> String? in
            if let cachedAccessToken, !cachedAccessToken.isEmpty {
                return cachedAccessToken
            }
            let storedToken = KeychainHelper.loadString(key: Self.accessTokenKey)
            cachedAccessToken = storedToken
            return storedToken
        }

        guard let token else {
            throw AuthError.notAuthenticated
        }

        isLoading = true
        defer { isLoading = false }

        let url = URL(string: "\(baseURL)/auth/delete-account")!
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (_, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw AuthError.networkError("Invalid response")
        }

        switch httpResponse.statusCode {
        case 200, 204:
            // Account deleted successfully, clear local state
            logout()

        case 401:
            throw AuthError.tokenExpired

        case 403:
            throw AuthError.serverError("Account deletion not permitted")

        default:
            throw AuthError.serverError("Account deletion failed (HTTP \(httpResponse.statusCode))")
        }
    }

    // MARK: - Private Helpers

    func beginAuthenticationOperation() -> AuthenticationOperation {
        authenticationOperationGeneration &+= 1
        return AuthenticationOperation(
            generation: authenticationOperationGeneration,
            sessionGeneration: authSessionGeneration
        )
    }

    private func invalidateAuthenticationOperations() {
        authenticationOperationGeneration &+= 1
    }

    private func cancelPhoneAuthenticationCommit() {
        guard let operation = phoneAuthenticationOperation,
              activeAuthenticationOperationGeneration == operation.generation else { return }
        activeAuthenticationCommitID = nil
        activeAuthenticationOperationGeneration = nil
        isCommittingAuthenticationSession = false
    }

    private func isAuthenticationOperationCurrent(_ operation: AuthenticationOperation) -> Bool {
        !Task.isCancelled
            && operation.generation == authenticationOperationGeneration
            && operation.sessionGeneration == authSessionGeneration
    }

    private func currentRefreshToken() -> String? {
        tokenLock.withLock {
            if let cachedRefreshToken, !cachedRefreshToken.isEmpty {
                return cachedRefreshToken
            }
            let stored = KeychainHelper.loadString(key: Self.refreshTokenKey)
            cachedRefreshToken = stored
            return stored
        }
    }

    private func cancelRefreshTask() {
        let task = refreshLock.withLock { () -> Task<String, Error>? in
            let task = refreshTask
            refreshTask = nil
            refreshTaskID = nil
            return task
        }
        task?.cancel()
    }

    private func clearRefreshTask(ifOwnedBy taskID: UUID) {
        refreshLock.withLock {
            guard refreshTaskID == taskID else { return }
            refreshTask = nil
            refreshTaskID = nil
        }
    }

    /// Validates newly issued credentials and publishes them as one owned session.
    /// No durable or observable authentication state changes before `/auth/me`
    /// confirms that the access token belongs to the expected user.
    @discardableResult
    func commitAuthenticatedSession(
        _ response: AuthResponse,
        provider: String,
        appleUserIdentifier: String? = nil,
        operationGeneration: UInt64? = nil,
        expectedSessionGeneration: UInt64? = nil,
        isOperationCurrent: () -> Bool = { true },
        onCommitted: () -> Void = {}
    ) async throws -> UInt64 {
        let startingSessionGeneration = expectedSessionGeneration ?? authSessionGeneration
        guard startingSessionGeneration == authSessionGeneration, isOperationCurrent() else {
            throw CancellationError()
        }

        // The latest valid sign-in attempt owns publication. Replacing this ID
        // makes an older validator fail its post-await ownership check without
        // allowing its defer to clear the newer attempt's resolving state.
        let commitID = UUID()
        activeAuthenticationCommitID = commitID
        activeAuthenticationOperationGeneration = operationGeneration
        isCommittingAuthenticationSession = true
        defer {
            if activeAuthenticationCommitID == commitID {
                activeAuthenticationCommitID = nil
                activeAuthenticationOperationGeneration = nil
                isCommittingAuthenticationSession = false
            }
        }

        let user = try await fetchValidatedUser(
            accessToken: response.accessToken,
            expectedUserId: response.userId
        )
        try Task.checkCancellation()
        guard activeAuthenticationCommitID == commitID,
              startingSessionGeneration == authSessionGeneration,
              isOperationCurrent() else {
            throw CancellationError()
        }

        cancelRefreshTask()
        let committedSessionGeneration = try saveAuthenticationBundle(
            response,
            provider: provider,
            appleUserIdentifier: appleUserIdentifier
        )
        onCommitted()
        publishValidatedUser(user)
        isAuthenticated = true

        AnalyticsService.shared.logAuthenticated(
            .authCompleted,
            properties: ["method": provider, "userId": user.id],
            accessToken: response.accessToken
        )
        OneSignal.login(user.id)
        Task {
            await LocalNotificationService.shared.ensureAuthorizedForAuthenticatedUser()
        }
        return committedSessionGeneration
    }

    private func fetchValidatedUser(
        accessToken: String,
        expectedUserId: String?
    ) async throws -> AuthUser {
        let url = URL(string: "\(baseURL)/auth/me")!
        var request = URLRequest(url: url)
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await session.data(for: request)
        try Task.checkCancellation()
        guard let httpResponse = response as? HTTPURLResponse else {
            throw AuthError.networkError("Invalid response")
        }
        guard httpResponse.statusCode == 200 else {
            if httpResponse.statusCode == 401 {
                throw AuthError.notAuthenticated
            }
            throw AuthError.serverError("Failed to fetch user (HTTP \(httpResponse.statusCode))")
        }

        let user = try JSONDecoder().decode(AuthUser.self, from: data)
        if let expectedUserId, user.id != expectedUserId {
            throw AuthError.serverError("Authenticated account did not match the issued session.")
        }
        return user
    }

    private func publishValidatedUser(_ user: AuthUser) {
        currentUser = user
        needsProfileCompletion = user.needsProfileCompletion
        hasValidatedSession = true
        pendingPhoneLink = nil
    }

    /// Saves the complete restorable identity atomically. Provider metadata is
    /// part of the credential bundle because cold-start validation depends on it.
    @discardableResult
    private func saveAuthenticationBundle(
        _ response: AuthResponse,
        provider: String,
        appleUserIdentifier: String?
    ) throws -> UInt64 {
        if provider == "apple" && (appleUserIdentifier?.isEmpty != false) {
            throw AuthError.keychainSaveFailed
        }
        try tokenLock.withLock {
            let expiry = Date.now.addingTimeInterval(TimeInterval(response.expiresIn))
            let values: [(String, String?)] = [
                (Self.accessTokenKey, response.accessToken),
                (Self.refreshTokenKey, response.refreshToken),
                (Self.userIdKey, response.userId),
                (Self.tokenExpiryKey, String(expiry.timeIntervalSince1970)),
                (Self.authProviderKey, provider),
                (Self.appleUserIdKey, provider == "apple" ? appleUserIdentifier : nil)
            ]

            guard saveAuthChangesWithRollback(values) else {
                print("[Auth] ERROR: Failed to save authentication bundle to keychain")
                throw AuthError.keychainSaveFailed
            }

            cachedAccessToken = response.accessToken
            cachedRefreshToken = response.refreshToken
            cachedTokenExpiryEpoch = expiry.timeIntervalSince1970
            cachedUserId = response.userId
        }

        authSessionGeneration &+= 1
        currentUser = nil
        hasValidatedSession = false
        needsProfileCompletion = false

        print("[Auth] Authentication bundle saved successfully")
        return authSessionGeneration
    }

    /// Saves refreshed tokens atomically using tokenLock
    /// This prevents race conditions where another thread reads partial state
    private func saveRefreshedTokens(
        _ response: RefreshResponse,
        expectedRefreshToken: String,
        expectedSessionGeneration: UInt64
    ) throws {
        guard expectedSessionGeneration == authSessionGeneration else {
            throw CancellationError()
        }
        try tokenLock.withLock {
            let currentRefreshToken = cachedRefreshToken
                ?? KeychainHelper.loadString(key: Self.refreshTokenKey)
            guard currentRefreshToken == expectedRefreshToken else {
                throw CancellationError()
            }
            let expiry = Date.now.addingTimeInterval(TimeInterval(response.expiresIn))
            let values: [(String, String)] = [
                (Self.accessTokenKey, response.accessToken),
                (Self.refreshTokenKey, response.refreshToken),
                (Self.tokenExpiryKey, String(expiry.timeIntervalSince1970))
            ]

            guard saveAuthValuesWithRollback(values) else {
                print("[Auth] ERROR: Failed to save refreshed tokens to keychain")
                throw AuthError.keychainSaveFailed
            }

            cachedAccessToken = response.accessToken
            cachedRefreshToken = response.refreshToken
            cachedTokenExpiryEpoch = expiry.timeIntervalSince1970
        }

        print("[Auth] Refreshed tokens saved; expires in \(response.expiresIn)s")
    }

    /// Saves a batch of auth values and restores previous values if any write fails.
    /// Must be called with `tokenLock` already held.
    private func saveAuthValuesWithRollback(_ values: [(String, String)]) -> Bool {
        saveAuthChangesWithRollback(values.map { ($0.0, Optional($0.1)) })
    }

    private func saveAuthChangesWithRollback(_ values: [(String, String?)]) -> Bool {
        guard KeychainHelper.saveString(
            key: Self.authBundleMutationMarkerKey,
            value: UUID().uuidString
        ) else {
            return false
        }
        var previousValues: [String: String?] = [:]
        previousValues.reserveCapacity(values.count)

        for (key, _) in values {
            previousValues[key] = KeychainHelper.loadString(key: key)
        }

        for (key, value) in values {
            let saved: Bool
            if let value {
                saved = KeychainHelper.saveString(key: key, value: value)
            } else {
                saved = KeychainHelper.delete(key: key)
            }
            guard saved else {
                print("[Auth] Keychain write failed for \(key), restoring previous auth values")
                if restoreAuthValues(previousValues) {
                    KeychainHelper.delete(key: Self.authBundleMutationMarkerKey)
                }
                return false
            }
        }

        guard KeychainHelper.delete(key: Self.authBundleMutationMarkerKey) else {
            _ = restoreAuthValues(previousValues)
            return false
        }
        return true
    }

    private func restoreAuthValues(_ values: [String: String?]) -> Bool {
        values.reduce(true) { restored, item in
            let itemRestored: Bool
            if let previousValue = item.value {
                itemRestored = KeychainHelper.saveString(key: item.key, value: previousValue)
            } else {
                itemRestored = KeychainHelper.delete(key: item.key)
            }
            return restored && itemRestored
        }
    }
}

// MARK: - Error Response

private struct ErrorResponse: Codable {
    let error: String?
    let message: String?
}
