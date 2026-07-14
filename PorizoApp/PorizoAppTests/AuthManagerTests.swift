//
//  AuthManagerTests.swift
//  PorizoAppTests
//
//  Tests for AuthManager - authentication state and session lifecycle.
//

import XCTest
import Security
@testable import PorizoApp

private final class AuthManagerURLProtocolStub: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    private nonisolated(unsafe) static var response: (status: Int, data: Data)?
    private nonisolated(unsafe) static var responseProvider: (@Sendable (URLRequest) -> (status: Int, data: Data))?
    private nonisolated(unsafe) static var holdsResponses = false
    private nonisolated(unsafe) static var heldRequests: [AuthManagerURLProtocolStub] = []

    static func configure(status: Int = 200, data: Data, holdResponse: Bool = false) {
        lock.withLock {
            response = (status, data)
            responseProvider = nil
            holdsResponses = holdResponse
        }
    }

    static func configure(
        holdResponse: Bool = false,
        responseProvider: @escaping @Sendable (URLRequest) -> (status: Int, data: Data)
    ) {
        lock.withLock {
            response = nil
            self.responseProvider = responseProvider
            holdsResponses = holdResponse
        }
    }

    static func reset() {
        let pending = lock.withLock { () -> [AuthManagerURLProtocolStub] in
            response = nil
            responseProvider = nil
            holdsResponses = false
            defer { heldRequests.removeAll() }
            return heldRequests
        }
        pending.forEach { request in
            request.client?.urlProtocol(request, didFailWithError: URLError(.cancelled))
        }
    }

    static var heldRequestCount: Int {
        lock.withLock { heldRequests.count }
    }

    static func allowNewRequests() {
        lock.withLock { holdsResponses = false }
    }

    static func releaseHeldRequests(path: String? = nil) {
        let release = lock.withLock { () -> [AuthManagerURLProtocolStub] in
            holdsResponses = false
            let matching = heldRequests.filter { path == nil || $0.request.url?.path == path }
            heldRequests.removeAll { request in matching.contains { $0 === request } }
            return matching
        }
        release.forEach { request in
            guard let configured = configuredResponse(for: request.request) else { return }
            request.deliver(configured)
        }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let configured = Self.lock.withLock { () -> (status: Int, data: Data)? in
            if Self.holdsResponses {
                Self.heldRequests.append(self)
                return nil
            }
            return Self.configuredResponse(for: request)
        }
        guard let configured else { return }
        deliver(configured)
    }

    private func deliver(_ configured: (status: Int, data: Data)) {
        guard
              let url = request.url,
              let response = HTTPURLResponse(
                url: url,
                statusCode: configured.status,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
              ) else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: configured.data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    private static func configuredResponse(for request: URLRequest) -> (status: Int, data: Data)? {
        responseProvider?(request) ?? response
    }
}

private actor ControllableMagicLoginAPI: MagicLoginAPI {
    enum TestError: Error {
        case intentionalExchangeFailure
        case unsupported
    }

    private var statusContinuation: CheckedContinuation<MagicLoginNativeStatusResponse, Error>?
    private var statusStarted = false
    private var requestContinuation: CheckedContinuation<MagicLoginRequestResponse, Error>?
    private var requestStarted = false
    private var exchangeContinuations: [CheckedContinuation<MagicLoginExchangeResponse, Error>] = []
    private var exchangeStarted = false
    private(set) var exchangeCallCount = 0
    private(set) var exchangeLinkSecrets: [String] = []
    private(set) var completionCallCount = 0
    var holdExchange = false
    private var exchangeResponse: MagicLoginExchangeResponse?
    private var completionResponse: MagicLoginExchangeResponse?

    func requestMagicLogin(
        email: String,
        purpose: MagicLoginPurpose,
        requesterKey: String,
        bearerToken: String?
    ) async throws -> MagicLoginRequestResponse {
        requestStarted = true
        return try await withCheckedThrowingContinuation { continuation in
            requestContinuation = continuation
        }
    }

    func exchangeMagicLogin(
        transactionId: String,
        linkSecret: String,
        requestSecret: String
    ) async throws -> MagicLoginExchangeResponse {
        exchangeCallCount += 1
        exchangeLinkSecrets.append(linkSecret)
        exchangeStarted = true
        if let exchangeResponse { return exchangeResponse }
        if holdExchange {
            return try await withCheckedThrowingContinuation { continuation in
                exchangeContinuations.append(continuation)
            }
        }
        throw TestError.intentionalExchangeFailure
    }

    func magicLoginNativeStatus(
        transactionId: String,
        requestSecret: String
    ) async throws -> MagicLoginNativeStatusResponse {
        statusStarted = true
        return try await withCheckedThrowingContinuation { continuation in
            statusContinuation = continuation
        }
    }

    func completeApprovedMagicLogin(
        transactionId: String,
        requestSecret: String
    ) async throws -> MagicLoginExchangeResponse {
        completionCallCount += 1
        if let completionResponse { return completionResponse }
        throw TestError.unsupported
    }

    func hasStatusStarted() -> Bool {
        statusStarted
    }

    func hasRequestStarted() -> Bool {
        requestStarted
    }

    func hasExchangeStarted() -> Bool {
        exchangeStarted
    }

    func setHoldExchange(_ value: Bool) {
        holdExchange = value
    }

    func setExchangeResponse(_ response: MagicLoginExchangeResponse) {
        exchangeResponse = response
    }

    func setCompletionResponse(_ response: MagicLoginExchangeResponse) {
        completionResponse = response
    }

    func releaseStatus(as status: MagicLoginNativeStatus) {
        statusContinuation?.resume(returning: MagicLoginNativeStatusResponse(
            status: status,
            expiresAt: nil
        ))
        statusContinuation = nil
    }

    func releaseRequest(transactionId: String) {
        requestContinuation?.resume(returning: MagicLoginRequestResponse(
            transactionId: transactionId,
            requestSecret: "request_secret",
            expiresAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(600))
        ))
        requestContinuation = nil
    }

    func failHeldExchange() {
        let continuations = exchangeContinuations
        exchangeContinuations.removeAll()
        continuations.forEach { $0.resume(throwing: TestError.intentionalExchangeFailure) }
    }
}

final class AuthManagerTests: XCTestCase {

    override func tearDown() {
        super.tearDown()
        MagicLoginPresentationStore.remove()
        PendingMagicLoginStore.removeAll()
        PendingSuggestionStore.clear()
        KeychainHelper.delete(key: "porizo_pending_phone_link")
        KeychainHelper.delete(key: "porizo_pending_phone_link_expiry")
        KeychainHelper.delete(key: "porizo_access_token")
        KeychainHelper.delete(key: "porizo_refresh_token")
        KeychainHelper.delete(key: "porizo_token_expiry")
        KeychainHelper.delete(key: "porizo_auth_user_id")
        KeychainHelper.delete(key: "porizo_auth_provider")
        KeychainHelper.delete(key: "porizo_apple_user_id")
        KeychainHelper.delete(key: "porizo_auth_bundle_mutating")
        KeychainHelper.delete(key: "porizo_device_token")
        KeychainHelper.delete(key: "porizo_device_token_expiry")
        AuthManagerURLProtocolStub.reset()
    }

