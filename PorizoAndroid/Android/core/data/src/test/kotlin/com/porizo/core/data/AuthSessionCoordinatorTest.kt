package com.porizo.core.data

import com.porizo.core.model.AuthSession
import com.porizo.core.model.PorizoFailure
import com.porizo.core.model.RefreshTokenResult
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking

class AuthSessionCoordinatorTest {
    @Test
    fun protectedCallRefreshesExpiredSessionBeforeRequest() = runBlocking {
        var session: AuthSession? = expiredSession()
        var refreshCount = 0
        val coordinator = coordinator(
            load = { session },
            save = { session = it },
            clear = { session = null },
            refresh = {
                refreshCount += 1
                RefreshTokenResult("new-access", "new-refresh", 3600)
            },
        )

        val tokenUsed = coordinator.protectedCall {
            session?.accessToken
        }

        assertEquals("new-access", tokenUsed)
        assertEquals("new-refresh", session?.refreshToken)
        assertEquals(1, refreshCount)
    }

    @Test
    fun concurrentProtectedCallsShareOneRefresh() = runBlocking {
        var session: AuthSession? = expiredSession()
        var refreshCount = 0
        val coordinator = coordinator(
            load = { session },
            save = { session = it },
            clear = { session = null },
            refresh = {
                refreshCount += 1
                RefreshTokenResult("shared-access", "shared-refresh", 3600)
            },
        )

        val results = List(8) {
            async {
                coordinator.protectedCall {
                    session?.accessToken
                }
            }
        }.awaitAll()

        assertEquals(List(8) { "shared-access" }, results)
        assertEquals(1, refreshCount)
    }

    @Test
    fun forcedRefreshUnauthorizedClearsSession() = runBlocking {
        var session: AuthSession? = freshSession()
        val coordinator = coordinator(
            load = { session },
            save = { session = it },
            clear = { session = null },
            refresh = {
                throw PorizoFailure.Server(401, "unauthorized", "Refresh token revoked.")
            },
        )

        assertFailsWith<PorizoFailure.Server> {
            coordinator.protectedCall {
                throw PorizoFailure.Server(401, "unauthorized", "Access token expired.")
            }
        }
        assertNull(session)
    }

    private fun coordinator(
        load: () -> AuthSession?,
        save: (AuthSession) -> Unit,
        clear: () -> Unit,
        refresh: suspend (String) -> RefreshTokenResult,
    ): AuthSessionCoordinator =
        AuthSessionCoordinator(
            refreshWithToken = refresh,
            loadAuthSession = load,
            saveAuthSession = save,
            clearAuthSession = clear,
            nowEpochSeconds = { NOW },
        )

    private fun expiredSession(): AuthSession =
        AuthSession(
            userId = "user-1",
            accessToken = "old-access",
            refreshToken = "old-refresh",
            expiresInSeconds = 300,
            issuedAtEpochSeconds = NOW - 300,
        )

    private fun freshSession(): AuthSession =
        AuthSession(
            userId = "user-1",
            accessToken = "fresh-access",
            refreshToken = "fresh-refresh",
            expiresInSeconds = 3600,
            issuedAtEpochSeconds = NOW,
        )

    private companion object {
        const val NOW = 10_000L
    }
}
