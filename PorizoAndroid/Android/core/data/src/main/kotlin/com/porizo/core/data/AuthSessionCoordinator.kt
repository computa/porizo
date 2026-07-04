package com.porizo.core.data

import com.porizo.core.datastore.AndroidSessionStore
import com.porizo.core.model.AuthSession
import com.porizo.core.model.PorizoFailure
import com.porizo.core.model.RefreshTokenResult
import com.porizo.core.network.NetworkErrorMapper
import com.porizo.core.network.PorizoApiService
import com.porizo.core.network.RefreshRequestDto
import com.porizo.core.network.toModel
import java.time.Instant
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class AuthSessionCoordinator internal constructor(
    private val refreshWithToken: suspend (String) -> RefreshTokenResult,
    private val loadAuthSession: () -> AuthSession?,
    private val saveAuthSession: (AuthSession) -> Unit,
    private val clearAuthSession: () -> Unit,
    private val errorMapper: NetworkErrorMapper = NetworkErrorMapper(),
    private val nowEpochSeconds: () -> Long = { Instant.now().epochSecond },
) {
    constructor(
        service: PorizoApiService,
        sessionStore: AndroidSessionStore,
        errorMapper: NetworkErrorMapper = NetworkErrorMapper(),
        nowEpochSeconds: () -> Long = { Instant.now().epochSecond },
    ) : this(
        refreshWithToken = { refreshToken -> service.refresh(RefreshRequestDto(refreshToken)).toModel() },
        loadAuthSession = sessionStore::loadAuthSession,
        saveAuthSession = sessionStore::saveAuthSession,
        clearAuthSession = sessionStore::clearAuthSession,
        errorMapper = errorMapper,
        nowEpochSeconds = nowEpochSeconds,
    )

    private val refreshMutex = Mutex()

    suspend fun <T> protectedCall(block: suspend () -> T): T {
        ensureFreshSession(force = false)
        return try {
            block()
        } catch (error: Throwable) {
            val mapped = errorMapper.map(error)
            if (!mapped.isUnauthorized()) throw mapped
            ensureFreshSession(force = true)
            try {
                block()
            } catch (retryError: Throwable) {
                throw errorMapper.map(retryError)
            }
        }
    }

    suspend fun ensureFreshSession(force: Boolean): AuthSession? {
        val session = loadAuthSession() ?: return null
        if (!force && !session.shouldRefresh()) return session

        return refreshMutex.withLock {
            val latest = loadAuthSession() ?: return@withLock null
            if (!force && !latest.shouldRefresh()) return@withLock latest
            refreshLocked(latest)
        }
    }

    private suspend fun refreshLocked(session: AuthSession): AuthSession =
        try {
            val refresh = refreshWithToken(session.refreshToken)
            AuthSession(
                userId = session.userId,
                accessToken = refresh.accessToken,
                refreshToken = refresh.refreshToken,
                expiresInSeconds = refresh.expiresInSeconds ?: DEFAULT_EXPIRES_IN_SECONDS,
                issuedAtEpochSeconds = nowEpochSeconds(),
            ).also(saveAuthSession)
        } catch (error: Throwable) {
            val mapped = errorMapper.map(error)
            if (mapped.isUnauthorized()) {
                clearAuthSession()
            }
            throw mapped
        }

    private fun AuthSession.shouldRefresh(): Boolean {
        val issuedAt = issuedAtEpochSeconds.takeIf { it > 0L } ?: return true
        val expiresAt = issuedAt + expiresInSeconds
        return nowEpochSeconds() >= expiresAt - REFRESH_SKEW_SECONDS
    }

    private fun Throwable.isUnauthorized(): Boolean =
        this is PorizoFailure.Server && status == 401

    private companion object {
        const val DEFAULT_EXPIRES_IN_SECONDS = 3600
        const val REFRESH_SKEW_SECONDS = 120
    }
}
