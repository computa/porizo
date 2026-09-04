package com.porizo.core.platform

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialException
import com.porizo.core.domain.platform.GoogleSignInGateway
import com.porizo.core.domain.platform.GoogleSignInToken
import com.porizo.core.domain.platform.PlatformResult
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class GoogleSignInProvider @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val activityHolder: ActivityHolder,
) : GoogleSignInGateway {
    override suspend fun signIn(webClientId: String, nonce: String): PlatformResult<GoogleSignInToken> {
        if (webClientId.isBlank()) {
            return PlatformResult.Failure("Google sign-in is not configured.")
        }
        val activity = activityHolder.current()
            ?: return PlatformResult.Failure("Open the app foreground before signing in with Google.")

        return try {
            val option = GetGoogleIdOption.Builder()
                .setFilterByAuthorizedAccounts(false)
                .setServerClientId(webClientId)
                .setNonce(nonce)
                .setAutoSelectEnabled(false)
                .build()
            val request = GetCredentialRequest.Builder()
                .addCredentialOption(option)
                .build()

            val response = CredentialManager.create(context).getCredential(
                request = request,
                context = activity,
            )
            val credential = response.credential
            if (
                credential is CustomCredential &&
                credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
            ) {
                val googleCredential = GoogleIdTokenCredential.createFrom(credential.data)
                PlatformResult.Success(GoogleSignInToken(googleCredential.idToken))
            } else {
                PlatformResult.Failure("Unexpected credential type from Google sign-in.")
            }
        } catch (error: GetCredentialException) {
            PlatformResult.Failure(error.message ?: "Google sign-in failed.")
        } catch (error: Throwable) {
            PlatformResult.Failure(error.message ?: "Google sign-in failed.")
        }
    }
}
