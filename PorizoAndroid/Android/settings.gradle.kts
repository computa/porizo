pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "PorizoAndroid"
include(":app")
include(":core:model")
include(":core:domain")
include(":core:network")
include(":core:datastore")
include(":core:data")
include(":core:ui")
include(":core:media")
include(":core:share")
include(":feature:auth")
include(":feature:claim")
include(":feature:onboarding")
include(":feature:library")
