import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
}

val localPropertiesFile = file("keystore.properties")
val localProperties = Properties().also { properties ->
    if (localPropertiesFile.isFile) {
        localPropertiesFile.inputStream().use(properties::load)
    }
}
val releaseSigningPropertyNames = listOf("keyAlias", "keyPassword", "storeFile", "storePassword")
val hasReleaseSigningProperties: Boolean =
    localPropertiesFile.isFile &&
        releaseSigningPropertyNames.all { name -> !localProperties.getProperty(name).isNullOrBlank() }
val googleWebClientId: String =
    providers.gradleProperty("porizoGoogleWebClientId")
        .orElse(providers.environmentVariable("PORIZO_GOOGLE_WEB_CLIENT_ID"))
        .orElse(localProperties.getProperty("porizoGoogleWebClientId") ?: "")
        .orElse("")
        .get()
val allowDebugReleaseSigning: Boolean =
    providers.gradleProperty("allowDebugReleaseSigning")
        .map(String::toBoolean)
        .orElse(false)
        .get()

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_17
    }
}

android {
    namespace = "com.porizo.app"
    compileSdk = libs.versions.android.sdk.compile.get().toInt()

    defaultConfig {
        applicationId = "com.porizo.app"
        minSdk = libs.versions.android.sdk.min.get().toInt()
        targetSdk = libs.versions.android.sdk.compile.get().toInt()
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("String", "PORIZO_API_BASE_URL", "\"https://api.porizo.co/\"")
        buildConfigField("String", "PORIZO_GOOGLE_WEB_CLIENT_ID", "\"$googleWebClientId\"")
        buildConfigField("String", "PORIZO_ONESIGNAL_APP_ID", "\"67365cfb-f88a-44cc-ba25-29a9a01d01f0\"")
        buildConfigField("String", "PORIZO_SUBSCRIPTION_PRODUCT_IDS", "\"com.porizo.plus_monthly,com.porizo.plus_annual,com.porizo.pro_monthly,com.porizo.pro_annual\"")
        buildConfigField("String", "PORIZO_ONE_TIME_PRODUCT_IDS", "\"com.porizo.gift_token_oneoff,com.porizo.gift_bundle_1,com.porizo.gift_bundle_3,com.porizo.gift_bundle_5\"")
        buildConfigField("boolean", "PORIZO_ENABLE_VOICE_ENROLLMENT", "false")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.toVersion(libs.versions.jvm.get())
        targetCompatibility = JavaVersion.toVersion(libs.versions.jvm.get())
    }

    buildFeatures {
        buildConfig = true
        compose = true
    }

    dependenciesInfo {
        includeInApk = false
        includeInBundle = false
    }

    signingConfigs {
        create("release") {
            if (hasReleaseSigningProperties) {
                keyAlias = localProperties.getProperty("keyAlias")
                keyPassword = localProperties.getProperty("keyPassword")
                storeFile = file(localProperties.getProperty("storeFile"))
                storePassword = localProperties.getProperty("storePassword")
            } else {
                keyAlias = signingConfigs.getByName("debug").keyAlias
                keyPassword = signingConfigs.getByName("debug").keyPassword
                storeFile = signingConfigs.getByName("debug").storeFile
                storePassword = signingConfigs.getByName("debug").storePassword
            }
        }
    }

    buildTypes {
        debug {
            isDebuggable = true
        }
        release {
            signingConfig = signingConfigs.findByName("release")
            isMinifyEnabled = true
            isShrinkResources = true
            isDebuggable = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
}

gradle.taskGraph.whenReady {
    val requestsReleaseArtifact = allTasks.any { task ->
        task.path in setOf(":app:assembleRelease", ":app:bundleRelease")
    }
    if (requestsReleaseArtifact && !hasReleaseSigningProperties && !allowDebugReleaseSigning) {
        throw GradleException(
            "Release signing requires keyAlias, keyPassword, storeFile, and storePassword in app/keystore.properties. " +
                "For local packaging smoke tests only, rerun with -PallowDebugReleaseSigning=true.",
        )
    }
    if (requestsReleaseArtifact && googleWebClientId.isBlank()) {
        throw GradleException(
            "Release builds require a Google OAuth Web Client ID. " +
                "Set porizoGoogleWebClientId in app/keystore.properties, pass " +
                "-PporizoGoogleWebClientId=..., or export PORIZO_GOOGLE_WEB_CLIENT_ID.",
        )
    }
}

dependencies {
    implementation(project(":core:model"))
    implementation(project(":core:domain"))
    implementation(project(":core:data"))
    implementation(project(":core:media"))
    implementation(project(":core:platform"))
    implementation(project(":core:share"))
    implementation(project(":core:ui"))
    implementation(project(":feature:auth"))
    implementation(project(":feature:claim"))
    implementation(project(":feature:create"))
    implementation(project(":feature:library"))
    implementation(project(":feature:onboarding"))
    implementation(project(":feature:settings"))

    implementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(platform(libs.androidx.compose.bom))

    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material.icons.extended)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.hilt.android)

    ksp(libs.hilt.compiler)

    debugImplementation(libs.androidx.compose.ui.tooling)
}
