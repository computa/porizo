package com.porizo.core.platform

import android.app.Activity
import java.lang.ref.WeakReference
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ActivityHolder @Inject constructor() {
    private var activityRef: WeakReference<Activity>? = null

    fun set(activity: Activity?) {
        activityRef = activity?.let(::WeakReference)
    }

    fun current(): Activity? = activityRef?.get()
}
