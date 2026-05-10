#!/usr/bin/env python3
"""
blog-aeo-fixes-v3: applies the auditor-flagged fixes:
  1. Restore graduation-gift-song title (v1 script bug — link in title)
  2. Add "When not to" editorial section to 9 articles (raises Citation Potential + Framework Alignment)
  3. Add inline citations to articles missing them (anchors existing sources in body)

All edits are idempotent — re-running the script is safe.
"""
import os, re

BLOG_DIR = "/Users/ao/Documents/projects/porizo/marketing/blog"


# === Phase A: title fix ===
def fix_graduation_title():
    path = os.path.join(BLOG_DIR, "2026-05-10-graduation-gift-song.md")
    with open(path) as f:
        body = f.read()
    bad = "[Graduation](/graduation-song) Gift Song:"
    good = "Graduation Gift Song:"
    if bad in body:
        body = body.replace(bad, good, 1)
        with open(path, "w") as f:
            f.write(body)
        return True
    return False


# === Phase B: "When not to" sections ===
WHEN_NOT_TO = {
    "pet-memorial-song": ("When Not to Give a Pet Memorial Song", [
        "Do not surprise the recipient publicly while the grief is still raw.",
        "Do not include accusations about how the pet died or who could have prevented it.",
        "Do not send if the family asked for space.",
        "Do not commission a song to make yourself feel better at their expense.",
        "Do not turn the song into a lesson about \"life\" or \"moving on.\"",
        "Do not send if the household had complicated history with the pet (neglect, abuse, surrender).",
    ]),
    "mothers-day-song-gift": ("When Not to Send a Mother's Day Song", [
        "Do not send if your mother explicitly asked you to skip Mother's Day this year.",
        "Do not send to a mom-figure if it would hurt your actual mother to learn about it.",
        "Do not send if you are estranged and the song is a way to bypass that boundary.",
        "Do not send to a mother grieving a child as a \"thank you\" — Mother's Day is hard for that audience.",
        "Do not post the song publicly if your relationship with her is private.",
        "Do not use the song to shame siblings who did not make one.",
    ]),
    "anniversary-song-gift": ("When Not to Give an Anniversary Song", [
        "Do not use the song to skip a hard conversation the marriage needs.",
        "Do not bury a public proposal inside an anniversary song unless you have already discussed marriage.",
        "Do not write the song to fix a problem the relationship actually has.",
        "Do not send to a partner who has explicitly said they do not want big gestures.",
        "Do not include private details a third party would not want shared.",
        "Do not reuse the same song across multiple anniversaries — each year deserves its own.",
    ]),
    "pregnancy-announcement-song": ("When Not to Send a Pregnancy Announcement Song", [
        "Do not send before your partner has had time to share within their inner circle.",
        "Do not send to people who recently lost a pregnancy or child without checking with them first.",
        "Do not include the due date or hospital details if the parents asked to keep those private.",
        "Do not use the song to pressure the recipient to react publicly.",
        "Do not announce broadly before you have told the people who would be hurt to learn second-hand.",
        "Do not surprise the second parent with a public song before they have agreed to share.",
    ]),
    "retirement-song-gift": ("When Not to Give a Retirement Song", [
        "Do not send if the retirement was forced (layoff, health, removal) without honoring that reality.",
        "Do not include inside jokes that exclude the family who will hear it.",
        "Do not embarrass the retiree at a public ceremony with private details.",
        "Do not write the song around your loss when they are also losing something.",
        "Do not send if you have not actually worked alongside them — secondhand details ring false.",
    ]),
    "wedding-song-gift": ("When Not to Give a Wedding Song", [
        "Do not send a song that competes with the couple's chosen first-dance song.",
        "Do not surprise them at the ceremony without coordinating with the planner.",
        "Do not include private details one partner shared that the other does not know.",
        "Do not write a song about how YOU feel about the couple — write it for them.",
        "Do not send the song without context if you cannot attend; a song with no sender present can land cold.",
    ]),
    "graduation-gift-song": ("When Not to Send a Graduation Gift Song", [
        "Do not turn the song into a lecture about the next chapter.",
        "Do not list achievements they would prefer to keep private.",
        "Do not include grades, comparisons to siblings, or \"we always knew you would\" framing that ignores real struggle.",
        "Do not send if the graduation was a difficult one (held back, alternative diploma, transferred) without honoring that journey.",
        "Do not make the song longer than the moment can hold.",
    ]),
    "long-distance-song-gift": ("When Not to Send a Long-Distance Song", [
        "Do not send during a fight or while one person is asking for space.",
        "Do not use the song to pressure the recipient to call back, visit, or move closer.",
        "Do not include past disappointments about the distance — the song should hold the moment, not the grievance.",
        "Do not surprise someone with a public song if the relationship is private to their friends or family.",
        "Do not send the same song you wrote for someone else.",
    ]),
    "newborn-song-gift": ("When Not to Send a Newborn Song", [
        "Do not send too soon after birth — give the parents days, not hours.",
        "Do not include the baby's full name or hospital details before the parents announce them.",
        "Do not send to family members who have asked for privacy after a difficult birth.",
        "Do not assume the parents will want it played at the baby's first birthday — let them choose.",
        "Do not send if there are recent miscarriage, stillbirth, or fertility losses in the wider family without checking first.",
    ]),
}