    @MainActor
    func testAuthenticationCommitDoesNotPublishOrPersistBeforeValidation() async throws {
        let userId = "user_delayed_commit"
        let authManager = AuthManager(session: makeCurrentUserSession(userId: userId, holdResponse: true))
        let commit = Task { @MainActor in
            try await authManager.commitAuthenticatedSession(
                successfulAuthResponse(userId: userId),
                provider: "email_magic"
            )
        }

        let validationStarted = await waitUntil { AuthManagerURLProtocolStub.heldRequestCount == 1 }
        XCTAssertTrue(validationStarted)
        XCTAssertTrue(authManager.isCommittingAuthenticationSession)
        XCTAssertFalse(authManager.isAuthenticated)
        XCTAssertNil(authManager.currentUser)
        XCTAssertNil(KeychainHelper.loadString(key: "porizo_access_token"))
        XCTAssertNil(KeychainHelper.loadString(key: "porizo_auth_provider"))

        AuthManagerURLProtocolStub.releaseHeldRequests()
        _ = try await commit.value

        XCTAssertFalse(authManager.isCommittingAuthenticationSession)
        XCTAssertTrue(authManager.isAuthenticated)
        XCTAssertEqual(authManager.currentUser?.id, userId)
        XCTAssertEqual(KeychainHelper.loadString(key: "porizo_access_token"), "issued_access_token")
        XCTAssertEqual(KeychainHelper.loadString(key: "porizo_auth_provider"), "email_magic")
    }

    @MainActor
    func testAuthenticationCommitFailurePersistsNothing() async throws {
        let authManager = AuthManager(session: makeCurrentUserSession(userId: "unused", status: 500))

        do {
            try await authManager.commitAuthenticatedSession(
                successfulAuthResponse(userId: "rejected_user"),
                provider: "apple",
                appleUserIdentifier: "apple_user"
            )
            XCTFail("Expected validation to fail")
        } catch {
            XCTAssertFalse(error is CancellationError)
        }

        XCTAssertFalse(authManager.isCommittingAuthenticationSession)
        XCTAssertFalse(authManager.isAuthenticated)
        XCTAssertNil(authManager.currentUser)
        XCTAssertNil(KeychainHelper.loadString(key: "porizo_access_token"))
        XCTAssertNil(KeychainHelper.loadString(key: "porizo_refresh_token"))
        XCTAssertNil(KeychainHelper.loadString(key: "porizo_auth_provider"))
        XCTAssertNil(KeychainHelper.loadString(key: "porizo_apple_user_id"))
    }

    @MainActor
    func testAuthenticationCommitRejectsMismatchedValidatedUser() async throws {
        let authManager = AuthManager(session: makeCurrentUserSession(userId: "different_user"))

        do {
            try await authManager.commitAuthenticatedSession(
                successfulAuthResponse(userId: "issued_user"),
                provider: "email_magic"
            )
            XCTFail("Expected identity mismatch to fail")
        } catch let error as AuthError {
            guard case .serverError = error else {
                return XCTFail("Expected identity mismatch serverError")
            }
        }

        XCTAssertFalse(authManager.isAuthenticated)
        XCTAssertFalse(authManager.isCommittingAuthenticationSession)
        XCTAssertNil(KeychainHelper.loadString(key: "porizo_access_token"))
        XCTAssertNil(KeychainHelper.loadString(key: "porizo_auth_provider"))
    }

    @MainActor
    func testSupersededProviderOperationCannotPublishAuthentication() async throws {
        let userId = "user_superseded_commit"
        let authManager = AuthManager(session: makeCurrentUserSession(userId: userId, holdResponse: true))
        var operationIsCurrent = true
        let commit = Task { @MainActor in
            try await authManager.commitAuthenticatedSession(
                successfulAuthResponse(userId: userId),
                provider: "email_magic",
                isOperationCurrent: { operationIsCurrent }
            )
        }

        let validationStarted = await waitUntil { AuthManagerURLProtocolStub.heldRequestCount == 1 }
        XCTAssertTrue(validationStarted)
        operationIsCurrent = false
        AuthManagerURLProtocolStub.releaseHeldRequests()

        do {
            _ = try await commit.value
            XCTFail("Expected superseded provider operation to fail")
        } catch {
            XCTAssertTrue(error is CancellationError)
        }
        XCTAssertFalse(authManager.isAuthenticated)
        XCTAssertFalse(authManager.isCommittingAuthenticationSession)
        XCTAssertNil(KeychainHelper.loadString(key: "porizo_access_token"))
    }

    @MainActor
    func testLogoutInvalidatesAuthenticationCommitWithoutClearingNewerState() async throws {
        let userId = "user_logout_race"
        let authManager = AuthManager(session: makeCurrentUserSession(userId: userId, holdResponse: true))
        let commit = Task { @MainActor in
            try await authManager.commitAuthenticatedSession(
                successfulAuthResponse(userId: userId),
                provider: "email_magic"
            )
        }

        let validationStarted = await waitUntil { AuthManagerURLProtocolStub.heldRequestCount == 1 }
        XCTAssertTrue(validationStarted)
        authManager.logout()
        AuthManagerURLProtocolStub.releaseHeldRequests()

        do {
            _ = try await commit.value
            XCTFail("Expected the invalidated commit to fail")
        } catch {
            XCTAssertTrue(error is CancellationError)
        }
        XCTAssertFalse(authManager.isCommittingAuthenticationSession)
        XCTAssertFalse(authManager.isAuthenticated)
        XCTAssertNil(KeychainHelper.loadString(key: "porizo_access_token"))
    }

    @MainActor
    func testNewerAuthenticationCommitSupersedesOlderCommit() async throws {
        let userId = "user_commit_owner"
        let authManager = AuthManager(session: makeCurrentUserSession(userId: userId, holdResponse: true))
        let staleCommit = Task { @MainActor in
            try await authManager.commitAuthenticatedSession(
                successfulAuthResponse(userId: userId),
                provider: "email_magic"
            )
        }

        let validationStarted = await waitUntil { AuthManagerURLProtocolStub.heldRequestCount == 1 }
        XCTAssertTrue(validationStarted)

        AuthManagerURLProtocolStub.allowNewRequests()
        _ = try await authManager.commitAuthenticatedSession(
            successfulAuthResponse(userId: userId),
            provider: "email_magic"
        )
        XCTAssertTrue(authManager.isAuthenticated)
        XCTAssertFalse(authManager.isCommittingAuthenticationSession)

        AuthManagerURLProtocolStub.releaseHeldRequests()
        do {
            _ = try await staleCommit.value
            XCTFail("Expected the older commit to be superseded")
        } catch {
            XCTAssertTrue(error is CancellationError)
        }
        XCTAssertTrue(authManager.isAuthenticated)
        XCTAssertFalse(authManager.isCommittingAuthenticationSession)
    }

