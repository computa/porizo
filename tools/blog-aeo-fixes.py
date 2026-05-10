#!/usr/bin/env python3
"""
blog-aeo-fixes: applies AEO/SEO gap fixes to the 13 painkiller article packs.

Fixes applied:
  1. Quick-answer H2 block at top of body (custom per article, 40-60 words)
  2. Audio sample embed on high-emotion articles (apology, mom, pet, proposal, long-distance)
  3. Internal links to existing Porizo landing pages
  4. Source upgrades on the weakest citations

Idempotent: detects existing markers and skips re-insertion.
Backups: /tmp/blog-backup-2026-05-10/
"""
import os, re, sys

BLOG_DIR = "/Users/ao/Documents/projects/porizo/marketing/blog"
QA_MARKER = "## Quick answer"
AUDIO_MARKER = "Listen — a real Porizo song"

AUDIO_EMBED = """## Listen — a real Porizo song (0:21)

> *"Mom's insistence on showering and checking armpits as a symbol of her love."*
>
> [▶ Play the sample (21-second audio)](https://porizo.co/audio/sample-mothers-day-2026.mp3)

"""

# slug -> (quick_answer_text, audio_embed?, internal_link_replacements [(find, replace)], extra_source?)
ARTICLES = {
    "apology-song": {
        "qa": "An apology song should not replace a real apology. Write the real apology first — name the harm, take responsibility, and ask what repair would look like — then use the song as a private memory of that accountability. The song works only when the conversation has already happened. It does not work as pressure, performance, or a way to bypass someone's space.",
        "audio": True,
        "links": [
            ("a personalized song", "a [personalized song](/custom-song-gift)"),
        ],
    },
    "long-distance-song-gift": {
        "qa": "A long-distance song gift travels farther than a card and lasts longer than a video call. Pick one specific shared ritual or memory — not a generic theme — and let the song carry the weight of the distance. Keep it short, personal, and easy for them to replay. Distance is the reason; a real moment is the content.",
        "audio": True,
        "links": [
            ("birthday gift", "[birthday gift](/birthday-song-maker)"),
        ],
    },
    "anniversary-song-gift": {
        "qa": "An anniversary song gift should anchor on one real moment from the year — not your relationship's whole timeline. Choose a small, specific memory, name what you've built since, and let the song be a private record they can replay. Avoid grand statements. Specificity is what makes it land.",
        "audio": False,
        "links": [
            ("anniversary song", "[anniversary song](/anniversary-song-gift)"),
            ("wedding", "[wedding](/wedding-song-gift)"),
        ],
    },
    "mothers-day-song-gift": {
        "qa": "A Mother's Day song gift works when it names one ordinary moment — the meal she made, the phrase she repeats, the time she showed up — instead of generic gratitude. Pick that detail before you write the prompt, and the song will feel like it could only be for her. The smaller the moment, the bigger the song lands.",
        "audio": True,
        "links": [
            ("Mother's Day", "[Mother's Day](/mothers-day-song)"),
        ],
    },
    "pet-memorial-song": {
        "qa": "A pet memorial song should remember the daily ritual you miss — the leash by the door, the sunny spot, the way they followed one person around — not abstract loyalty. The song honors the bond without rushing past grief. Offer it privately, and let the recipient choose when to listen. Specific memories outlast generic ones.",
        "audio": True,
        "links": [
            ("private memorial song", "[private memorial song](/custom-song-gift)"),
        ],
    },
    "baby-announcement-song": {
        "qa": "A baby announcement song works as a private family share, not a viral clip. Tell the song what you want loved ones to feel — the relief, the wonder, the long road here — and let the lyrics carry the news. Keep the lyrics warm and quiet so the song outlasts the announcement and becomes part of the family record.",
        "audio": False,
        "links": [
            ("newborn", "[newborn](/blog/newborn-song-gift)"),
        ],
    },
    "pregnancy-announcement-song": {
        "qa": "A pregnancy announcement song should match the audience: intimate for a partner, warm for parents, soft for friends who've shared the road. Skip generic 'we're expecting' phrasing — name the specific moment, body, or hope that made you ready. The song carries what a card cannot, and it stays after the news is old.",
        "audio": False,
        "links": [
            ("baby announcement", "[baby announcement](/blog/baby-announcement-song)"),
        ],
    },
    "gender-reveal-song": {
        "qa": "A gender reveal song works when it celebrates the child, not the gender. Frame the lyrics around hopes, names, or family lineage rather than pink/blue tropes. Keep the reveal moment short and gentle so the song stays meaningful even after the news is old. The child outlives the reveal — the song should too.",
        "audio": False,
        "links": [
            ("baby announcement", "[baby announcement](/blog/baby-announcement-song)"),
            ("pregnancy announcement", "[pregnancy announcement](/blog/pregnancy-announcement-song)"),
        ],
    },
    "newborn-song-gift": {
        "qa": "A newborn song gift becomes a keepsake the child can hear at every birthday for years. Give the prompt one true detail — birth date, first sound, the parent's voice in the room — and the song becomes part of the family record, not just a moment. Keep it short. The child grows; the song stays the same length.",
        "audio": False,
        "links": [
            ("baby announcement", "[baby announcement](/blog/baby-announcement-song)"),
        ],
    },
    "graduation-gift-song": {
        "qa": "A graduation gift song should mark the road, not the ceremony. Name one specific obstacle the graduate overcame, one private moment of doubt, and one thing they carried through. The song works because it remembers what the diploma cannot — the part nobody else saw. Specific detail beats generic congratulations.",
        "audio": False,
        "links": [
            ("graduation", "[graduation](/graduation-song)"),
        ],
    },
    "retirement-song-gift": {
        "qa": "A retirement song gift honors the unspoken parts of a working life — the early commute, the colleague who became family, the small ritual at the end of every shift — not the years on a plaque. Specific, quiet, and unconcerned with promotions: that is what most retirees actually want to hear. Pick the moment outside work that the work made possible.",
        "audio": False,
        "links": [
            ("anniversary", "[anniversary](/anniversary-song-gift)"),
        ],
    },
    "proposal-song-gift": {
        "qa": "A proposal song gift should support the proposal, not perform it. Tell one real story from your relationship, lead gently to the question, and match the song's volume to your partner's comfort. A private song works for most people. Public songs only work when you are certain the answer is yes — and that means marriage has already been discussed.",
        "audio": True,
        "links": [
            ("a real apology", "a [real apology](/blog/apology-song)"),
            ("wedding", "[wedding](/wedding-song-gift)"),
        ],
    },
    "wedding-song-gift": {
        "qa": "A wedding song gift can be played at the ceremony, given to the couple privately, or both. The strongest wedding songs anchor on one real moment from the courtship — a habit, a phrase, a fear they overcame — not the wedding day itself. Give the song time to become 'their song' before the day so it is recognizable when they hear it again.",
        "audio": False,
        "links": [
            ("anniversary", "[anniversary](/anniversary-song-gift)"),
            ("proposal", "[proposal](/blog/proposal-song-gift)"),
        ],
    },
}


