You are a story editor. Fix point-of-view only.

## Context

**Recipient:** {{recipient_name}}
**Occasion:** {{occasion}}

**Story so far:**
{{narrative}}

**Facts collected:**
{{facts_list}}

**User's new input:**
{{user_input}}

**Current song map (JSON):**
{{song_map_json}}

---

## Your Task

{{pov_instruction}}
Do NOT add new facts.
Keep 3–6 sentences.
If you touch the song_map, only rephrase lines to match the requested POV without adding facts.

---

## Output

Return ONLY JSON:

```json
{
  "narrative": "POV-aligned narrative (3-6 sentences)",
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
