//
//  SelectableText.swift
//  PorizoApp
//
//  UITextView wrapper that supports partial text selection in ScrollViews.
//  SwiftUI's .textSelection(.enabled) conflicts with scroll gestures,
//  making selection handle dragging nearly impossible. UITextView handles
//  gesture exclusion zones correctly around selection handles.
//

import SwiftUI

struct SelectableText: UIViewRepresentable {
    let text: String
    var font: UIFont = .systemFont(ofSize: 16)
    var textColor: UIColor = UIColor(DesignTokens.textPrimary)
    var lineSpacing: CGFloat = 0

    func makeUIView(context: Context) -> UITextView {
        let textView = UITextView()
        textView.isEditable = false
        textView.isSelectable = true
        textView.isScrollEnabled = false
        textView.backgroundColor = .clear
        textView.textContainerInset = .zero
        textView.textContainer.lineFragmentPadding = 0
        textView.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        applyText(to: textView)
        return textView
    }

    func updateUIView(_ uiView: UITextView, context: Context) {
        guard uiView.attributedText?.string != text else { return }
        applyText(to: uiView)
    }

    private func applyText(to textView: UITextView) {
        let style = NSMutableParagraphStyle()
        style.lineSpacing = lineSpacing

        textView.attributedText = NSAttributedString(
            string: text,
            attributes: [
                .font: font,
                .foregroundColor: textColor,
                .paragraphStyle: style
            ]
        )
    }
}