    func testAuthenticationPresentationPolicyNeverFallsBackToEmailDuringCommit() {
        XCTAssertEqual(
            AuthenticationPresentationPolicy.content(
                isCommitting: true,
                hasPendingMagicLogin: false
            ),
            .progress
        )
        XCTAssertEqual(
            AuthenticationPresentationPolicy.content(
                isCommitting: true,
                hasPendingMagicLogin: true
            ),
            .progress
        )
        XCTAssertEqual(
            AuthenticationPresentationPolicy.content(
                isCommitting: false,
                hasPendingMagicLogin: true
            ),
            .pendingMagicLogin
        )
        XCTAssertEqual(
            AuthenticationPresentationPolicy.content(
                isCommitting: false,
                hasPendingMagicLogin: false
            ),
            .emailEntry
        )
        XCTAssertFalse(AuthenticationPresentationPolicy.shouldRenderMain(
            isAuthenticated: true,
            isCommitting: true
        ))
        XCTAssertTrue(AuthenticationPresentationPolicy.shouldRenderMain(
            isAuthenticated: true,
            isCommitting: false
        ))
    }

    @MainActor
    func testOldRefreshCannotOverwriteNewlyCommittedAccount() async throws {
        seedStoredSession(userId: "old_user", accessToken: "old_access", refreshToken: "old_refresh")
        let session = makeRouteAwareAuthSession(holdResponse: true)
        let authManager = AuthManager(session: session)

        let refresh = Task { @MainActor in
            try await authManager.refreshTokens()
        }
        let refreshStarted = await waitUntil { AuthManagerURLProtocolStub.heldRequestCount == 1 }
        XCTAssertTrue(refreshStarted)

        AuthManagerURLProtocolStub.allowNewRequests()
        _ = try await authManager.commitAuthenticatedSession(
            successfulAuthResponse(userId: "new_user"),
            provider: "email_magic"
        )
        AuthManagerURLProtocolStub.releaseHeldRequests()

        do {
            _ = try await refresh.value
            XCTFail("Expected the old refresh to be cancelled")
        } catch {
            XCTAssertTrue(error is CancellationError || (error as? URLError)?.code == .cancelled)
        }
        XCTAssertEqual(KeychainHelper.loadString(key: "porizo_access_token"), "issued_access_token")
        XCTAssertEqual(KeychainHelper.loadString(key: "porizo_refresh_token"), "issued_refresh_token")
        XCTAssertEqual(authManager.currentUser?.id, "new_user")
    }

    @MainActor
    func testOldRefreshCannotRestoreCredentialsAfterLogout() async throws {
        seedStoredSession(userId: "old_user", accessToken: "old_access", refreshToken: "old_refresh")
        let authManager = AuthManager(session: makeRouteAwareAuthSession(holdResponse: true))
        let refresh = Task { @MainActor in
            try await authManager.refreshTokens()
        }
        let refreshStarted = await waitUntil { AuthManagerURLProtocolStub.heldRequestCount == 1 }
        XCTAssertTrue(refreshStarted)

        authManager.logout()
        AuthManagerURLProtocolStub.releaseHeldRequests()
        _ = try? await refresh.value

        XCTAssertNil(KeychainHelper.loadString(key: "porizo_access_token"))
        XCTAssertNil(KeychainHelper.loadString(key: "porizo_refresh_token"))
        XCTAssertFalse(authManager.isAuthenticated)
    }

    @MainActor
    func testLatePhoneRegistrationResponseCannotReplaceNewerLogin() async throws {
        let session = makeRouteAwareAuthSession(holdResponse: true)
        let authManager = AuthManager(session: session)
        authManager.startPhoneAuth()
        authManager.onPhoneCodeSent(phoneNumber: "+61400000000")
        let operation = try XCTUnwrap(authManager.phoneVerificationOperation)
        try await authManager.handlePhoneVerification(VerifyPhoneCodeResponse(
            success: true,
            verified: true,
            registrationToken: "registration_token",
            remainingAttempts: nil,
            accessToken: nil,
            refreshToken: nil,
            userId: nil,
            isNewUser: true
        ), operation: operation)

        let oldRegistration = Task { @MainActor in
            try await authManager.completePhoneRegistration(displayName: "Old", email: "old@example.com")
        }
        let registrationStarted = await waitUntil { AuthManagerURLProtocolStub.heldRequestCount == 1 }
        XCTAssertTrue(registrationStarted)

        AuthManagerURLProtocolStub.allowNewRequests()
        _ = try await authManager.commitAuthenticatedSession(
            successfulAuthResponse(userId: "new_user"),
            provider: "email_magic"
        )
        AuthManagerURLProtocolStub.releaseHeldRequests()

        do {
            try await oldRegistration.value
            XCTFail("Expected stale registration response to be rejected")
        } catch {
            XCTAssertTrue(error is CancellationError || (error as? URLError)?.code == .cancelled)
        }
        XCTAssertEqual(authManager.currentUser?.id, "new_user")
        XCTAssertEqual(KeychainHelper.loadString(key: "porizo_access_token"), "issued_access_token")
    }

    @MainActor
    func testCancelledPhoneVerificationResponseCannotStartANewLogin() async throws {
        let authManager = AuthManager(session: makeCurrentUserSession(userId: "phone_user"))
        authManager.startPhoneAuth()
        authManager.onPhoneCodeSent(phoneNumber: "+61400000000")
        let cancelledOperation = try XCTUnwrap(authManager.phoneVerificationOperation)
        authManager.cancelPhoneAuth()

        do {
            try await authManager.handlePhoneVerification(VerifyPhoneCodeResponse(
                success: true,
                verified: true,
                registrationToken: nil,
                remainingAttempts: nil,
                accessToken: "late_access",
                refreshToken: "late_refresh",
                userId: "phone_user",
                isNewUser: false
            ), operation: cancelledOperation)
            XCTFail("Expected the cancelled verification response to be rejected")
        } catch {
            XCTAssertTrue(error is CancellationError)
        }
        XCTAssertFalse(authManager.isAuthenticated)
        XCTAssertNil(KeychainHelper.loadString(key: "porizo_access_token"))
    }

    @MainActor
    func testCancellingPhoneFlowImmediatelyReleasesOwnedCommitState() async throws {
        let authManager = AuthManager(session: makeCurrentUserSession(
            userId: "phone_user",
            holdResponse: true
        ))
        authManager.startPhoneAuth()
        authManager.onPhoneCodeSent(phoneNumber: "+61400000000")
        let operation = try XCTUnwrap(authManager.phoneVerificationOperation)

        let verification = Task { @MainActor in
            try await authManager.handlePhoneVerification(VerifyPhoneCodeResponse(
                success: true,
                verified: true,
                registrationToken: nil,
                remainingAttempts: nil,
                accessToken: "phone_access",
                refreshToken: "phone_refresh",
                userId: "phone_user",
                isNewUser: false
            ), operation: operation)
        }

        let validationStarted = await waitUntil { AuthManagerURLProtocolStub.heldRequestCount == 1 }
        XCTAssertTrue(validationStarted)
        XCTAssertTrue(authManager.isCommittingAuthenticationSession)

        authManager.cancelPhoneAuth()

        XCTAssertFalse(authManager.isCommittingAuthenticationSession)
        XCTAssertFalse(authManager.isAuthenticated)
        AuthManagerURLProtocolStub.releaseHeldRequests()

        do {
            try await verification.value
            XCTFail("Expected the cancelled phone commit to be rejected")
        } catch {
            XCTAssertTrue(error is CancellationError)
        }
        XCTAssertNil(KeychainHelper.loadString(key: "porizo_access_token"))
    }