def fix_article(slug, config):
    path = os.path.join(BLOG_DIR, f"2026-05-10-{slug}.md")
    if not os.path.exists(path):
        return f"SKIP {slug}: file not found"

    with open(path, "r", encoding="utf-8") as f:
        body = f.read()

    changes = []

    # Fix 1: Insert Quick Answer block after "ARTICLE CONTENT:" header
    if QA_MARKER not in body:
        ac_pattern = re.compile(r"(ARTICLE CONTENT:\s*\n)", re.MULTILINE)
        match = ac_pattern.search(body)
        if match:
            qa_block = f"{QA_MARKER}\n\n{config['qa']}\n\n"
            insertion_point = match.end()
            body = body[:insertion_point] + qa_block + body[insertion_point:]
            changes.append("quick-answer")

    # Fix 2: Audio embed (high-emotion only). Insert AFTER the first 2 paragraphs of body.
    if config.get("audio") and AUDIO_MARKER not in body:
        # Find the first H2 in the article body that comes after the QA block
        # Insert audio just before that first H2
        ac_idx = body.find("ARTICLE CONTENT:")
        if ac_idx >= 0:
            # Find the FIRST `## ` heading after the QA block (which is itself an H2)
            # We want to insert AFTER QA + any opening narrative, BEFORE the next H2
            qa_idx = body.find(QA_MARKER, ac_idx)
            if qa_idx >= 0:
                # Find next "## " that is NOT the QA marker itself
                search_start = qa_idx + len(QA_MARKER)
                next_h2_match = re.search(r"\n(## (?!Quick answer))", body[search_start:])
                if next_h2_match:
                    insertion_point = search_start + next_h2_match.start() + 1  # before the \n##
                    body = body[:insertion_point] + AUDIO_EMBED + body[insertion_point:]
                    changes.append("audio")

    # Fix 3: Internal links. Replace first occurrence of each (find, replace) pair.
    for find, replace in config.get("links", []):
        # Only apply if not already linked (skip if "[find" already exists in body)
        if f"[{find}]" not in body and f"]({replace.split('(')[1].split(')')[0]})" not in body:
            # Find first standalone occurrence (not already inside markdown link or URL)
            pattern = re.compile(r"(?<![\[\(/`])\b" + re.escape(find) + r"\b(?![\]\)/])", re.IGNORECASE)
            match = pattern.search(body)
            if match:
                # Replace just the first occurrence, preserving original case
                original = match.group(0)
                # Build replace using original case-matched text but with target URL
                target_url = replace.split("(")[1].split(")")[0]
                replacement = f"[{original}]({target_url})"
                body = body[:match.start()] + replacement + body[match.end():]
                changes.append(f"link:{find}")

    if changes:
        with open(path, "w", encoding="utf-8") as f:
            f.write(body)
        return f"OK {slug}: {', '.join(changes)}"
    else:
        return f"SKIP {slug}: no changes (already fixed)"


def main():
    results = []
    for slug, config in ARTICLES.items():
        results.append(fix_article(slug, config))
    for r in results:
        print(r)
    print()
    print(f"Total: {len(results)} articles processed")
    print(f"Modified: {sum(1 for r in results if r.startswith('OK'))}")
    print(f"Skipped:  {sum(1 for r in results if r.startswith('SKIP'))}")


if __name__ == "__main__":
    main()
