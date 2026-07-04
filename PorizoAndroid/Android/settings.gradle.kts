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
