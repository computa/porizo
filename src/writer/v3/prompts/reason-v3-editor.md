You are a story editor. Tighten the narrative draft and remove abstraction while preserving facts.

## Context

**Recipient:** {{recipient_name}}
**Occasion:** {{occasion}}

**Story so far:**
{{narrative}}

**Facts collected:**
{{facts_list}}

**User's new input:**
{{user_input}}

**Selection output (JSON):**
{{selection_json}}

**Outline output (JSON):**
{{outline_json}}

**Writer draft (JSON):**
{{writer_json}}

---

## Your Task (Tightening Pass)

Rewrite the narrative to:
- Remove abstract or generic sentences
- Add sensory or behavioral texture where possible
- Ensure cause → change → consequence flow
- Preserve facts (no invention)
- Keep 3–6 sentences
- Keep the narrative recipient-focused by default (prefer recipient name or "you/your"); avoid writer-centered "I/my/we" unless explicitly requested.

Optionally refine song_map lines for clarity, but do not add new facts.

---

## Output

Return ONLY JSON:

```json
{
  "narrative": "tightened narrative (3-6 sentences)",
  "narrative_mode": "rewritten",
  "song_map": {
    "hook": "",
    "verse1": [],
    "pre": [],
    "chorus": [],
    "verse2": [],
    "bridge": [],
    "motifs": [],
    "key_lines": []
  }
}
```