    @MainActor
    func testStalePhoneVerificationCannotAdoptNewPhoneOperation() async throws {
        let authManager = AuthManager(session: makeCurrentUserSession(userId: "phone_user"))
        authManager.startPhoneAuth()
        authManager.onPhoneCodeSent(phoneNumber: "+61400000001")
        let firstOperation = try XCTUnwrap(authManager.phoneVerificationOperation)

        authManager.phoneAuthGoBack()
        authManager.onPhoneCodeSent(phoneNumber: "+61400000002")
        let secondOperation = try XCTUnwrap(authManager.phoneVerificationOperation)
        XCTAssertNotEqual(firstOperation.generation, secondOperation.generation)

        do {
            try await authManager.handlePhoneVerification(VerifyPhoneCodeResponse(
                success: true,
                verified: true,
                registrationToken: nil,
                remainingAttempts: nil,
                accessToken: "first_access",
                refreshToken: "first_refresh",
                userId: "phone_user",
                isNewUser: false
            ), operation: firstOperation)
            XCTFail("Expected the first verification response to be rejected")
        } catch {
            XCTAssertTrue(error is CancellationError)
        }

        XCTAssertEqual(
            authManager.phoneVerificationOperation?.generation,
            secondOperation.generation
        )
        XCTAssertFalse(authManager.isAuthenticated)
        XCTAssertNil(KeychainHelper.loadString(key: "porizo_access_token"))
    }

    @MainActor
    func testAppleRecoveryResponseKeepsProgressUntilValidationAndClearsMagicPresentation() async throws {
        let transactionId = "txn_legacy_apple_recovery"
        try seedPendingMagicLogin(transactionId: transactionId, purpose: .login)
        let authManager = AuthManager(session: makeCurrentUserSession(userId: "legacy_user", holdResponse: true))
        let operation = authManager.beginAuthenticationOperation()
        let response = try JSONEncoder().encode(successfulAuthResponse(userId: "legacy_user"))

        let recovery = Task { @MainActor in
            try await authManager.processSocialAuthenticationResponse(
                data: response,
                statusCode: 200,
                provider: "apple",
                requestBody: ["provider": "apple"],
                appleUserIdentifier: "apple_legacy_user",
                operation: operation
            )
        }

        let validationStarted = await waitUntil { AuthManagerURLProtocolStub.heldRequestCount == 1 }
        XCTAssertTrue(validationStarted)
        XCTAssertTrue(authManager.isCommittingAuthenticationSession)
        XCTAssertFalse(authManager.isAuthenticated)
        XCTAssertNotNil(authManager.pendingMagicLoginPresentation)
        XCTAssertEqual(
            AuthenticationPresentationPolicy.content(
                isCommitting: authManager.isCommittingAuthenticationSession,
                hasPendingMagicLogin: authManager.pendingMagicLoginPresentation != nil
            ),
            .progress
        )

        AuthManagerURLProtocolStub.releaseHeldRequests()
        try await recovery.value

        XCTAssertTrue(authManager.isAuthenticated)
        XCTAssertFalse(authManager.isCommittingAuthenticationSession)
        XCTAssertNil(authManager.pendingMagicLoginPresentation)
        XCTAssertNil(MagicLoginPresentationStore.load())
        XCTAssertNil(PendingMagicLoginStore.load(transactionId: transactionId))
    }

    @MainActor
    func testConfirmedSocialLinkClearsPersistedMagicRecoveryPresentation() async throws {
        let transactionId = "txn_confirmed_social_recovery"
        let userId = "confirmed_social_user"
        try seedPendingMagicLogin(transactionId: transactionId, purpose: .login)
        AuthManagerURLProtocolStub.configure { request in
            switch request.url?.path {
            case "/auth/social":
                return (200, Data("""
                {
                  "user_id": "\(userId)",
                  "access_token": "issued_access_token",
                  "refresh_token": "issued_refresh_token",
                  "expires_in": 900,
                  "is_new_user": false
                }
                """.utf8))
            case "/auth/me":
                return (200, Self.currentUserJSON(userId: userId))
            default:
                return (404, Data("{}".utf8))
            }
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AuthManagerURLProtocolStub.self]
        let authManager = AuthManager(session: URLSession(configuration: configuration))
        let operation = authManager.beginAuthenticationOperation()
        let confirmationRequired = Data("""
        {
          "requires_link_confirmation": true,
          "existing_account_email": "p***@example.com",
          "provider": "apple"
        }
        """.utf8)

        do {
            try await authManager.processSocialAuthenticationResponse(
                data: confirmationRequired,
                statusCode: 200,
                provider: "apple",
                requestBody: ["provider": "apple", "identity_token": "token"],
                appleUserIdentifier: "apple_user",
                operation: operation
            )
            XCTFail("Expected link confirmation to be required")
        } catch let error as AuthError {
            guard case .requiresLinkConfirmation = error else {
                return XCTFail("Expected requiresLinkConfirmation")
            }
        }

        XCTAssertNotNil(authManager.pendingMagicLoginPresentation)
        try await authManager.confirmPendingSocialLink()

        XCTAssertTrue(authManager.isAuthenticated)
        XCTAssertEqual(authManager.magicLoginState, .success)
        XCTAssertNil(authManager.pendingSocialLinkRequest)
        XCTAssertNil(authManager.pendingMagicLoginPresentation)
        XCTAssertNil(MagicLoginPresentationStore.load())
        XCTAssertNil(PendingMagicLoginStore.load(transactionId: transactionId))
    }

    @MainActor
    func testInterruptedAuthenticationBundleIsNeverRestored() async {
        seedStoredSession(userId: "mixed_user", accessToken: "mixed_access", refreshToken: "mixed_refresh")
        XCTAssertTrue(KeychainHelper.saveString(
            key: "porizo_auth_bundle_mutating",
            value: "interrupted"
        ))

        let authManager = AuthManager()
        let cleanupCompleted = await waitUntil {
            KeychainHelper.loadString(key: "porizo_auth_bundle_mutating") == nil
        }

        XCTAssertTrue(cleanupCompleted)
        XCTAssertFalse(authManager.isAuthenticated)
        XCTAssertNil(KeychainHelper.loadString(key: "porizo_access_token"))
        XCTAssertNil(KeychainHelper.loadString(key: "porizo_refresh_token"))
        XCTAssertNil(KeychainHelper.loadString(key: "porizo_auth_user_id"))
        XCTAssertNil(KeychainHelper.loadString(key: "porizo_auth_bundle_mutating"))
    }

    // MARK: - Identity helpers

    func testPhoneProfileEntryValidator_requiresNonEmptyNameAndValidEmail() {
        XCTAssertFalse(PhoneProfileEntryValidator.canContinue(displayName: "", email: "ambrose@example.com"))
        XCTAssertFalse(PhoneProfileEntryValidator.canContinue(displayName: "Ambrose", email: ""))
        XCTAssertFalse(PhoneProfileEntryValidator.canContinue(displayName: "Ambrose", email: "invalid"))
        XCTAssertTrue(PhoneProfileEntryValidator.canContinue(displayName: "Ambrose", email: "ambrose@example.com"))
    }

