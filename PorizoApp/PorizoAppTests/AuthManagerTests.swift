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

    static func configure(status: Int = 200, data: Data) {
        lock.withLock { response = (status, data) }
    }

    static func reset() {
        lock.withLock { response = nil }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let configured = Self.lock.withLock({ Self.response }),
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
        KeychainHelper.delete(key: "porizo_device_token")
        KeychainHelper.delete(key: "porizo_device_token_expiry")
        AuthManagerURLProtocolStub.reset()
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

    private func makeCurrentUserSession(userId: String) -> URLSession {
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
        AuthManagerURLProtocolStub.configure(data: Data(json.utf8))
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AuthManagerURLProtocolStub.self]
        return URLSession(configuration: configuration)
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