def add_when_not_to(slug, header, items):
    path = os.path.join(BLOG_DIR, f"2026-05-10-{slug}.md")
    if not os.path.exists(path):
        return f"SKIP {slug}: not found"
    with open(path) as f:
        body = f.read()

    # Idempotent check
    if f"## {header}" in body:
        return f"SKIP {slug}: section already present"

    section = f"\n## {header}\n\nDo not send the song if any of these apply:\n\n"
    for item in items:
        section += f"- {item}\n"
    section += "\n"

    # Insert BEFORE "## Frequently Asked Questions"
    faq_match = re.search(r"^## (?:Frequently Asked Questions|FAQs?)\s*$", body, re.MULTILINE)
    if faq_match:
        insertion_point = faq_match.start()
        body = body[:insertion_point] + section + body[insertion_point:]
        with open(path, "w") as f:
            f.write(body)
        return f"OK {slug}: added '{header}' before FAQs"
    else:
        return f"WARN {slug}: no FAQ section to anchor; skipping"


# === Phase C: inline citations ===
# Anchor to existing sources in the article. Each rule: (slug, find_text, citation_link)
INLINE_CITATIONS = [
    # proposal-song-gift: weave Experiential Gifts paper into the intro paragraph
    (
        "proposal-song-gift",
        "That matters because public romantic gestures can feel meaningful or pressuring depending on the person.",
        "That matters because public romantic gestures can feel meaningful or pressuring depending on the person. Research on experiential gifts shows recipients value shared-memory gifts more than material items, especially in romantic contexts. [Experiential Gifts Foster Stronger Social Relationships](https://academic.oup.com/jcr/article-abstract/43/6/913/2632328)",
    ),
    # baby-announcement-song: cite ACOG on early-pregnancy disclosure norms
    (
        "baby-announcement-song",
        None,  # will append a paragraph if no anchor found
        None,
    ),
    # gender-reveal-song: cite something on family communication patterns
    (
        "gender-reveal-song",
        None,
        None,
    ),
    # graduation-gift-song: cite identity-transition research
    (
        "graduation-gift-song",
        None,
        None,
    ),
    # long-distance-song-gift: needs a real .org/.edu source AND inline citation.
    (
        "long-distance-song-gift",
        None,
        None,
    ),
]


def add_inline_citation(slug, find_text, replacement):
    path = os.path.join(BLOG_DIR, f"2026-05-10-{slug}.md")
    if not os.path.exists(path):
        return f"SKIP {slug}: not found"
    if find_text is None or replacement is None:
        return f"SKIP {slug}: no rule (handled separately)"
    with open(path) as f:
        body = f.read()
    if find_text not in body:
        return f"WARN {slug}: anchor text not found"
    if replacement.split("[")[0].strip() in body and "[Experiential Gifts" in body:
        # already inserted (idempotent)
        # check if the citation link is already in body
        if "academic.oup.com/jcr/article-abstract/43/6/913/2632328" in body:
            # already cited inline?
            sources_idx = body.find("## Sources")
            body_part = body[:sources_idx] if sources_idx > 0 else body
            if "Experiential Gifts](https://academic.oup.com" in body_part:
                return f"SKIP {slug}: already cited inline"
    body = body.replace(find_text, replacement, 1)
    with open(path, "w") as f:
        f.write(body)
    return f"OK {slug}: inline citation added"


def main():
    print("=== Phase A: title bug fix ===")
    if fix_graduation_title():
        print("OK graduation-gift-song: title bug fixed")
    else:
        print("SKIP graduation-gift-song: already clean")

    print("\n=== Phase B: 'When not to' sections ===")
    for slug, (header, items) in WHEN_NOT_TO.items():
        print(add_when_not_to(slug, header, items))

    print("\n=== Phase C: inline citations ===")
    for slug, find_text, replacement in INLINE_CITATIONS:
        print(add_inline_citation(slug, find_text, replacement))

    print("\nDone. Re-run blog-aeo-audit.py to verify.")


if __name__ == "__main__":
    main()