    func testEmailVerificationToken_extractsTokenFromSupportedDeepLinks() {
        let customScheme = URL(string: "porizo://verify-email?token=abc123")!
        XCTAssertEqual(emailVerificationToken(from: customScheme), "abc123")

        let universalLink = URL(string: "https://porizo.app/verify-email?token=xyz789")!
        XCTAssertEqual(emailVerificationToken(from: universalLink), "xyz789")

        let unrelated = URL(string: "https://porizo.app/share/song")!
        XCTAssertNil(emailVerificationToken(from: unrelated))
    }

    // MARK: - Protected Data Tests

    @MainActor
    func testWaitForProtectedDataReturnsImmediatelyWhenAvailable() async {
        // Given: Protected data is available (normal case in tests)
        let authManager = AuthManager()

        // When: We call waitForProtectedData
        let result = await authManager.waitForProtectedData()

        // Then: It should return true immediately
        XCTAssertTrue(result)
    }

    func testWaitForProtectedDataTimesOutWhenUnavailable() async {
        // This test documents the expected behavior - in practice,
        // we can't easily simulate isProtectedDataAvailable = false in unit tests
        // The timeout behavior is verified through integration testing
    }

    // MARK: - Proactive Token Refresh Tests

    @MainActor
    func testEnsureValidAccessTokenThrowsWhenNotAuthenticated() async throws {
        // Given: No tokens stored (fresh AuthManager with no login)
        let authManager = AuthManager()

        // When/Then: ensureValidAccessToken should throw notAuthenticated
        do {
            _ = try await authManager.ensureValidAccessToken()
            XCTFail("Expected AuthError.notAuthenticated to be thrown")
        } catch let error as AuthError {
            if case .notAuthenticated = error {
                // Expected error type
            } else {
                XCTFail("Expected .notAuthenticated but got: \(error)")
            }
        } catch {
            XCTFail("Expected AuthError but got: \(error)")
        }
    }

    @MainActor
    func testEnsureValidAccessTokenMethodExists() async {
        // This test verifies the method signature exists and is callable.
        // Full behavior testing requires a mocked auth server.
        //
        // Expected behavior:
        // - Returns existing token if expiry > 5 minutes away
        // - Proactively refreshes if token expires within 5 minutes
        // - Throws AuthError.notAuthenticated if no token exists

        let authManager = AuthManager()

        // Method should exist and be callable (will throw since not authenticated)
        do {
            _ = try await authManager.ensureValidAccessToken()
        } catch is AuthError {
            // Expected - not authenticated
        } catch {
            XCTFail("Unexpected error type: \(error)")
        }
    }

    @MainActor
    func testEnsureValidAccessTokenReturnsExistingWhenValid() async throws {
        // Given: Valid access token with 30 minutes remaining
        // When: ensureValidAccessToken is called
        // Then: It should return the existing token without refresh
        throw XCTSkip("Requires keychain mocking")
    }

    @MainActor
    func testEnsureValidAccessTokenRefreshesWhenNearExpiry() async throws {
        // Given: Access token expires in 4 minutes (less than 5-minute buffer)
        // When: ensureValidAccessToken is called
        // Then: It should call refreshTokens() proactively
        throw XCTSkip("Requires keychain mocking")
    }

    @MainActor
    func testLogoutClearsPendingPhoneLinkAndPendingSuggestionState() async {
        _ = KeychainHelper.saveString(key: "porizo_pending_phone_link", value: "+15551234567")
        _ = KeychainHelper.saveString(
            key: "porizo_pending_phone_link_expiry",
            value: String(Date().addingTimeInterval(600).timeIntervalSince1970)
        )
        PendingSuggestionStore.store(
            suggestion: OnboardingSuggestion(
                title: "A Song for Mom",
                emotionalAngle: "A thank-you she will keep forever",
                previewLine: "You were there before I had the words...",
                source: "template"
            ),
            recipientName: "Mom",
            occasion: "birthday",
            emotionalSeed: "unsaid_words",
            relationshipType: "mom",
            createTypeRaw: CreateFlowKind.song.rawValue
        )

        let authManager = AuthManager()
        authManager.logout()

        XCTAssertNil(KeychainHelper.loadString(key: "porizo_pending_phone_link"))
        XCTAssertNil(KeychainHelper.loadString(key: "porizo_pending_phone_link_expiry"))
        XCTAssertNil(PendingSuggestionStore.loadIfActive())
    }

    func testMagicLoginLinkRequiresExactHTTPSHostAndIOSPath() throws {
        let valid = try XCTUnwrap(URL(string: "https://auth.porizo.co/auth/magic/ios?transaction_id=tx_1#secret=link_1"))
        XCTAssertEqual(
            MagicLoginLink.parse(valid),
            MagicLoginLink(transactionId: "tx_1", linkSecret: "link_1")
        )

        let rejected = [
            "http://auth.porizo.co/auth/magic/ios?transaction_id=tx#secret=s",
            "porizo://auth/magic/ios?transaction_id=tx#secret=s",
            "https://evil.example/auth/magic/ios?transaction_id=tx#secret=s",
            "https://auth.porizo.co.evil.example/auth/magic/ios?transaction_id=tx#secret=s",
            "https://auth.porizo.co/auth/magic/android?transaction_id=tx#secret=s",
            "https://auth.porizo.co/auth/magic/ios?transaction_id=tx&transaction_id=other#secret=s",
            "https://auth.porizo.co/auth/magic/ios?transaction_id=tx&secret=s",
            "https://auth.porizo.co/auth/magic/ios?transaction_id=tx&secret=query#secret=fragment",
            "https://auth.porizo.co/auth/magic/ios?transaction_id=tx#secret=s&secret=other",
        ]
        for value in rejected {
            XCTAssertNil(MagicLoginLink.parse(try XCTUnwrap(URL(string: value))), value)
        }
    }

    func testMagicLoginResumeLinkCarriesTransactionIdOnly() throws {
        let valid = try XCTUnwrap(URL(string: "porizo://auth/magic/resume?transaction_id=tx_1"))
        XCTAssertEqual(
            MagicLoginResumeLink.parse(valid),
            MagicLoginResumeLink(transactionId: "tx_1")
        )

        let rejected = [
            "porizo://auth/magic/resume?transaction_id=tx&secret=leaked",
            "porizo://auth/magic/resume?transaction_id=tx#secret=leaked",
            "porizo://auth/magic/resume?transaction_id=tx&transaction_id=other",
            "porizo://evil/magic/resume?transaction_id=tx",
            "https://auth.porizo.co/auth/magic/resume?transaction_id=tx",
        ]
        for value in rejected {
            XCTAssertNil(MagicLoginResumeLink.parse(try XCTUnwrap(URL(string: value))), value)
        }
    }

    func testMagicLoginPresentationPersistsWithoutRequesterSecret() throws {
        let suiteName = "MagicLoginPresentationStoreTests-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let now = Date()
        let presentation = MagicLoginPresentation(
            transactionId: "tx_public",
            email: "person@example.com",
            purpose: .login,
            expiresAt: now.addingTimeInterval(600),
            createdAt: now
        )

        XCTAssertTrue(MagicLoginPresentationStore.save(presentation, defaults: defaults))
        XCTAssertEqual(MagicLoginPresentationStore.load(now: now, defaults: defaults), presentation)
        let stored = try XCTUnwrap(defaults.data(forKey: MagicLoginPresentationStore.storageKey))
        let storedText = try XCTUnwrap(String(data: stored, encoding: .utf8))
        XCTAssertFalse(storedText.contains("request_secret"))
        XCTAssertFalse(storedText.contains("requester_key"))
        XCTAssertFalse(storedText.contains("link_secret"))
    }

