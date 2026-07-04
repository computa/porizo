package com.porizo.core.network

import com.porizo.core.model.PorizoFailure
import com.squareup.moshi.Moshi
import retrofit2.HttpException

class NetworkErrorMapper(
    moshi: Moshi = PorizoNetworkClient.moshi(),
) {
    private val errorAdapter = moshi.adapter(ErrorEnvelopeDto::class.java)

    fun map(error: Throwable): Throwable {
        val http = error as? HttpException ?: return error
        val envelope = runCatching {
            http.response()?.errorBody()?.string()?.let { body ->
                if (body.isBlank()) null else errorAdapter.fromJson(body)
            }
        }.getOrNull()
        return PorizoFailure.Server(
            status = http.code(),
            code = envelope?.code ?: envelope?.error,
            message = envelope?.message ?: "Request failed with status ${http.code()}.",
        )
    }
}
