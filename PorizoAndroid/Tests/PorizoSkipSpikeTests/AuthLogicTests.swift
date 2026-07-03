import XCTest
@testable import PorizoSkipSpike

/// U4b — pure auth logic: token-refresh error classification and phone-verify
/// outcome resolution. These are the top correctness risks (token rotation
/// races), so they are covered exhaustively and run on the host.
final class AuthLogicTests: XCTestCase {

    // MARK: refresh error classifier

    func testDefinitiveCodesForceHardLogout() {
        let definitive = [
            "TOKEN_REUSE_DETECTED", "TOKEN_REVOKED", "TOKEN_EXPIRED",
            "INVALID_TOKEN", "INVALID_REFRESH_TOKEN", "TOKEN_FAMILY_COMPROMISED",
            "SESSION_REVOKED", "SESSION_EXPIRED",
        ]
        for code in definitive {
            XCTAssertEqual(AuthLogic.classifyRefreshError(code: code), .hardLogout, "\(code) must hard-logout")
        }
    }

    func testAlreadyRotatedIsRecheck() {
        XCTAssertEqual(AuthLogic.classifyRefreshError(code: "TOKEN_ALREADY_ROTATED"), .recheckCachedToken)
    }

    func testUnknownOrNetworkCodeIsTransient() {
        XCTAssertEqual(AuthLogic.classifyRefreshError(code: "SOMETHING_ELSE"), .retryTransient)
        XCTAssertEqual(AuthLogic.classifyRefreshError(code: nil), .retryTransient)
        XCTAssertEqual(AuthLogic.classifyRefreshError(code: ""), .retryTransient)
    }

    func testClassifierIsCaseInsensitive() {
        XCTAssertEqual(AuthLogic.classifyRefreshError(code: "token_revoked"), .hardLogout)
        XCTAssertEqual(AuthLogic.classifyRefreshError(code: "Token_Already_Rotated"), .recheckCachedToken)
    }

    // MARK: proactive refresh threshold

    func testShouldRefreshWhenWithinThreshold() {
        // <5 min (300s) remaining → refresh
        XCTAssertTrue(AuthLogic.shouldProactivelyRefresh(secondsUntilExpiry: 120))
        XCTAssertTrue(AuthLogic.shouldProactivelyRefresh(secondsUntilExpiry: 299))
        XCTAssertTrue(AuthLogic.shouldProactivelyRefresh(secondsUntilExpiry: 0))
        XCTAssertTrue(AuthLogic.shouldProactivelyRefresh(secondsUntilExpiry: -10), "already expired → refresh")
    }

    func testShouldNotRefreshWhenPlentyOfTime() {
        XCTAssertFalse(AuthLogic.shouldProactivelyRefresh(secondsUntilExpiry: 301))
        XCTAssertFalse(AuthLogic.shouldProactivelyRefresh(secondsUntilExpiry: 3600))
    }

    // MARK: phone verify outcome

    private func verify(
        tokens: Bool = false,
        registration: Bool = false,
        existingUser: Bool = false
    ) -> PorizoVerifyPhoneCodeResponse {
        PorizoVerifyPhoneCodeResponse(
            success: true,
            verified: true,
            registrationToken: registration ? "reg_tok" : nil,
            remainingAttempts: nil,
            accessToken: tokens ? "acc" : nil,
            refreshToken: tokens ? "ref" : nil,
            userId: tokens ? "u1" : nil,
            isNewUser: registration ? true : nil,
            existingUser: existingUser ? true : nil
        )
    }

    func testVerifyWithTokensAuthenticatesDirectly() {
        let outcome = AuthLogic.phoneVerifyOutcome(verify(tokens: true))
        XCTAssertEqual(outcome, .authenticated(userId: "u1", accessToken: "acc", refreshToken: "ref"))
    }

    func testVerifyNewUserNeedsRegistration() {
        let outcome = AuthLogic.phoneVerifyOutcome(verify(registration: true))
        XCTAssertEqual(outcome, .needsRegistration(registrationToken: "reg_tok"))
    }

    func testVerifyNotVerifiedIsRejected() {
        var r = verify()
        r = PorizoVerifyPhoneCodeResponse(
            success: true, verified: false, registrationToken: nil, remainingAttempts: 2,
            accessToken: nil, refreshToken: nil, userId: nil, isNewUser: nil, existingUser: nil
        )
        XCTAssertEqual(AuthLogic.phoneVerifyOutcome(r), .rejected(remainingAttempts: 2))
    }

    func testVerifyTokensTakePrecedenceOverRegistration() {
        // Existing user who somehow also has a registration token: tokens win.
        let outcome = AuthLogic.phoneVerifyOutcome(verify(tokens: true, registration: true))
        if case .authenticated = outcome { /* ok */ } else {
            XCTFail("tokens must take precedence")
        }
    }
}