    func testExpiredMagicLoginPresentationIsRemoved() throws {
        let suiteName = "ExpiredMagicLoginPresentationStoreTests-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let now = Date()
        XCTAssertTrue(MagicLoginPresentationStore.save(MagicLoginPresentation(
            transactionId: "tx_expired",
            email: "person@example.com",
            purpose: .addEmail,
            expiresAt: now.addingTimeInterval(
                -MagicLoginPresentation.recoveryGraceInterval - 1
            ),
            createdAt: now.addingTimeInterval(-600)
        ), defaults: defaults))

        XCTAssertNil(MagicLoginPresentationStore.load(now: now, defaults: defaults))
        XCTAssertNil(defaults.data(forKey: MagicLoginPresentationStore.storageKey))
    }

    func testConsumedMagicLoginPresentationCanRemainDuringRecoveryGrace() throws {
        let suiteName = "RecoveryMagicLoginPresentationStoreTests-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let now = Date()
        let presentation = MagicLoginPresentation(
            transactionId: "tx_recovery",
            email: "person@example.com",
            purpose: .login,
            expiresAt: now.addingTimeInterval(-1),
            createdAt: now.addingTimeInterval(-901)
        )
        XCTAssertTrue(MagicLoginPresentationStore.save(presentation, defaults: defaults))
        XCTAssertEqual(
            MagicLoginPresentationStore.load(now: now, defaults: defaults),
            presentation
        )
    }

    func testPendingMagicRequestsAreBoundedAndSurviveReloadByTransactionId() {
        PendingMagicLoginStore.removeAll()
        defer { PendingMagicLoginStore.removeAll() }
        let now = Date()

        for index in 0...PendingMagicLoginStore.maximumEntries {
            XCTAssertTrue(PendingMagicLoginStore.save(PendingMagicLogin(
                transactionId: "u6_tx_\(index)",
                requestSecret: "request_secret_\(index)",
                requesterKey: "requester_key_\(index)",
                email: "person\(index)@example.com",
                purpose: .login,
                expiresAt: now.addingTimeInterval(600),
                createdAt: now.addingTimeInterval(TimeInterval(index))
            ), now: now))
        }

        XCTAssertNil(PendingMagicLoginStore.load(transactionId: "u6_tx_0", now: now))
        XCTAssertEqual(
            PendingMagicLoginStore.load(transactionId: "u6_tx_5", now: now)?.requestSecret,
            "request_secret_5"
        )
        let attributes = KeychainHelper.securityAttributes(
            key: PendingMagicLoginStore.keyPrefix + "u6_tx_5"
        )
        XCTAssertEqual(attributes.accessible, kSecAttrAccessibleWhenUnlockedThisDeviceOnly as String)
        XCTAssertNotEqual(attributes.synchronizable, true)
    }

    func testPendingMagicRequestExpiresAndIsRemoved() {
        PendingMagicLoginStore.removeAll()
        defer { PendingMagicLoginStore.removeAll() }
        let now = Date()
        XCTAssertTrue(PendingMagicLoginStore.save(PendingMagicLogin(
            transactionId: "u6_expired",
            requestSecret: "request_secret",
            requesterKey: "requester_key_1234",
            email: "person@example.com",
            purpose: .addEmail,
            expiresAt: now.addingTimeInterval(1),
            createdAt: now
        ), now: now))

        // Within the recovery grace window the record must survive: a link
        // click shortly after nominal expiry still needs the request secret
        // to resolve the flow (e.g. surface recovery) instead of a dead end.
        XCTAssertNotNil(PendingMagicLoginStore.load(
            transactionId: "u6_expired",
            now: now.addingTimeInterval(2)
        ))

        // Past expiry + recoveryGraceInterval the record is removed on load.
        XCTAssertNil(PendingMagicLoginStore.load(
            transactionId: "u6_expired",
            now: now.addingTimeInterval(
                1 + MagicLoginPresentation.recoveryGraceInterval + 1
            )
        ))
    }

    func testMagicLoginCannotReplaceAnAuthenticatedSession() {
        XCTAssertFalse(MagicLoginCompletionPolicy.allowsCompletion(
            purpose: .login,
            isAuthenticated: true
        ))
        XCTAssertTrue(MagicLoginCompletionPolicy.allowsCompletion(
            purpose: .login,
            isAuthenticated: false
        ))
        XCTAssertTrue(MagicLoginCompletionPolicy.allowsCompletion(
            purpose: .addEmail,
            isAuthenticated: true
        ))
    }

    @MainActor
    func testMagicLinkExchangeStartsWithoutWaitingForCancelledStatusPoll() async throws {
        let api = ControllableMagicLoginAPI()
        let transactionId = "race_tx"
        try seedPendingMagicLogin(transactionId: transactionId)
        let authManager = AuthManager(magicAPIClient: api)

        let statusTask = Task { @MainActor in
            await authManager.refreshMagicLoginStatus(transactionId: transactionId)
        }
        let statusStarted = await waitUntil { await api.hasStatusStarted() }
        XCTAssertTrue(statusStarted)

        let link = try XCTUnwrap(URL(
            string: "https://auth.porizo.co/auth/magic/ios?transaction_id=\(transactionId)#secret=link_secret"
        ))
        let handled = await authManager.handleMagicLoginURL(link)

        XCTAssertTrue(handled)
        let exchangeCount = await api.exchangeCallCount
        XCTAssertEqual(exchangeCount, 1)
        XCTAssertEqual(authManager.magicLoginState, .serverError)

        await api.releaseStatus(as: .expired)
        _ = await statusTask.value
        XCTAssertEqual(
            authManager.magicLoginState,
            .serverError,
            "A cancelled stale poll must not overwrite the direct exchange result."
        )
    }

    @MainActor
    func testRepeatedTapForSameMagicLinkSharesOneExchange() async throws {
        let api = ControllableMagicLoginAPI()
        await api.setHoldExchange(true)
        let transactionId = "duplicate_tx"
        try seedPendingMagicLogin(transactionId: transactionId)
        let authManager = AuthManager(magicAPIClient: api)
        let link = try XCTUnwrap(URL(
            string: "https://auth.porizo.co/auth/magic/ios?transaction_id=\(transactionId)#secret=link_secret"
        ))

        let first = Task { @MainActor in await authManager.handleMagicLoginURL(link) }
        let exchangeStarted = await waitUntil { await api.hasExchangeStarted() }
        XCTAssertTrue(exchangeStarted)
        let second = Task { @MainActor in await authManager.handleMagicLoginURL(link) }

        let exchangeCountBeforeRelease = await api.exchangeCallCount
        XCTAssertEqual(exchangeCountBeforeRelease, 1)
        await api.failHeldExchange()
        let firstHandled = await first.value
        let secondHandled = await second.value
        XCTAssertTrue(firstHandled)
        XCTAssertTrue(secondHandled)
        let exchangeCountAfterRelease = await api.exchangeCallCount
        XCTAssertEqual(exchangeCountAfterRelease, 1)
    }

