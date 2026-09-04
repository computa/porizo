package com.porizo.core.model

sealed class PorizoFailure(message: String? = null) : RuntimeException(message) {
    data class ServerDetails(
        val maskedEmail: String? = null,
        val authMethods: List<String> = emptyList(),
    )

    data class Server(
        val status: Int,
        val code: String?,
        override val message: String?,
        val details: ServerDetails? = null,
    ) : PorizoFailure(message)

    data object NotAuthenticated : PorizoFailure("Not authenticated")
    data class Network(override val message: String?) : PorizoFailure(message)
    data class Unknown(override val message: String?) : PorizoFailure(message)
}
