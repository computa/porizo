import Foundation
import SkipFuse
import SwiftUI

/// A logger for the Porizo Android module.
let logger: Logger = Logger(subsystem: AndroidAppConfig.applicationId, category: "PorizoAndroid")

/// The shared top-level view for the app, loaded from the platform-specific App delegates below.
///
/// The default implementation merely loads the `ContentView` for the app and logs a message.
/* SKIP @bridge */public struct PorizoSkipSpikeRootView : View {
    /* SKIP @bridge */public init() {
    }

    public var body: some View {
        ContentView()
            // App-wide accent = Warm Canvas coral, matching iOS. Without this, Skip/Compose
            // tints default controls (buttons, links, toggles, progress) with its own blue.
            .tint(DesignTokens.gold)
            .task {
                logger.info("Porizo Android logs can be viewed in Android Studio or using adb logcat")
            }
    }
}

/// Global application delegate functions.
///
/// These functions can update a shared observable object to communicate app state changes to interested views.
/* SKIP @bridge */public final class PorizoSkipSpikeAppDelegate : Sendable {
    /* SKIP @bridge */public static let shared = PorizoSkipSpikeAppDelegate()

    private init() {
    }

    /* SKIP @bridge */public func onInit() {
        logger.debug("onInit")
    }

    /* SKIP @bridge */public func onLaunch() {
        logger.debug("onLaunch")
    }

    /* SKIP @bridge */public func onOpenURL(_ rawURL: String) {
        logger.info("onOpenURL")
        AndroidDeepLinkStore().save(rawURL: rawURL)
        // Invoke the mounted view's consume callback so a warm link (onNewIntent
        // while foregrounded, no scenePhase transition) presents immediately.
        Task { @MainActor in AndroidDeepLinkInbox.onLink?() }
    }

    /* SKIP @bridge */public func onResume() {
        logger.debug("onResume")
    }

    /* SKIP @bridge */public func onPause() {
        logger.debug("onPause")
    }

    /* SKIP @bridge */public func onStop() {
        logger.debug("onStop")
    }

    /* SKIP @bridge */public func onDestroy() {
        logger.debug("onDestroy")
    }

    /* SKIP @bridge */public func onLowMemory() {
        logger.debug("onLowMemory")
    }
}
