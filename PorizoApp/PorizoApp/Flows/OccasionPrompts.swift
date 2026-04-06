//
//  OccasionPrompts.swift
//  PorizoApp
//
//  Contextual prompts for story input, organized by occasion.
//  Used by create-flow surfaces to guide users in telling their story.
//

import Foundation

/// Contextual prompts that help users tell better stories, organized by occasion
struct OccasionPrompts {
    /// Prompt chips that appear as tappable suggestions
    struct PromptChip: Identifiable {
        let id = UUID()
        let label: String
        let fullPrompt: String
    }

    /// Get prompts for a specific occasion
    static func prompts(for occasion: Occasion) -> [PromptChip] {
        switch occasion {
        case .birthday:
            return [
                PromptChip(label: "A favorite memory", fullPrompt: "One of my favorite memories with them is "),
                PromptChip(label: "What makes them special", fullPrompt: "What makes them special to me is "),
                PromptChip(label: "Your birthday wish", fullPrompt: "This year, I wish for them "),
            ]
        case .wedding:
            return [
                PromptChip(label: "How you met", fullPrompt: "The story of how we met is "),
                PromptChip(label: "What you love most", fullPrompt: "What I love most about them is "),
                PromptChip(label: "Your hopes for them", fullPrompt: "My hopes for their future are "),
            ]
        case .anniversary:
            return [
                PromptChip(label: "A cherished moment", fullPrompt: "A moment I'll always cherish is "),
                PromptChip(label: "How they've changed you", fullPrompt: "They've changed my life by "),
                PromptChip(label: "What you're grateful for", fullPrompt: "I'm grateful for "),
            ]
        case .thankYou:
            return [
                PromptChip(label: "What they did", fullPrompt: "What they did for me was "),
                PromptChip(label: "How it helped", fullPrompt: "It helped me by "),
                PromptChip(label: "What it meant to you", fullPrompt: "It meant so much because "),
            ]
        case .iLoveYou:
            return [
                PromptChip(label: "When you knew", fullPrompt: "I knew I loved them when "),
                PromptChip(label: "What you admire", fullPrompt: "Something I admire about them is "),
                PromptChip(label: "A special moment", fullPrompt: "A special moment we shared was "),
            ]
        case .graduation:
            return [
                PromptChip(label: "Their journey", fullPrompt: "Their journey to get here included "),
                PromptChip(label: "What you're proud of", fullPrompt: "I'm so proud of them because "),
                PromptChip(label: "Advice for them", fullPrompt: "My advice for their next chapter is "),
            ]
        case .apology:
            return [
                PromptChip(label: "What happened", fullPrompt: "I want to apologize for "),
                PromptChip(label: "How you feel", fullPrompt: "I feel "),
                PromptChip(label: "How you'll do better", fullPrompt: "Going forward, I promise to "),
            ]
        case .encouragement:
            return [
                PromptChip(label: "The challenge they face", fullPrompt: "I know they're going through "),
                PromptChip(label: "Why you believe in them", fullPrompt: "I believe in them because "),
                PromptChip(label: "A time they overcame", fullPrompt: "I remember when they overcame "),
            ]
        case .advice:
            return [
                PromptChip(label: "What they should remember", fullPrompt: "What I want them to remember is "),
                PromptChip(label: "A lesson from experience", fullPrompt: "One lesson I've learned is "),
                PromptChip(label: "Your guiding words", fullPrompt: "My advice for them is "),
            ]
        case .bereavement:
            return [
                PromptChip(label: "Who they are honoring", fullPrompt: "We remember "),
                PromptChip(label: "A comforting memory", fullPrompt: "A memory that brings comfort is "),
                PromptChip(label: "Words of support", fullPrompt: "I want them to know "),
            ]
        case .celebration:
            return [
                PromptChip(label: "The achievement", fullPrompt: "This celebration is about "),
                PromptChip(label: "Why it matters", fullPrompt: "This matters because "),
                PromptChip(label: "How you feel about it", fullPrompt: "I feel so "),
            ]
        case .friendship:
            return [
                PromptChip(label: "How you became friends", fullPrompt: "We became friends when "),
                PromptChip(label: "A favorite memory together", fullPrompt: "One of my favorite memories is "),
                PromptChip(label: "What they mean to you", fullPrompt: "What they mean to me is "),
            ]
        case .getWell:
            return [
                PromptChip(label: "What they're going through", fullPrompt: "I know they're dealing with "),
                PromptChip(label: "A happy memory", fullPrompt: "A memory that always makes us smile is "),
                PromptChip(label: "Your wish for them", fullPrompt: "I wish for them "),
            ]
        case .custom:
            return [
                PromptChip(label: "The story behind this", fullPrompt: "The story behind this is "),
                PromptChip(label: "What you want to say", fullPrompt: "What I really want to say is "),
                PromptChip(label: "How you hope they feel", fullPrompt: "I hope they feel "),
            ]
        }
    }

    /// Get contextual input guidance for the text area based on occasion.
    static func inputPrompt(for occasion: Occasion, recipientName: String) -> String {
        let name = recipientName.isEmpty ? "them" : recipientName
        switch occasion {
        case .birthday:
            return "What makes this birthday special for \(name)?"
        case .wedding:
            return "Share the love story or a special moment..."
        case .anniversary:
            return "What does this time together mean to you?"
        case .thankYou:
            return "What do you want to thank \(name) for?"
        case .iLoveYou:
            return "What do you love most about \(name)?"
        case .graduation:
            return "What makes \(name)'s achievement special?"
        case .apology:
            return "What do you want \(name) to understand?"
        case .encouragement:
            return "What do you want \(name) to know?"
        case .advice:
            return "What advice do you want \(name) to carry forward?"
        case .bereavement:
            return "What comforting words do you want to share with \(name)?"
        case .celebration:
            return "What are we celebrating about \(name)?"
        case .friendship:
            return "What makes your friendship with \(name) special?"
        case .getWell:
            return "What do you want \(name) to know as they recover?"
        case .custom:
            return "Tell us what makes this moment special..."
        }
    }

    /// Get a header title for the story input screen
    static func headerTitle(for recipientName: String) -> String {
        if recipientName.isEmpty {
            return "Tell us your story"
        }
        return "Tell us about \(recipientName)"
    }
}
