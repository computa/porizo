//
//  PressableButtonStyle.swift
//  PorizoApp
//
//  Subtle tactile press feedback for primary CTAs — a scale(0.96) on press with
//  a no-bounce spring. From the make-interfaces-feel-better design principles
//  ("Scale on Press": always 0.96, never below 0.95; spring bounce must be 0).
//

import SwiftUI

struct PressableButtonStyle: ButtonStyle {
    var scale: CGFloat = 0.96

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? scale : 1)
            .animation(.spring(duration: 0.3, bounce: 0), value: configuration.isPressed)
    }
}
