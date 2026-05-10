#!/usr/bin/env python3
"""
blog-aeo-audit: programmatic audit of 13 articles against the AEO rubric.
Extracts measurable metrics, computes scores, surfaces blockers.

Outputs a per-article scorecard + composite recommendation.
"""
import os, re, glob, json
from collections import defaultdict

BLOG_DIR = "/Users/ao/Documents/projects/porizo/marketing/blog"

# Articles in scope (the 13 painkiller drafts)
TARGET_SLUGS = {
    "apology-song", "long-distance-song-gift", "anniversary-song-gift",
    "mothers-day-song-gift", "pet-memorial-song", "baby-announcement-song",
    "pregnancy-announcement-song", "gender-reveal-song", "newborn-song-gift",
    "graduation-gift-song", "retirement-song-gift", "proposal-song-gift",
    "wedding-song-gift",
}


def extract_metrics(path):
    with open(path, "r", encoding="utf-8") as f:
        body = f.read()

    metrics = {}

    # Pull frontmatter fields
    metrics["title"] = (re.search(r"^TITLE:\s*\n([^\n]+)", body, re.MULTILINE) or [""])[0]
    if isinstance(metrics["title"], re.Match):
        metrics["title"] = metrics["title"].group(1).strip()
    title_m = re.search(r"^TITLE:\s*\n([^\n]+)", body, re.MULTILINE)
    metrics["title"] = title_m.group(1).strip() if title_m else ""

    target_m = re.search(r"^TARGET_QUERY:\s*\n([^\n]+)", body, re.MULTILINE)
    metrics["target_query"] = target_m.group(1).strip() if target_m else ""

    excerpt_m = re.search(r"^EXCERPT:\s*\n([^\n]+)", body, re.MULTILINE)
    metrics["excerpt"] = excerpt_m.group(1).strip() if excerpt_m else ""
    metrics["excerpt_words"] = len(metrics["excerpt"].split())

    # Article body (after "ARTICLE CONTENT:" line)
    ac_m = re.search(r"^ARTICLE CONTENT:\s*\n", body, re.MULTILINE)
    article_body = body[ac_m.end():] if ac_m else ""

    # Word count of body
    words = re.findall(r"\b\w+\b", article_body)
    metrics["body_words"] = len(words)

    # H2 count (## Headers)
    metrics["h2_count"] = len(re.findall(r"^## ", article_body, re.MULTILINE))

    # Quick answer block present?
    metrics["has_quick_answer"] = "## Quick answer" in article_body

    # Audio embed present?
    metrics["has_audio"] = "porizo.co/audio/sample-mothers-day-2026.mp3" in article_body

    # FAQ count (### inside FAQ section)
    faq_section_m = re.search(r"^## (?:Frequently Asked Questions|FAQs?)\s*$(.*?)(?=^## |\Z)",
                              article_body, re.MULTILINE | re.DOTALL)
    if faq_section_m:
        faq_section = faq_section_m.group(1)
        metrics["faq_count"] = len(re.findall(r"^### ", faq_section, re.MULTILINE))
    else:
        metrics["faq_count"] = 0

    # Sources count (bullets in Sources section)
    src_section_m = re.search(r"^## Sources\s*$(.*?)(?=^## |\Z)",
                              article_body, re.MULTILINE | re.DOTALL)
    if src_section_m:
        src_section = src_section_m.group(1)
        metrics["source_count"] = len(re.findall(r"^- \[", src_section, re.MULTILINE))
        # Quality heuristic: .gov/.edu/.org/.ac.uk + recognized academic publishers
        quality_patterns = [
            r"\.(gov|edu|org|ac\.uk|nhs\.uk)\b",
            r"\b(britannica\.com|academic\.oup\.com|tandfonline\.com|escholarship\.org|"
            r"jamanetwork\.com|nature\.com|sciencedirect\.com|cambridge\.org|"
            r"springer\.com|wiley\.com|jstor\.org|nih\.gov|cdc\.gov|who\.int|"
            r"hms\.harvard\.edu|harvard\.edu|stanford\.edu|mit\.edu|"
            r"acog\.org|avma\.org|aap\.org|apa\.org)\b",
        ]
        quality_count = 0
        for pat in quality_patterns:
            quality_count += len(re.findall(pat, src_section, re.IGNORECASE))
        metrics["high_quality_sources"] = quality_count
    else:
        metrics["source_count"] = 0
        metrics["high_quality_sources"] = 0

    # Internal links to porizo (count of links to relative paths or porizo.co)
    internal_links = re.findall(r"\]\((/[^)]+|https?://porizo\.co/[^)]+)\)", article_body)
    metrics["internal_link_count"] = len(internal_links)

    # External non-source links (citations in body, not in Sources section)
    body_minus_sources = re.sub(r"^## Sources.*", "", article_body, flags=re.MULTILINE | re.DOTALL)
    body_minus_related = re.sub(r"^## Related guides.*?(?=^## |\Z)", "", body_minus_sources,
                                flags=re.MULTILINE | re.DOTALL)
    inline_external = re.findall(r"\]\(https?://(?!porizo\.co)[^)]+\)", body_minus_related)
    metrics["inline_citations"] = len(inline_external)

    # Title vs target query alignment (normalize hyphens/case/punct)
    def _norm(s):
        return re.sub(r"[\W_]+", " ", s.lower()).strip()
    metrics["title_matches_query"] = _norm(metrics["target_query"]) in _norm(metrics["title"])

    # Excerpt is answer-shaped? (40-160 chars is sweet spot for snippet)
    metrics["excerpt_len_chars"] = len(metrics["excerpt"])

    # Has "Bad/Better" or numbered step pattern (concrete examples)
    metrics["has_concrete_examples"] = bool(
        re.search(r"^Bad:?\s*$\s*\n", article_body, re.MULTILINE) or
        re.search(r"^Bad prompt:", article_body, re.MULTILINE)
    )

    # Has "When not to" / "Avoid" type negative-guidance section (editorial spine)
    metrics["has_editorial_position"] = bool(
        re.search(r"^## (When [Nn]ot|What [Nn]ot|Avoid|Do [Nn]ot)\b", article_body, re.MULTILINE)
    )

    return metrics


