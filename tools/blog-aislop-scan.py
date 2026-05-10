#!/usr/bin/env python3
"""Scan blog articles for AI-slop patterns. Counts and locates tells."""
import os, re, glob

BLOG_DIR = "/Users/ao/Documents/projects/porizo/marketing/blog"

# AI-slop pattern catalog. Each entry: (label, regex, severity 1-3)
PATTERNS = [
    # Vocabulary tells (high-severity LLM giveaways)
    ("delve|delving",            r"\b(delve|delving|delved)\b", 3),
    ("comprehensive",            r"\b[Cc]omprehensive\b", 3),
    ("navigate the",             r"\bnavigate\s+the\b", 3),
    ("embark on",                r"\bembark\s+on\b", 3),
    ("realm of",                 r"\brealm\s+of\b", 3),
    ("tapestry",                 r"\btapestry\b", 3),
    ("intricate",                r"\bintricate\b", 3),
    ("harness the power",        r"\bharness\s+the\s+power\b", 3),
    ("unlock",                   r"\bunlock\b", 3),
    ("leverage",                 r"\bleverage\b", 3),
    ("robust",                   r"\brobust\b", 2),
    ("elevate",                  r"\belevate\b", 3),
    ("dive in|dive into",        r"\bdive\s+in(to)?\b", 3),
    ("look no further",          r"\blook\s+no\s+further\b", 3),
    ("in today's fast-paced",    r"\bin\s+today'?s\s+(fast-paced|world|landscape)\b", 3),
    ("game[- ]changer",          r"\bgame[\s-]?changer\b", 3),

    # Filler / hedge phrases
    ("it's important to note",   r"\bit'?s\s+important\s+to\s+note\b", 2),
    ("it's worth noting",        r"\bit'?s\s+worth\s+noting\b", 2),
    ("worth mentioning",         r"\bworth\s+mentioning\b", 2),
    ("in conclusion",            r"\bin\s+conclusion\b", 3),
    ("in summary",               r"\bin\s+summary\b", 3),
    ("to summarize",             r"\bto\s+summari[sz]e\b", 3),
    ("ultimately,",              r"\b[Uu]ltimately,\b", 1),
    ("furthermore,",             r"\b[Ff]urthermore,\b", 2),
    ("moreover,",                r"\b[Mm]oreover,\b", 2),
    ("in essence",               r"\bin\s+essence\b", 2),
    ("at its core",              r"\bat\s+its\s+core\b", 2),

    # Marketing fluff
    ("perfect for",              r"\bperfect\s+for\b", 1),
    ("the perfect",              r"\bthe\s+perfect\b", 1),
    ("ultimate guide",           r"\bultimate\s+guide\b", 3),
    ("whether you're",           r"\bwhether\s+you'?re\b", 1),
    ("look no further",          r"\blook\s+no\s+further\b", 3),

    # Em-dash density (just count occurrences; flag if >5 in a single article)
    ("em-dashes (—)",            r"—", 0),  # severity 0 = informational only

    # "X is more than just Y" pattern (common LLM tell)
    ("more than just",           r"\bmore\s+than\s+just\b", 2),
    ("not just X but Y",         r"\bnot\s+just\s+\w+\s+but\s+\w+\b", 2),
]


def scan_file(path):
    """Return dict of {label: (count, severity)} for this file."""
    with open(path, "r", encoding="utf-8") as f:
        body = f.read()
    findings = []
    em_dash_count = 0
    for label, pattern, severity in PATTERNS:
        matches = list(re.finditer(pattern, body, re.IGNORECASE if "Cc" not in pattern and "Uu" not in pattern else 0))
        if matches:
            findings.append((label, len(matches), severity))
            if "—" in pattern:
                em_dash_count = len(matches)
    return findings, em_dash_count


def severity_score(findings):
    """Composite slop score: sum of (count * severity) for severity > 0."""
    return sum(count * severity for label, count, severity in findings if severity > 0)


def main():
    files = sorted(glob.glob(f"{BLOG_DIR}/2026-05-10-*.md"))
    print(f"Scanning {len(files)} articles for AI-slop patterns\n")

    summary = []
    for path in files:
        slug = os.path.basename(path).replace("2026-05-10-", "").replace(".md", "")
        findings, em_dashes = scan_file(path)
        score = severity_score(findings)
        summary.append((slug, score, em_dashes, findings))

    # Sort by score descending (worst first)
    summary.sort(key=lambda x: -x[1])

    print(f"{'Article':<32}  {'SlopScore':<10}  {'EmDash':<7}  Tells")
    print("-" * 100)
    for slug, score, em_dashes, findings in summary:
        # High-severity tells only in summary line
        high_tells = [f"{label}({count})" for label, count, sev in findings if sev >= 2]
        print(f"{slug:<32}  {score:<10}  {em_dashes:<7}  {', '.join(high_tells[:6]) if high_tells else '(clean)'}")

    print()
    print("=== SCORE INTERPRETATION ===")
    print("  0-3:   minimal AI-slop (good)")
    print("  4-9:   some tells, lightly editable")
    print("  10-19: noticeable slop, needs editing pass")
    print("  20+:   heavy slop, rewrite portions")
    print()
    print("=== EM-DASH GUIDANCE ===")
    print("  ≤5: fine")
    print("  6-12: noticeable, consider varying punctuation")
    print("  13+: an LLM tell, replace half with commas/periods")


if __name__ == "__main__":
    main()
