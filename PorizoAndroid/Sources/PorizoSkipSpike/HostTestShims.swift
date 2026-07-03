#if os(macOS)
import SwiftUI

// Host-test shims.
//
// The Skip test pipeline (`swift test`) compiles this module for macOS before
// transpiling tests to Kotlin. Several iOS-only SwiftUI modifiers used across the
// UI (navigationBarTitleDisplayMode, textInputAutocapitalization, keyboardType,
// autocorrectionDisabled) do not exist on macOS, which breaks that host compile
// and prevents ANY test from transpiling/running.
//
// These no-op shims exist ONLY for the macOS host compile so the module builds
// and tests can run. They are never used on iOS (where the real modifiers exist)
// or on the Android/Skip transpile path (SkipUI provides its own). Compiled under
// `#if os(macOS)` only, so there is no collision with the real APIs.

// Concrete stand-in types so the leading-dot member syntax at call sites
// (`.inline`, `.never`, `.phonePad`, `.numberPad`) resolves on macOS.
struct HostBarTitleDisplayMode { static let inline = HostBarTitleDisplayMode(); static let large = HostBarTitleDisplayMode(); static let automatic = HostBarTitleDisplayMode() }
struct HostTextInputAutocapitalization { static let never = HostTextInputAutocapitalization(); static let sentences = HostTextInputAutocapitalization(); static let words = HostTextInputAutocapitalization(); static let characters = HostTextInputAutocapitalization() }
struct HostKeyboardType { static let phonePad = HostKeyboardType(); static let numberPad = HostKeyboardType(); static let `default` = HostKeyboardType() }

// Only shim the modifiers macOS SwiftUI genuinely lacks. `autocorrectionDisabled`
// and `toolbar` DO exist on macOS — shimming them causes ambiguity, so they are
// intentionally omitted here.
extension View {
    func navigationBarTitleDisplayMode(_ mode: HostBarTitleDisplayMode) -> some View { self }
    func textInputAutocapitalization(_ value: HostTextInputAutocapitalization?) -> some View { self }
    func keyboardType(_ type: HostKeyboardType) -> some View { self }
}
#endif