def score_article(m):
    """Score 0-10 per category per the rubric."""
    scores = {}

    # Citation Potential (40%)
    cp = 0
    cp += 2 if m["has_quick_answer"] else 0
    cp += 2 if m["body_words"] >= 1000 else (1 if m["body_words"] >= 700 else 0)
    cp += 2 if m["high_quality_sources"] >= 2 else (1 if m["high_quality_sources"] >= 1 else 0)
    cp += 2 if m["inline_citations"] >= 2 else (1 if m["inline_citations"] >= 1 else 0)
    cp += 1 if m["has_concrete_examples"] else 0
    cp += 1 if m["has_editorial_position"] else 0
    scores["citation_potential"] = min(cp, 10)

    # AEO Strength (35%)
    aeo = 0
    aeo += 2 if m["has_quick_answer"] else 0
    aeo += 2 if m["faq_count"] >= 5 else (1 if m["faq_count"] >= 4 else 0)
    aeo += 2 if m["internal_link_count"] >= 3 else (1 if m["internal_link_count"] >= 1 else 0)
    aeo += 2 if 5 <= m["h2_count"] <= 10 else (1 if 3 <= m["h2_count"] < 5 else 0)
    aeo += 1 if m["title_matches_query"] else 0
    aeo += 1 if 80 <= m["excerpt_len_chars"] <= 200 else 0
    scores["aeo_strength"] = min(aeo, 10)

    # Framework Alignment (25%)
    fa = 0
    fa += 2 if m["has_audio"] else 0  # Porizo product proof
    fa += 2 if m["has_editorial_position"] else 0  # editorial methodology
    fa += 2 if m["high_quality_sources"] >= 1 else 0  # entity depth via real sources
    fa += 2 if m["internal_link_count"] >= 2 else 0  # category citation web
    fa += 2 if m["has_concrete_examples"] else 0  # methodology proof
    scores["framework_alignment"] = min(fa, 10)

    # Weighted total /100
    total = (
        scores["citation_potential"] * 4.0 +
        scores["aeo_strength"] * 3.5 +
        scores["framework_alignment"] * 2.5
    )
    scores["total"] = round(total, 1)

    # Recommendation
    if total >= 75:
        scores["verdict"] = "publish as-is"
    elif total >= 60:
        scores["verdict"] = "publish after light edits"
    elif total >= 45:
        scores["verdict"] = "revise before publishing"
    else:
        scores["verdict"] = "rewrite substantially"

    return scores


