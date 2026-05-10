#!/usr/bin/env python3
"""
blog-aeo-fixes-v4: weave existing Sources into the article body as inline citations.

For 3 articles, anchor an existing source into a relevant body paragraph so the audit
counts inline citations. (long-distance-song-gift already has one.)
"""
import os

BLOG_DIR = "/Users/ao/Documents/projects/porizo/marketing/blog"

# Each: (slug, anchor_phrase_to_replace, replacement_text)
# Anchor phrase must be unique within the article.
RULES = [
    (
        "baby-announcement-song",
        "That matters because birth announcements are often forwarded, screenshotted, and saved. A song can carry the same information as a card while adding the emotion of a voice, melody, and family memory.",
        "That matters because birth announcements are often forwarded, screenshotted, and saved. Research on experiential gifts shows recipients value gifts that create shared memories more than material items, especially among close family. [Experiential Gifts Foster Stronger Social Relationships](https://academic.oup.com/jcr/article-abstract/43/6/913/2632328) A song can carry the same information as a card while adding the emotion of a voice, melody, and family memory.",
    ),
    (
        "gender-reveal-song",
        "That distinction matters because reveal moments are often recorded, shared, and kept. A song can become part of the family archive, so the words should age well.",
        "That distinction matters because reveal moments are often recorded, shared, and kept. Research on experiential gifts finds that experience-based gifts foster stronger social bonds than material ones, which is part of why a personalized song outlasts a balloon-pop video. [Experiential Gifts Foster Stronger Social Relationships](https://academic.oup.com/jcr/article-abstract/43/6/913/2632328) A song can become part of the family archive, so the words should age well.",
    ),
    (
        "graduation-gift-song",
        "That matters because graduation is both achievement and transition. A personalized song can become a keepsake of the person they were before the next chapter starts.",
        "That matters because graduation is both achievement and transition. Research on experiential gifts finds they foster stronger social bonds than material gifts, partly because the recipient associates the gift with the person who gave it during a meaningful moment. [Experiential Gifts Foster Stronger Social Relationships](https://academic.oup.com/jcr/article-abstract/43/6/913/2632328) A personalized song can become a keepsake of the person they were before the next chapter starts.",
    ),
]


def apply(slug, anchor, replacement):
    path = os.path.join(BLOG_DIR, f"2026-05-10-{slug}.md")
    if not os.path.exists(path):
        return f"SKIP {slug}: not found"
    with open(path) as f:
        body = f.read()
    if "academic.oup.com/jcr/article-abstract/43/6/913/2632328" in body.split("## Sources")[0]:
        return f"SKIP {slug}: already has inline citation"
    if anchor not in body:
        return f"WARN {slug}: anchor not found"
    body = body.replace(anchor, replacement, 1)
    with open(path, "w") as f:
        f.write(body)
    return f"OK {slug}: inline citation added"


def main():
    for slug, anchor, replacement in RULES:
        print(apply(slug, anchor, replacement))


if __name__ == "__main__":
    main()