    @MainActor
    func testDifferentSecretForSameTransactionWaitsForInFlightExchange() async throws {
        let api = ControllableMagicLoginAPI()
        await api.setHoldExchange(true)
        let transactionId = "reopened_tx"
        try seedPendingMagicLogin(transactionId: transactionId)
        let authManager = AuthManager(magicAPIClient: api)
        let staleLink = try XCTUnwrap(URL(
            string: "https://auth.porizo.co/auth/magic/ios?transaction_id=\(transactionId)#secret=stale_secret"
        ))
        let validLink = try XCTUnwrap(URL(
            string: "https://auth.porizo.co/auth/magic/ios?transaction_id=\(transactionId)#secret=valid_secret"
        ))

        let staleTask = Task { @MainActor in await authManager.handleMagicLoginURL(staleLink) }
        let staleExchangeStarted = await waitUntil { await api.exchangeCallCount == 1 }
        XCTAssertTrue(staleExchangeStarted)
        let validTask = Task { @MainActor in await authManager.handleMagicLoginURL(validLink) }
        try? await Task.sleep(for: .milliseconds(50))
        let exchangeCountWhileFirstIsHeld = await api.exchangeCallCount
        XCTAssertEqual(exchangeCountWhileFirstIsHeld, 1)

        await api.failHeldExchange()
        let validExchangeStarted = await waitUntil { await api.exchangeCallCount == 2 }
        XCTAssertTrue(validExchangeStarted)

        let secrets = await api.exchangeLinkSecrets
        XCTAssertEqual(secrets, ["stale_secret", "valid_secret"])
        await api.failHeldExchange()
        let staleHandled = await staleTask.value
        let validHandled = await validTask.value
        XCTAssertTrue(staleHandled)
        XCTAssertTrue(validHandled)
        XCTAssertEqual(authManager.magicLoginState, .serverError)
    }

    @MainActor
    func testMagicLinkOpenedBeforeRequestResponseIsProcessedAfterPersistence() async throws {
        let api = ControllableMagicLoginAPI()
        let transactionId = "early_link_tx"
        let authManager = AuthManager(magicAPIClient: api)
        let requestTask = Task { @MainActor in
            try await authManager.requestMagicLogin(
                email: "person@example.com",
                purpose: .login
            )
        }
        let requestStarted = await waitUntil { await api.hasRequestStarted() }
        XCTAssertTrue(requestStarted)

        let link = try XCTUnwrap(URL(
            string: "https://auth.porizo.co/auth/magic/ios?transaction_id=\(transactionId)#secret=link_secret"
        ))
        let handled = await authManager.handleMagicLoginURL(link)
        XCTAssertTrue(handled)
        await api.releaseRequest(transactionId: transactionId)
        try await requestTask.value

        let exchangeStarted = await waitUntil { await api.exchangeCallCount == 1 }
        XCTAssertTrue(exchangeStarted)
        XCTAssertEqual(authManager.magicLoginState, .serverError)
    }

    @MainActor
    func testDirectMagicLoginCommitsIssuedSessionWithoutBootstrapGate() async throws {
        let api = ControllableMagicLoginAPI()
        let transactionId = "direct_success_tx"
        let userId = "user_magic_direct"
        try seedPendingMagicLogin(transactionId: transactionId, purpose: .login)
        await api.setExchangeResponse(successfulExchange(userId: userId))
        let authManager = AuthManager(
            magicAPIClient: api,
            session: makeCurrentUserSession(userId: userId)
        )
        let link = try XCTUnwrap(URL(
            string: "https://auth.porizo.co/auth/magic/ios?transaction_id=\(transactionId)#secret=link_secret"
        ))

        let handled = await authManager.handleMagicLoginURL(link)
        let exchangeCallCount = await api.exchangeCallCount

        XCTAssertTrue(handled)
        XCTAssertTrue(authManager.isAuthenticated)
        XCTAssertEqual(authManager.currentUser?.id, userId)
        XCTAssertEqual(authManager.magicLoginState, .success)
        XCTAssertNil(authManager.pendingMagicLoginPresentation)
        XCTAssertEqual(exchangeCallCount, 1)
    }

    @MainActor
    func testPendingMagicLoginCannotReplaceDurableSessionDuringColdRestore() async throws {
        let api = ControllableMagicLoginAPI()
        let transactionId = "restore_wins_tx"
        try seedPendingMagicLogin(transactionId: transactionId, purpose: .login)
        XCTAssertTrue(KeychainHelper.saveString(key: "porizo_access_token", value: "existing_access"))
        XCTAssertTrue(KeychainHelper.saveString(key: "porizo_refresh_token", value: "existing_refresh"))
        XCTAssertTrue(KeychainHelper.saveString(key: "porizo_token_expiry", value: "4102444800"))
        XCTAssertTrue(KeychainHelper.saveString(key: "porizo_auth_user_id", value: "existing_user"))
        XCTAssertTrue(KeychainHelper.saveString(key: "porizo_auth_provider", value: "email_magic"))
        let authManager = AuthManager(
            magicAPIClient: api,
            session: makeCurrentUserSession(userId: "existing_user")
        )
        let link = try XCTUnwrap(URL(
            string: "https://auth.porizo.co/auth/magic/ios?transaction_id=\(transactionId)#secret=link_secret"
        ))

        let handled = await authManager.handleMagicLoginURL(link)
        let exchangeCallCount = await api.exchangeCallCount

        XCTAssertTrue(handled)
        XCTAssertTrue(authManager.isAuthenticated)
        XCTAssertEqual(authManager.magicLoginState, .superseded)
        XCTAssertEqual(exchangeCallCount, 0)
    }

    @MainActor
    func testPartialColdStartCredentialsAreClearedBeforeMagicLoginExchange() async throws {
        let api = ControllableMagicLoginAPI()
        let transactionId = "partial_restore_tx"
        let userId = "user_after_partial_restore"
        try seedPendingMagicLogin(transactionId: transactionId, purpose: .login)
        XCTAssertTrue(KeychainHelper.saveString(key: "porizo_access_token", value: "orphaned_access"))
        XCTAssertTrue(KeychainHelper.saveString(key: "porizo_device_token", value: "previous_account_device"))
        XCTAssertTrue(KeychainHelper.saveString(key: "porizo_device_token_expiry", value: "4102444800"))
        await api.setExchangeResponse(successfulExchange(userId: userId))
        let authManager = AuthManager(
            magicAPIClient: api,
            session: makeCurrentUserSession(userId: userId)
        )
        let link = try XCTUnwrap(URL(
            string: "https://auth.porizo.co/auth/magic/ios?transaction_id=\(transactionId)#secret=link_secret"
        ))

        let handled = await authManager.handleMagicLoginURL(link)
        let exchangeCallCount = await api.exchangeCallCount

        XCTAssertTrue(handled)
        XCTAssertTrue(authManager.isAuthenticated)
        XCTAssertEqual(authManager.currentUser?.id, userId)
        XCTAssertEqual(authManager.magicLoginState, .success)
        XCTAssertEqual(exchangeCallCount, 1)
        XCTAssertNil(KeychainHelper.loadString(key: "porizo_device_token"))
        XCTAssertNil(KeychainHelper.loadString(key: "porizo_device_token_expiry"))
    }

