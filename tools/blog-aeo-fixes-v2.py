#!/usr/bin/env python3
"""
blog-aeo-fixes-v2: adds an explicit "Related guides" section before each article's
Sources section. Reliable cross-linking that doesn't depend on natural phrase matches.

Idempotent — checks for existing Related guides marker before adding.
"""
import os, re

BLOG_DIR = "/Users/ao/Documents/projects/porizo/marketing/blog"
RELATED_MARKER = "## Related guides"

# slug -> [(label, url), ...]
# Mix of existing static landing pages (/foo) and sibling blog posts (/blog/bar).
RELATED = {
    "apology-song": [
        ("Anniversary song gift", "/anniversary-song-gift"),
        ("Wedding song gift", "/wedding-song-gift"),
        ("Custom song gift", "/custom-song-gift"),
    ],
    "long-distance-song-gift": [
        ("Birthday song for mom", "/birthday-song-for-mom"),
        ("Birthday song for dad", "/birthday-song-for-dad"),
        ("Custom song gift", "/custom-song-gift"),
    ],
    "anniversary-song-gift": [
        ("Wedding song gift", "/wedding-song-gift"),
        ("Custom song gift", "/custom-song-gift"),
        ("Proposal song gift", "/blog/proposal-song-gift"),
    ],
    "mothers-day-song-gift": [
        ("Mother's Day song", "/mothers-day-song"),
        ("Birthday song for mom", "/birthday-song-for-mom"),
        ("Custom song gift", "/custom-song-gift"),
    ],
    "pet-memorial-song": [
        ("Memorial song gift", "/blog/memorial-song-gift"),
        ("Custom song gift", "/custom-song-gift"),
    ],
    "baby-announcement-song": [
        ("Newborn song gift", "/blog/newborn-song-gift"),
        ("Pregnancy announcement song", "/blog/pregnancy-announcement-song"),
        ("Custom song gift", "/custom-song-gift"),
    ],
    "pregnancy-announcement-song": [
        ("Baby announcement song", "/blog/baby-announcement-song"),
        ("Gender reveal song", "/blog/gender-reveal-song"),
        ("Newborn song gift", "/blog/newborn-song-gift"),
    ],
    "gender-reveal-song": [
        ("Baby announcement song", "/blog/baby-announcement-song"),
        ("Pregnancy announcement song", "/blog/pregnancy-announcement-song"),
        ("Newborn song gift", "/blog/newborn-song-gift"),
    ],
    "newborn-song-gift": [
        ("Baby announcement song", "/blog/baby-announcement-song"),
        ("Birthday song for mom", "/birthday-song-for-mom"),
        ("Custom song gift", "/custom-song-gift"),
    ],
    "graduation-gift-song": [
        ("Graduation song", "/graduation-song"),
        ("Custom song gift", "/custom-song-gift"),
        ("Birthday song for dad", "/birthday-song-for-dad"),
    ],
    "retirement-song-gift": [
        ("Anniversary song gift", "/anniversary-song-gift"),
        ("Custom song gift", "/custom-song-gift"),
        ("Birthday song for dad", "/birthday-song-for-dad"),
    ],
    "proposal-song-gift": [
        ("Wedding song gift", "/wedding-song-gift"),
        ("Anniversary song gift", "/anniversary-song-gift"),
        ("Custom song gift", "/custom-song-gift"),
    ],
    "wedding-song-gift": [
        ("Anniversary song gift", "/anniversary-song-gift"),
        ("Proposal song gift", "/blog/proposal-song-gift"),
        ("Custom song gift", "/custom-song-gift"),
    ],
}


def fix_article(slug, related):
    path = os.path.join(BLOG_DIR, f"2026-05-10-{slug}.md")
    if not os.path.exists(path):
        return f"SKIP {slug}: file not found"

    with open(path, "r", encoding="utf-8") as f:
        body = f.read()

    if RELATED_MARKER in body:
        return f"SKIP {slug}: already has Related guides"

    # Build the Related block
    lines = [RELATED_MARKER, ""]
    for label, url in related:
        lines.append(f"- [{label}]({url})")
    lines.append("")
    related_block = "\n".join(lines)

    # Insert just BEFORE "## Sources" if present, else before the final --- separator,
    # else append at end of body before any closing CTA paragraph
    sources_match = re.search(r"^## Sources\s*$", body, re.MULTILINE)
    if sources_match:
        insertion_point = sources_match.start()
        body = body[:insertion_point] + related_block + "\n" + body[insertion_point:]
    else:
        # Try inserting before the final --- separator
        sep_match = list(re.finditer(r"^---\s*$", body, re.MULTILINE))
        if sep_match:
            last = sep_match[-1]
            insertion_point = last.start()
            body = body[:insertion_point] + related_block + "\n" + body[insertion_point:]
        else:
            body = body.rstrip() + "\n\n" + related_block + "\n"

    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    return f"OK {slug}: added {len(related)} related links"


def main():
    results = []
    for slug, related in RELATED.items():
        results.append(fix_article(slug, related))
    for r in results:
        print(r)
    print()
    print(f"Total: {len(results)}, modified: {sum(1 for r in results if r.startswith('OK'))}")


if __name__ == "__main__":
    main()