def find_blockers(m, s):
    """Return top blockers per article."""
    blockers = []
    if not m["has_quick_answer"]:
        blockers.append("missing Quick Answer block")
    if m["body_words"] < 700:
        blockers.append(f"thin body ({m['body_words']} words; aim for 1000+)")
    if m["high_quality_sources"] == 0:
        blockers.append("no .gov/.edu/.org sources")
    if m["inline_citations"] < 1:
        blockers.append("no inline citations in body")
    if m["faq_count"] < 4:
        blockers.append(f"only {m['faq_count']} FAQs (need 5+)")
    if m["internal_link_count"] < 1:
        blockers.append("no internal links to Porizo pages")
    if not m["has_editorial_position"]:
        blockers.append("no 'When not to' / 'Avoid' editorial section")
    if not m["title_matches_query"]:
        blockers.append("title doesn't match target_query")
    return blockers


def main():
    files = sorted(glob.glob(f"{BLOG_DIR}/2026-05-10-*.md"))
    results = []

    for path in files:
        slug = os.path.basename(path).replace("2026-05-10-", "").replace(".md", "")
        if slug not in TARGET_SLUGS:
            continue
        m = extract_metrics(path)
        s = score_article(m)
        b = find_blockers(m, s)
        results.append({"slug": slug, "metrics": m, "scores": s, "blockers": b})

    # Sort by total score, highest first
    results.sort(key=lambda r: -r["scores"]["total"])

    # Print scorecard table
    print(f"\n{'Article':<32}  {'CP':<4}  {'AEO':<4}  {'FA':<4}  {'Total':<6}  {'Verdict':<28}  Words  FAQs  Srcs  IntL  Aud  EdPos")
    print("-" * 140)
    for r in results:
        m = r["metrics"]; s = r["scores"]
        print(
            f"{r['slug']:<32}  "
            f"{s['citation_potential']:<4}  "
            f"{s['aeo_strength']:<4}  "
            f"{s['framework_alignment']:<4}  "
            f"{s['total']:<6}  "
            f"{s['verdict']:<28}  "
            f"{m['body_words']:<5} "
            f"{m['faq_count']:<5} "
            f"{m['source_count']:<5} "
            f"{m['internal_link_count']:<5} "
            f"{'Y' if m['has_audio'] else '-':<4} "
            f"{'Y' if m['has_editorial_position'] else '-'}"
        )

    # Print top blockers
    print("\n\n=== Top Blockers Per Article ===")
    for r in results:
        if r["blockers"]:
            print(f"\n  {r['slug']}:")
            for b in r["blockers"]:
                print(f"    - {b}")

    # Aggregated summary
    print("\n\n=== Verdict Distribution ===")
    verdicts = defaultdict(int)
    for r in results:
        verdicts[r["scores"]["verdict"]] += 1
    for v, n in sorted(verdicts.items()):
        print(f"  {v}: {n}")


if __name__ == "__main__":
    main()