    @MainActor
    func testConsumedStatusCommitsIssuedSessionOnceInsteadOfLooping() async throws {
        let api = ControllableMagicLoginAPI()
        let transactionId = "status_success_tx"
        let userId = "user_magic_status"
        try seedPendingMagicLogin(transactionId: transactionId, purpose: .login)
        await api.setCompletionResponse(successfulExchange(userId: userId))
        let authManager = AuthManager(
            magicAPIClient: api,
            session: makeCurrentUserSession(userId: userId)
        )

        let refresh = Task { @MainActor in
            await authManager.refreshMagicLoginStatus(transactionId: transactionId)
        }
        let statusStarted = await waitUntil { await api.hasStatusStarted() }
        XCTAssertTrue(statusStarted)
        await api.releaseStatus(as: .consumed)

        let completed = await refresh.value
        let firstCompletionCallCount = await api.completionCallCount
        let terminalRefresh = await authManager.refreshMagicLoginStatus(transactionId: transactionId)
        let finalCompletionCallCount = await api.completionCallCount

        XCTAssertTrue(completed)
        XCTAssertTrue(authManager.isAuthenticated)
        XCTAssertEqual(authManager.currentUser?.id, userId)
        XCTAssertEqual(authManager.magicLoginState, .success)
        XCTAssertEqual(firstCompletionCallCount, 1)
        XCTAssertTrue(terminalRefresh)
        XCTAssertEqual(finalCompletionCallCount, 1)
    }

    private func seedPendingMagicLogin(
        transactionId: String,
        purpose: MagicLoginPurpose = .addEmail
    ) throws {
        let now = Date()
        let pending = PendingMagicLogin(
            transactionId: transactionId,
            requestSecret: "request_secret",
            requesterKey: "requester_key",
            email: "person@example.com",
            purpose: purpose,
            expiresAt: now.addingTimeInterval(600),
            createdAt: now
        )
        XCTAssertTrue(PendingMagicLoginStore.save(pending))
        XCTAssertTrue(MagicLoginPresentationStore.save(MagicLoginPresentation(
            transactionId: transactionId,
            email: pending.email,
            purpose: pending.purpose,
            expiresAt: pending.expiresAt,
            createdAt: pending.createdAt
        )))
    }

    private func successfulExchange(userId: String) -> MagicLoginExchangeResponse {
        MagicLoginExchangeResponse(
            accessToken: "issued_access_token",
            refreshToken: "issued_refresh_token",
            userId: userId,
            expiresIn: 900,
            contactVerified: nil,
            isNewUser: true
        )
    }

    private func successfulAuthResponse(userId: String) -> AuthResponse {
        AuthResponse(
            userId: userId,
            accessToken: "issued_access_token",
            refreshToken: "issued_refresh_token",
            expiresIn: 900,
            isNewUser: false
        )
    }

    private func makeCurrentUserSession(
        userId: String,
        status: Int = 200,
        holdResponse: Bool = false
    ) -> URLSession {
        let json = """
        {
          "user_id": "\(userId)",
          "email": "person@example.com",
          "email_verified": true,
          "providers": ["email"],
          "created_at": "2026-07-14T00:00:00Z",
          "needs_profile_completion": false,
          "auth_methods": [],
          "contacts": [],
          "missing_profile_requirements": []
        }
        """
        AuthManagerURLProtocolStub.configure(
            status: status,
            data: Data(json.utf8),
            holdResponse: holdResponse
        )
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AuthManagerURLProtocolStub.self]
        return URLSession(configuration: configuration)
    }

    private func makeRouteAwareAuthSession(holdResponse: Bool) -> URLSession {
        AuthManagerURLProtocolStub.configure(holdResponse: holdResponse) { request in
            switch request.url?.path {
            case "/auth/refresh":
                return (200, Data(#"{"access_token":"stale_access","refresh_token":"stale_refresh","expires_in":900}"#.utf8))
            case "/auth/phone/register":
                return (201, Data(#"{"user_id":"old_user","access_token":"old_registration_access","refresh_token":"old_registration_refresh","expires_in":900,"is_new_user":true}"#.utf8))
            case "/auth/me":
                let bearer = request.value(forHTTPHeaderField: "Authorization") ?? ""
                let userId = bearer.contains("old_registration_access") ? "old_user" : "new_user"
                return (200, Self.currentUserJSON(userId: userId))
            default:
                return (200, Data("{}".utf8))
            }
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AuthManagerURLProtocolStub.self]
        return URLSession(configuration: configuration)
    }

    private func seedStoredSession(
        userId: String,
        accessToken: String,
        refreshToken: String
    ) {
        XCTAssertTrue(KeychainHelper.saveString(key: "porizo_access_token", value: accessToken))
        XCTAssertTrue(KeychainHelper.saveString(key: "porizo_refresh_token", value: refreshToken))
        XCTAssertTrue(KeychainHelper.saveString(key: "porizo_auth_user_id", value: userId))
        XCTAssertTrue(KeychainHelper.saveString(
            key: "porizo_token_expiry",
            value: String(Date.now.addingTimeInterval(-60).timeIntervalSince1970)
        ))
        XCTAssertTrue(KeychainHelper.saveString(key: "porizo_auth_provider", value: "email_magic"))
    }

    private static func currentUserJSON(userId: String) -> Data {
        Data("""
        {
          "user_id": "\(userId)",
          "email": "person@example.com",
          "email_verified": true,
          "providers": ["email"],
          "created_at": "2026-07-14T00:00:00Z",
          "needs_profile_completion": false,
          "auth_methods": [],
          "contacts": [],
          "missing_profile_requirements": []
        }
        """.utf8)
    }

    private func waitUntil(
        timeout: Duration = .seconds(2),
        condition: @escaping () async -> Bool
    ) async -> Bool {
        let deadline = ContinuousClock.now.advanced(by: timeout)
        while ContinuousClock.now < deadline {
            if await condition() { return true }
            try? await Task.sleep(for: .milliseconds(10))
        }
        return await condition()
    }

    func testLegacyRecoveryIsTerminalSoBackgroundRefreshCannotClobberIt() {
        // Regression: a scene-phase `.active` refresh after the direct exchange
        // returned LEGACY_ACCOUNT_RECOVERY_REQUIRED must NOT re-enter and
        // downgrade the recovery screen to `.wrongDeviceOrPlatform`. The guard
        // in performMagicLoginStatusRefresh keys on this predicate.
        XCTAssertTrue(AuthManager.isTerminalMagicState(
            .legacyRecovery(maskedEmail: "a•••@example.com", authMethods: ["apple", "phone"])
        ))
        for terminal: MagicLoginState in [
            .success, .expired, .locked, .conflict,
            .wrongDeviceOrPlatform, .cancelled, .superseded,
        ] {
            XCTAssertTrue(AuthManager.isTerminalMagicState(terminal))
        }
    }

    func testInFlightMagicStatesAreNotTerminal() {
        for nonTerminal: MagicLoginState in [
            .idle, .submitting, .opening, .exchanging, .offline, .serverError,
            .sent(email: "a@example.com"), .cooldown(email: "a@example.com"),
        ] {
            XCTAssertFalse(AuthManager.isTerminalMagicState(nonTerminal))
        }
    }
}
