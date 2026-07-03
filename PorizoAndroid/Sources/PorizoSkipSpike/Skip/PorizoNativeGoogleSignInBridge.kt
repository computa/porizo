package porizo.skip.spike

import android.app.Activity
import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.runBlocking

/**
 * Google Sign-In via Credential Manager (U4c).
 *
 * The Swift side (AndroidGoogleSignIn) calls `signIn(...)` from an async Task and
 * expects a synchronous pipe-delimited result, so the suspend `getCredential`
 * call is bridged with `runBlocking` — matching the recorder/billing bridge shape.
 *
 * Requires a foreground Activity (wired via setActivity in MainActivity) and a
 * Google OAuth **Web** client id (AndroidAppConfig.googleWebClientId). Returns
 * "OK|<idToken>" or "ERR|<reason>".
 */
object PorizoNativeGoogleSignInBridge {
    private var currentActivity: Activity? = null

    fun setActivity(activity: Activity?) {
        currentActivity = activity
    }

    fun signIn(context: Context, webClientId: String): String {
        if (webClientId.isBlank()) {
            return "ERR|Google sign-in is not configured (missing Web client id)."
        }
        val activity = currentActivity
            ?: return "ERR|Open the app foreground before signing in with Google."

        return try {
            val option = GetGoogleIdOption.Builder()
                .setFilterByAuthorizedAccounts(false)
                .setServerClientId(webClientId)
                .setAutoSelectEnabled(false)
                .build()
            val request = GetCredentialRequest.Builder()
                .addCredentialOption(option)
                .build()
            val manager = CredentialManager.create(context)

            val response = runBlocking {
                manager.getCredential(request = request, context = activity)
            }
            val credential = response.credential
            if (credential is CustomCredential &&
                credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
            ) {
                val googleCredential = GoogleIdTokenCredential.createFrom(credential.data)
                "OK|${googleCredential.idToken}"
            } else {
                "ERR|Unexpected credential type from Google sign-in."
            }
        } catch (e: Exception) {
            "ERR|${e.message ?: "Google sign-in failed"}"
        }
    }
}
